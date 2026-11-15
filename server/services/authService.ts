import crypto from 'node:crypto';
import { AppError, type AppDatabase } from '../db/database.ts';
import { nowIso } from '../utils/dates.ts';

export interface UserSessionInfo {
  id: number;
  username: string;
  displayName: string;
  isDefaultPassword: boolean;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const actualBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export async function ensureDefaultUser(
  db: AppDatabase,
  defaultUsername: string,
  defaultPassword: string,
): Promise<void> {
  const row = await db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM users');
  if (!row || row.cnt === 0) {
    const hash = hashPassword(defaultPassword);
    await db.run(
      `INSERT INTO users (username, display_name, password_hash, is_default_password, created_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (username) DO NOTHING`,
      [defaultUsername.toLowerCase(), 'Cris Parambu', hash, nowIso()],
    );
  }
}

export async function loginUser(
  db: AppDatabase,
  username: string,
  password: string,
  rememberMe = true,
): Promise<{ token: string; expiresAt: string; user: UserSessionInfo }> {
  const cleanUser = username.trim().toLowerCase();
  const user = await db.get<{
    id: number;
    username: string;
    display_name: string;
    password_hash: string;
    is_default_password: number;
  }>(
    'SELECT id, username, display_name, password_hash, is_default_password FROM users WHERE username = ?',
    [cleanUser],
  );

  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new AppError('Usuário ou senha incorretos.', 401, 'INVALID_CREDENTIALS');
  }

  return issueSession(db, {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    isDefaultPassword: user.is_default_password === 1,
  }, rememberMe);
}

async function issueSession(
  db: AppDatabase,
  user: UserSessionInfo,
  rememberMe = true,
): Promise<{ token: string; expiresAt: string; user: UserSessionInfo }> {
  // Clean expired sessions opportunistically
  await db.run('DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]);

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const ttlDays = rememberMe ? 30 : 1;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  await db.run('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    tokenHash,
    user.id,
    expiresAt,
    nowIso(),
  ]);

  return {
    token,
    expiresAt,
    user,
  };
}

export async function loginWithSupabase(
  db: AppDatabase,
  options: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    allowedLoginEmails: string[];
  },
  email: string,
  password: string,
  rememberMe = true,
): Promise<{ token: string; expiresAt: string; user: UserSessionInfo }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    throw new AppError('Informe seu e-mail para entrar.', 400, 'MISSING_EMAIL');
  }

  if (options.allowedLoginEmails.length > 0 && !options.allowedLoginEmails.includes(cleanEmail)) {
    throw new AppError('Este e-mail não está autorizado a acessar o sistema.', 403, 'UNAUTHORIZED_EMAIL');
  }

  const baseUrl = options.supabaseUrl.replace(/\/+$/, '');
  if (!baseUrl || !options.supabaseAnonKey) {
    throw new AppError(
      'Login via Supabase Auth não configurado no servidor (falta SUPABASE_URL / SUPABASE_ANON_KEY).',
      500,
      'SUPABASE_AUTH_NOT_CONFIGURED',
    );
  }

  let res: globalThis.Response;
  try {
    res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: options.supabaseAnonKey,
        Authorization: `Bearer ${options.supabaseAnonKey}`,
      },
      body: JSON.stringify({ email: cleanEmail, password }),
    });
  } catch {
    throw new AppError(
      'Não foi possível conectar ao servidor de autenticação da Supabase.',
      503,
      'SUPABASE_AUTH_UNREACHABLE',
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
    msg?: string;
    user?: {
      email?: string;
      user_metadata?: { full_name?: string; name?: string };
    };
  };

  if (!res.ok) {
    const rawMsg = String(body.error_description || body.msg || body.error || '');
    if (/invalid login credentials/i.test(rawMsg)) {
      throw new AppError('E-mail ou senha incorretos.', 401, 'INVALID_CREDENTIALS');
    }
    if (/email not confirmed/i.test(rawMsg)) {
      throw new AppError(
        'E-mail ainda não confirmado na Supabase. Confirme o usuário no painel da Supabase.',
        401,
        'EMAIL_NOT_CONFIRMED',
      );
    }
    throw new AppError(rawMsg || 'Não foi possível validar o login na Supabase.', 401, 'INVALID_CREDENTIALS');
  }

  const verifiedEmail = (body.user?.email || cleanEmail).trim().toLowerCase();
  if (options.allowedLoginEmails.length > 0 && !options.allowedLoginEmails.includes(verifiedEmail)) {
    throw new AppError('Este e-mail não está autorizado a acessar o sistema.', 403, 'UNAUTHORIZED_EMAIL');
  }

  const displayName =
    body.user?.user_metadata?.full_name?.trim() ||
    body.user?.user_metadata?.name?.trim() ||
    'Cris Parambu';

  // Sync Supabase Auth identity into PostgreSQL users table for session foreign-key integrity
  const placeholderHash = hashPassword(crypto.randomBytes(24).toString('hex'));
  const upserted = await db.get<{
    id: number;
    username: string;
    display_name: string;
    is_default_password: number;
  }>(
    `INSERT INTO users (username, display_name, password_hash, is_default_password, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (username) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           is_default_password = 0
     RETURNING id, username, display_name, is_default_password`,
    [verifiedEmail, displayName, placeholderHash, nowIso()],
  );

  if (!upserted) {
    throw new AppError('Falha ao registrar sessão do usuário.', 500, 'AUTH_SYNC_FAILED');
  }

  return issueSession(
    db,
    {
      id: upserted.id,
      username: upserted.username,
      displayName: upserted.display_name,
      isDefaultPassword: false,
    },
    rememberMe,
  );
}

const SESSION_CACHE_TTL_MS = 30_000;
const sessionCacheByDb = new WeakMap<
  AppDatabase,
  Map<string, { user: UserSessionInfo; expiresAtMs: number }>
>();

function getSessionCache(db: AppDatabase) {
  let cache = sessionCacheByDb.get(db);
  if (!cache) {
    cache = new Map();
    sessionCacheByDb.set(db, cache);
  }
  return cache;
}

export async function getUserBySessionToken(
  db: AppDatabase,
  token: string | undefined,
): Promise<UserSessionInfo | null> {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const cache = getSessionCache(db);
  const cached = cache.get(tokenHash);
  const nowMs = Date.now();
  if (cached) {
    if (cached.expiresAtMs > nowMs) {
      return { ...cached.user };
    }
    cache.delete(tokenHash);
  }

  const row = await db.get<{
    id: number;
    username: string;
    display_name: string;
    is_default_password: number;
    expires_at: string;
  }>(
    `SELECT u.id, u.username, u.display_name, u.is_default_password, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [tokenHash],
  );

  if (!row) return null;
  const dbExpiresAtMs = new Date(row.expires_at).getTime();
  if (row.expires_at <= nowIso() || Number.isNaN(dbExpiresAtMs)) {
    await db.run('DELETE FROM sessions WHERE id = ?', [tokenHash]);
    return null;
  }

  const user: UserSessionInfo = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isDefaultPassword: row.is_default_password === 1,
  };
  cache.set(tokenHash, {
    user,
    expiresAtMs: Math.min(nowMs + SESSION_CACHE_TTL_MS, dbExpiresAtMs),
  });
  return { ...user };
}

export async function logoutSession(db: AppDatabase, token: string | undefined): Promise<void> {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  getSessionCache(db).delete(tokenHash);
  await db.run('DELETE FROM sessions WHERE id = ?', [tokenHash]);
}

export async function changePassword(
  db: AppDatabase,
  userId: number,
  currentPassword: string,
  newPassword: string,
  newDisplayName?: string,
): Promise<void> {
  if (newPassword.trim().length < 4) {
    throw new AppError('A nova senha precisa ter pelo menos 4 caracteres.');
  }
  const user = await db.get<{ id: number; password_hash: string; display_name: string }>(
    'SELECT id, password_hash, display_name FROM users WHERE id = ?',
    [userId],
  );

  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    throw new AppError('A senha atual está errada.', 400, 'WRONG_PASSWORD');
  }

  const nextHash = hashPassword(newPassword);
  const displayName = newDisplayName?.trim() || user.display_name;
  await db.run(
    'UPDATE users SET password_hash = ?, display_name = ?, is_default_password = 0 WHERE id = ?',
    [nextHash, displayName, userId],
  );
  getSessionCache(db).clear();
}
