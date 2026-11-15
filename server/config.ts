import 'dotenv/config';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  allowedLoginEmails: string[];
  sessionSecret: string;
  defaultAdminUser: string;
  defaultAdminPassword: string;
}

export function loadConfig(): AppConfig {
  const databaseUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const allowedLoginEmails = (
    process.env.ALLOWED_LOGIN_EMAILS ||
    process.env.ALLOWED_LOGIN_EMAIL ||
    ''
  )
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    allowedLoginEmails,
    sessionSecret: process.env.SESSION_SECRET || 'cris-parambu-local-dev-secret-change-me',
    defaultAdminUser: (process.env.DEFAULT_ADMIN_USER || 'cris').toLowerCase(),
    defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || '1234',
  };
}

export const config = loadConfig();
