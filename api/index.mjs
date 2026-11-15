import { config } from '../dist-server/config.js';
import { createDatabase } from '../dist-server/db/database.js';
import { createApp } from '../dist-server/app.js';

let cachedAppPromise = null;

async function getApp() {
  if (!cachedAppPromise) {
    cachedAppPromise = (async () => {
      const db = await createDatabase(config.databaseUrl, { maxConnections: 5 });
      return createApp(db, config);
    })().catch((err) => {
      cachedAppPromise = null;
      throw err;
    });
  }
  return cachedAppPromise;
}

function normalizeRewrittenApiUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  const parsed = new URL(rawUrl, 'http://localhost');
  if (parsed.pathname === '/api/index' && parsed.searchParams.has('__path')) {
    const subPath = parsed.searchParams.get('__path') || '';
    parsed.searchParams.delete('__path');
    const qs = parsed.searchParams.toString();
    return `/api/${subPath}${qs ? `?${qs}` : ''}`;
  }
  return rawUrl;
}

export default async function handler(req, res) {
  try {
    req.url = normalizeRewrittenApiUrl(req.url);
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error('Erro na API Vercel:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Erro interno ao inicializar o servidor.',
      });
    }
  }
}
