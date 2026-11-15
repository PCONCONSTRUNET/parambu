import type { NextFunction, Request, Response } from 'express';
import type { AppDatabase } from '../db/database.ts';
import { getUserBySessionToken, type UserSessionInfo } from '../services/authService.ts';

export const SESSION_COOKIE_NAME = 'cp_session';

declare global {
  namespace Express {
    interface Request {
      user?: UserSessionInfo;
    }
  }
}

export function createAuthMiddleware(db: AppDatabase) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(
      getUserBySessionToken(db, req.cookies?.[SESSION_COOKIE_NAME] as string | undefined),
    )
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: 'Entre no sistema primeiro.' });
          return;
        }
        req.user = user;
        next();
      })
      .catch(next);
  };
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'local';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.resetAt > now) {
    if (entry.count >= 15) {
      res.status(429).json({ error: 'Muitas tentativas seguidas. Aguarde 1 minuto.' });
      return;
    }
    entry.count += 1;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  }
  next();
}
