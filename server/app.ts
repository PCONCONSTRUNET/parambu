import cookieParser from 'cookie-parser';
import express from 'express';
import type { AppConfig } from './config.ts';
import type { AppDatabase } from './db/database.ts';
import { createApiRouter } from './routes/api.ts';
import { ensureDefaultUser } from './services/authService.ts';

export async function createApp(db: AppDatabase, config: AppConfig) {
  if (!config.supabaseAnonKey && config.allowedLoginEmails.length === 0) {
    await ensureDefaultUser(db, config.defaultAdminUser, config.defaultAdminPassword);
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use('/api', createApiRouter(db, config));

  return app;
}
