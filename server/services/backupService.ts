import type { AppDatabase } from '../db/database.ts';
import { todayBR } from '../utils/dates.ts';

const BACKUP_TABLES = [
  'users',
  'products',
  'stock_movements',
  'customers',
  'sales',
  'sale_items',
  'debts',
  'debt_installments',
  'debt_payments',
  'properties',
  'leases',
  'rent_charges',
  'rent_payments',
  'financial_transactions',
] as const;

export async function createDatabaseBackupSnapshot(db: AppDatabase): Promise<{
  filename: string;
  content: string;
}> {
  const tables: Record<string, unknown[]> = {};

  for (const table of BACKUP_TABLES) {
    if (table === 'users') {
      tables[table] = await db.all(
        'SELECT id, username, display_name, is_default_password, created_at FROM users ORDER BY id ASC',
      );
    } else {
      tables[table] = await db.all(`SELECT * FROM ${table} ORDER BY id ASC`);
    }
  }

  tables.media_files = await db.all(
    'SELECT filename, mime_type, size_bytes, created_at FROM media_files ORDER BY created_at ASC',
  );

  const payload = {
    app: 'Cris Parambu',
    database: 'PostgreSQL / Supabase',
    exportedAt: new Date().toISOString(),
    tables,
  };

  return {
    filename: `cris-parambu-backup-${todayBR()}.json`,
    content: JSON.stringify(payload, null, 2),
  };
}
