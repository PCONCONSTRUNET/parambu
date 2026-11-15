import { AsyncLocalStorage } from 'node:async_hooks';
import pg, { type Pool, type PoolClient, type QueryResult } from 'pg';
import { initSchema } from './schema.ts';

// Ensure COUNT(*) (int8 OID 20) and SUM(...) (numeric OID 1700) parse as JS numbers,
// matching our integer-cent arithmetic everywhere without string concatenation surprises.
pg.types.setTypeParser(20, (val: string) => Number(val));
pg.types.setTypeParser(1700, (val: string) => Number(val));

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface AppDatabase {
  readonly pool: Pool;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const txStorage = new AsyncLocalStorage<PoolClient>();

function convertPlaceholders(sql: string): string {
  let out = '';
  let paramIndex = 1;
  let inSingleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (!inSingleQuote && ch === '-' && next === '-') {
      inLineComment = true;
      out += '--';
      i += 1;
      continue;
    }

    if (ch === "'") {
      out += ch;
      if (inSingleQuote && next === "'") {
        out += "'";
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && ch === '?') {
      out += `$${paramIndex}`;
      paramIndex += 1;
    } else {
      out += ch;
    }
  }

  return out;
}

function shouldUseSsl(connectionString: string): boolean {
  if (/sslmode=disable/i.test(connectionString)) return false;
  if (/localhost|127\.0\.0\.1/i.test(connectionString) && !/sslmode=require/i.test(connectionString)) {
    return false;
  }
  return true;
}

export async function createDatabase(
  connectionString: string,
  options?: { schema?: string; skipSchemaInit?: boolean; maxConnections?: number },
): Promise<AppDatabase> {
  if (!connectionString) {
    throw new AppError(
      'DATABASE_URL não configurada. Defina a URL do PostgreSQL no arquivo .env.',
      500,
      'MISSING_DATABASE_URL',
    );
  }

  const schemaName = options?.schema?.trim();
  const isServerless = process.env.VERCEL === '1';
  const pool = new pg.Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
    max: options?.maxConnections ?? (isServerless ? 2 : 5),
    idleTimeoutMillis: isServerless ? 5_000 : 15_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
    ...(schemaName ? { options: `-c search_path=${schemaName},public` } : {}),
  });
  pool.on('error', () => undefined);

  const execute = async (sql: string, params: unknown[] = []): Promise<QueryResult> => {
    const client = txStorage.getStore();
    const pgSql = convertPlaceholders(sql);
    if (client) {
      return client.query(pgSql, params);
    }
    return pool.query(pgSql, params);
  };

  const db: AppDatabase = {
    pool,
    async get<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await execute(sql, params);
      return res.rows[0] as T | undefined;
    },
    async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await execute(sql, params);
      return res.rows as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const res = await execute(sql, params);
      const first = res.rows[0] as { id?: number | string } | undefined;
      return {
        changes: res.rowCount ?? 0,
        lastInsertRowid: first?.id !== undefined ? Number(first.id) : 0,
      };
    },
    async exec(sql: string) {
      const client = txStorage.getStore();
      if (client) {
        await client.query(sql);
      } else {
        await pool.query(sql);
      }
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      const activeClient = txStorage.getStore();
      if (activeClient) {
        return fn();
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await txStorage.run(client, fn);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback errors
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };

  if (schemaName) {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName.replace(/"/g, '')}"`);
  }

  if (!options?.skipSchemaInit) {
    await initSchema(db);
  }

  return db;
}

export async function runInTransaction<T>(db: AppDatabase, fn: () => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
