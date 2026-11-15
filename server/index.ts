import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.ts';
import { createDatabase } from './db/database.ts';
import { createApp } from './app.ts';

async function bootstrap() {
  const db = await createDatabase(config.databaseUrl);
  const app = await createApp(db, config);

  if (config.nodeEnv === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('/{*splat}', async (req, res, next) => {
      try {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const template = fs.readFileSync(htmlPath, 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Cris Parambu rodando em http://localhost:${config.port} (PostgreSQL / Supabase)`);
  });

  const shutdown = () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Erro ao iniciar servidor:', err);
  process.exit(1);
});
