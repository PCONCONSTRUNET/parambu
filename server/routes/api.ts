import crypto from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { AppError, type AppDatabase } from '../db/database.ts';
import {
  createAuthMiddleware,
  loginRateLimit,
  SESSION_COOKIE_NAME,
} from '../middleware/auth.ts';
import {
  changePassword,
  getUserBySessionToken,
  loginUser,
  loginWithSupabase,
  logoutSession,
} from '../services/authService.ts';
import { createDatabaseBackupSnapshot } from '../services/backupService.ts';
import {
  createCustomer,
  deleteCustomer,
  getCustomerDetail,
  listCustomers,
  updateCustomer,
} from '../services/customerService.ts';
import {
  listOpenDebtsSummary,
  receiveDebtPayment,
  reverseDebtPayment,
} from '../services/debtService.ts';
import {
  createManualTransaction,
  deleteManualTransaction,
  getDreReport,
  getFinanceSummary,
  getHomeDashboard,
  updateManualTransaction,
} from '../services/financeService.ts';
import {
  createProduct,
  deleteProduct,
  getProductById,
  listProducts,
  listStockMovements,
  registerStockMovement,
  updateProduct,
} from '../services/productService.ts';
import {
  createProperty,
  deleteProperty,
  endLease,
  ensureMonthlyRentCharges,
  getPropertyDetail,
  getRentalsOverview,
  listProperties,
  listRentReceivables,
  receiveLeaseMonthPayment,
  receiveRentPayment,
  reverseRentPayment,
  startLease,
  updateLease,
  updateProperty,
} from '../services/rentalService.ts';
import {
  cancelSale,
  correctSale,
  createSale,
  deleteSale,
  getSaleById,
  listSales,
  updateSale,
} from '../services/saleService.ts';
import { nowIso } from '../utils/dates.ts';

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function parseId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new AppError('Código inválido.', 400, 'INVALID_ID');
  }
  return n;
}

export function createApiRouter(db: AppDatabase, config: AppConfig) {
  const router = express.Router();
  const requireAuth = createAuthMiddleware(db);

  // Never allow browser/proxy caching of dynamic API responses
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // Live SSE clients for instant multi-tab / multi-device updates
  const sseClients = new Set<Response>();
  const notifyLiveClients = (changedPath: string) => {
    if (sseClients.size === 0) return;
    const payload = `event: change\ndata: ${JSON.stringify({ path: changedPath, ts: Date.now() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const sseKeepalive = setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': ping\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 25_000);
  if (typeof sseKeepalive.unref === 'function') {
    sseKeepalive.unref();
  }

  // In-memory upload buffer stored directly in PostgreSQL (media_files)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new AppError('Envie apenas foto JPG, PNG ou WEBP.'));
      }
    },
  });

  // Public health check
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      await db.get('SELECT 1 AS ok');
      res.json({ ok: true, app: 'Cris Parambu', database: 'postgresql' });
    }),
  );

  // Auth routes
  router.get(
    '/auth/me',
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
      const user = await getUserBySessionToken(db, token);
      res.json({ user });
    }),
  );

  router.post(
    '/auth/login',
    loginRateLimit,
    asyncHandler(async (req, res) => {
      const schema = z
        .object({
          email: z.string().trim().min(1).optional(),
          username: z.string().trim().min(1).optional(),
          password: z.string().min(1),
          rememberMe: z.boolean().optional(),
        })
        .refine((v) => Boolean(v.email || v.username), {
          message: 'Informe seu e-mail ou usuário.',
        });
      const parsed = schema.parse(req.body);
      const identifier = (parsed.email || parsed.username || '').trim();

      const useSupabaseAuth =
        Boolean(config.supabaseAnonKey) || config.allowedLoginEmails.length > 0;

      const result = useSupabaseAuth
        ? await loginWithSupabase(
            db,
            {
              supabaseUrl: config.supabaseUrl,
              supabaseAnonKey: config.supabaseAnonKey,
              allowedLoginEmails: config.allowedLoginEmails,
            },
            identifier,
            parsed.password,
            parsed.rememberMe ?? true,
          )
        : await loginUser(db, identifier, parsed.password, parsed.rememberMe ?? true);

      res.cookie(SESSION_COOKIE_NAME, result.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.nodeEnv === 'production' && req.secure,
        expires: new Date(result.expiresAt),
        path: '/',
      });

      res.json({ user: result.user });
    }),
  );

  router.post(
    '/auth/logout',
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
      await logoutSession(db, token);
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      res.json({ ok: true });
    }),
  );

  router.post(
    '/auth/change-password',
    requireAuth,
    asyncHandler(async (req, res) => {
      const schema = z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(4),
        displayName: z.string().optional(),
      });
      const parsed = schema.parse(req.body);
      await changePassword(
        db,
        req.user!.id,
        parsed.currentPassword,
        parsed.newPassword,
        parsed.displayName,
      );
      res.json({ ok: true });
    }),
  );

  // Everything below requires private login
  router.use(requireAuth);

  // Live stream for instant updates across tabs & devices
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Broadcast change notification after any successful mutating API request
  router.use((req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          notifyLiveClients(req.path);
        }
      });
    }
    next();
  });

  // In-memory LRU media cache per database instance (avoids re-fetching PNGs from Supabase)
  const MAX_MEDIA_CACHE_ENTRIES = 60;
  const MAX_MEDIA_CACHE_BYTES = 24 * 1024 * 1024;
  interface CachedMedia {
    mimeType: string;
    data: Buffer;
    etag: string;
  }
  const mediaCache = new Map<string, CachedMedia>();
  let mediaCacheBytes = 0;

  function setMediaCache(filename: string, entry: CachedMedia) {
    if (entry.data.length > 8 * 1024 * 1024) return;
    const prev = mediaCache.get(filename);
    if (prev) {
      mediaCacheBytes -= prev.data.length;
      mediaCache.delete(filename);
    }
    mediaCache.set(filename, entry);
    mediaCacheBytes += entry.data.length;
    while (
      mediaCache.size > MAX_MEDIA_CACHE_ENTRIES ||
      mediaCacheBytes > MAX_MEDIA_CACHE_BYTES
    ) {
      const oldestKey = mediaCache.keys().next().value;
      if (!oldestKey) break;
      const oldest = mediaCache.get(oldestKey);
      if (oldest) mediaCacheBytes -= oldest.data.length;
      mediaCache.delete(oldestKey);
    }
  }

  // Uploads stored 100% in PostgreSQL (media_files)
  router.post(
    '/uploads',
    upload.single('photo'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new AppError('Nenhuma foto enviada.');
      }
      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;

      await db.run(
        `INSERT INTO media_files (filename, mime_type, data, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [filename, req.file.mimetype, req.file.buffer, req.file.buffer.length, nowIso()],
      );

      setMediaCache(filename, {
        mimeType: req.file.mimetype,
        data: req.file.buffer,
        etag: `"${filename}"`,
      });

      res.json({ url: `/api/uploads/${filename}` });
    }),
  );

  router.get(
    '/uploads/:filename',
    asyncHandler(async (req, res) => {
      const safeName = path.basename(String(req.params.filename));
      let entry = mediaCache.get(safeName);
      if (entry) {
        // Refresh LRU order
        mediaCache.delete(safeName);
        mediaCache.set(safeName, entry);
      } else {
        const row = await db.get<{ mime_type: string; data: Buffer }>(
          'SELECT mime_type, data FROM media_files WHERE filename = ?',
          [safeName],
        );
        if (!row) {
          res.status(404).json({ error: 'Foto não encontrada.' });
          return;
        }
        entry = {
          mimeType: row.mime_type,
          data: row.data,
          etag: `"${safeName}"`,
        };
        setMediaCache(safeName, entry);
      }

      res.removeHeader('Pragma');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('ETag', entry.etag);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

      if (req.headers['if-none-match'] === entry.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader('Content-Type', entry.mimeType);
      res.send(entry.data);
    }),
  );

  // Dashboard
  router.get(
    '/dashboard',
    asyncHandler(async (_req, res) => {
      res.json(await getHomeDashboard(db));
    }),
  );

  // Products & Stock
  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const onlyLowStock = req.query.lowStock === '1' || req.query.lowStock === 'true';
      res.json({ products: await listProducts(db, { search, category, onlyLowStock }) });
    }),
  );

  router.get(
    '/products/movements',
    asyncHandler(async (req, res) => {
      const productId = req.query.productId ? parseId(String(req.query.productId)) : undefined;
      res.json({ movements: await listStockMovements(db, productId) });
    }),
  );

  router.get(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const product = await getProductById(db, id);
      const movements = await listStockMovements(db, id, 40);
      res.json({ product, movements });
    }),
  );

  router.post(
    '/products',
    asyncHandler(async (req, res) => {
      const schema = z.object({
        name: z.string().min(1),
        category: z.string().nullable().optional(),
        photoUrl: z.string().nullable().optional(),
        stockQty: z.number().int().min(0),
        minStockQty: z.number().int().min(0).optional(),
        costCents: z.number().int().min(0),
        priceCents: z.number().int().positive(),
        registerInitialPurchase: z.boolean().optional(),
        paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']).optional(),
      });
      const product = await createProduct(db, schema.parse(req.body));
      res.status(201).json({ product });
    }),
  );

  router.put(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const schema = z.object({
        name: z.string().min(1),
        category: z.string().nullable().optional(),
        photoUrl: z.string().nullable().optional(),
        stockQty: z.number().int().min(0).optional(),
        minStockQty: z.number().int().min(0).optional(),
        costCents: z.number().int().min(0),
        priceCents: z.number().int().positive(),
      });
      const product = await updateProduct(db, id, schema.parse(req.body));
      res.json({ product });
    }),
  );

  router.delete(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await deleteProduct(db, id));
    }),
  );

  router.post(
    '/products/:id/stock',
    asyncHandler(async (req, res) => {
      const productId = parseId(String(req.params.id));
      const schema = z.object({
        type: z.enum(['IN', 'OUT', 'ADJUST']),
        quantity: z.number().int().min(0),
        unitCostCents: z.number().int().min(0).optional(),
        reason: z.string().optional(),
        registerFinancialOutflow: z.boolean().optional(),
        paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']).optional(),
        movementDate: z.string().optional(),
      });
      const product = await registerStockMovement(db, { ...schema.parse(req.body), productId });
      res.json({ product });
    }),
  );

  // Customers
  router.get(
    '/customers',
    asyncHandler(async (req, res) => {
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const filterParam = typeof req.query.filter === 'string' ? req.query.filter : 'all';
      const filter =
        filterParam === 'owing' || filterParam === 'overdue' ? filterParam : 'all';
      res.json({ customers: await listCustomers(db, { search, filter }) });
    }),
  );

  router.post(
    '/customers',
    asyncHandler(async (req, res) => {
      const schema = z.object({
        name: z.string().min(1),
        phone: z.string().nullable().optional(),
        cpf: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      });
      const customer = await createCustomer(db, schema.parse(req.body));
      res.status(201).json({ customer });
    }),
  );

  router.put(
    '/customers/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const schema = z.object({
        name: z.string().min(1),
        phone: z.string().nullable().optional(),
        cpf: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      });
      const customer = await updateCustomer(db, id, schema.parse(req.body));
      res.json({ customer });
    }),
  );

  router.get(
    '/customers/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await getCustomerDetail(db, id));
    }),
  );

  router.delete(
    '/customers/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await deleteCustomer(db, id));
    }),
  );

  // Debts & Payments
  router.get(
    '/debts/open',
    asyncHandler(async (_req, res) => {
      res.json({ debts: await listOpenDebtsSummary(db) });
    }),
  );

  router.post(
    '/debts/pay',
    asyncHandler(async (req, res) => {
      const schema = z.object({
        customerId: z.number().int().positive(),
        debtId: z.number().int().positive().optional(),
        amountCents: z.number().int().positive(),
        paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']),
        paymentDate: z.string().optional(),
        notes: z.string().nullable().optional(),
        idempotencyKey: z.string().min(1),
      });
      const result = await receiveDebtPayment(db, schema.parse(req.body));
      res.status(201).json(result);
    }),
  );

  router.delete(
    '/debts/payments/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await reverseDebtPayment(db, id));
    }),
  );

  // Sales
  router.get(
    '/sales',
    asyncHandler(async (req, res) => {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const statusParam = typeof req.query.status === 'string' ? req.query.status : 'ALL';
      const status =
        statusParam === 'COMPLETED' || statusParam === 'CANCELLED' ? statusParam : 'ALL';
      const customerId = req.query.customerId ? parseId(String(req.query.customerId)) : undefined;
      res.json({ sales: await listSales(db, { from, to, status, customerId }) });
    }),
  );

  router.get(
    '/sales/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json({ sale: await getSaleById(db, id) });
    }),
  );

  const saleBodySchema = z.object({
    customerId: z.number().int().positive().nullable().optional(),
    saleType: z.enum(['CASH', 'FIADO', 'INSTALLMENT']),
    paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO', 'FIADO']),
    items: z
      .array(
        z.object({
          productId: z.number().int().positive(),
          quantity: z.number().int().positive(),
          unitPriceCents: z.number().int().positive().optional(),
        }),
      )
      .min(1),
    discountCents: z.number().int().min(0).optional(),
    downPaymentCents: z.number().int().min(0).optional(),
    downPaymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']).optional(),
    dueDate: z.string().optional(),
    installmentCount: z.number().int().min(1).max(36).optional(),
    firstDueDate: z.string().optional(),
    installments: z
      .array(
        z.object({
          dueDate: z.string(),
          amountCents: z.number().int().positive(),
        }),
      )
      .optional(),
    saleDate: z.string().optional(),
    notes: z.string().nullable().optional(),
    idempotencyKey: z.string().optional(),
  });

  router.post(
    '/sales',
    asyncHandler(async (req, res) => {
      const sale = await createSale(db, saleBodySchema.parse(req.body));
      res.status(201).json({ sale });
    }),
  );

  router.post(
    '/sales/:id/cancel',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
      const sale = await cancelSale(db, id, reason);
      res.json({ sale });
    }),
  );

  router.delete(
    '/sales/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await deleteSale(db, id));
    }),
  );

  router.put(
    '/sales/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const sale = await updateSale(db, id, saleBodySchema.parse(req.body));
      res.json({ sale });
    }),
  );

  router.post(
    '/sales/:id/correct',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const sale = await correctSale(db, id, saleBodySchema.parse(req.body));
      res.json({ sale });
    }),
  );

  // Finance & DRE
  const manualTxSchema = z.object({
    direction: z.enum(['IN', 'OUT']),
    category: z.enum(['EXPENSE', 'STOCK_PURCHASE', 'OTHER_IN', 'ADJUSTMENT']),
    description: z.string().min(1),
    amountCents: z.number().int().positive(),
    paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']),
    transactionDate: z.string().optional(),
    dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).nullable().optional(),
  });

  const updateTxSchema = manualTxSchema.extend({
    category: z.enum([
      'EXPENSE',
      'STOCK_PURCHASE',
      'OTHER_IN',
      'ADJUSTMENT',
      'RENT_PAYMENT',
      'DEBT_PAYMENT',
    ]),
  });

  router.get(
    '/finance',
    asyncHandler(async (req, res) => {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const direction = typeof req.query.direction === 'string' ? req.query.direction : undefined;
      res.json(await getFinanceSummary(db, { from, to, category, direction }));
    }),
  );

  router.get(
    '/finance/dre',
    asyncHandler(async (req, res) => {
      const from = typeof req.query.from === 'string' ? req.query.from : undefined;
      const to = typeof req.query.to === 'string' ? req.query.to : undefined;
      res.json(await getDreReport(db, { from, to }));
    }),
  );

  router.post(
    '/finance/transactions',
    asyncHandler(async (req, res) => {
      const tx = await createManualTransaction(db, manualTxSchema.parse(req.body));
      res.status(201).json({ transaction: tx });
    }),
  );

  router.put(
    '/finance/transactions/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const tx = await updateManualTransaction(db, id, updateTxSchema.parse(req.body));
      res.json({ transaction: tx });
    }),
  );

  router.delete(
    '/finance/transactions/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await deleteManualTransaction(db, id));
    }),
  );

  // Rentals
  router.get(
    '/rentals/overview',
    asyncHandler(async (_req, res) => {
      res.json(await getRentalsOverview(db));
    }),
  );

  router.get(
    '/rentals/properties',
    asyncHandler(async (_req, res) => {
      res.json({ properties: await listProperties(db) });
    }),
  );

  router.get(
    '/rentals/receivables',
    asyncHandler(async (_req, res) => {
      res.json({ charges: await listRentReceivables(db) });
    }),
  );

  router.post(
    '/rentals/generate',
    asyncHandler(async (_req, res) => {
      const created = await ensureMonthlyRentCharges(db);
      res.json({ created });
    }),
  );

  router.post(
    '/rentals/properties',
    asyncHandler(async (req, res) => {
      const schema = z.object({
        name: z.string().min(1),
        address: z.string().nullable().optional(),
        photoUrl: z.string().nullable().optional(),
        monthlyRentCents: z.number().int().positive(),
        dueDay: z.number().int().min(1).max(31),
        notes: z.string().nullable().optional(),
      });
      const property = await createProperty(db, schema.parse(req.body));
      res.status(201).json({ property });
    }),
  );

  router.put(
    '/rentals/properties/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      const schema = z.object({
        name: z.string().min(1),
        address: z.string().nullable().optional(),
        photoUrl: z.string().nullable().optional(),
        monthlyRentCents: z.number().int().positive(),
        dueDay: z.number().int().min(1).max(31),
        notes: z.string().nullable().optional(),
      });
      const property = await updateProperty(db, id, schema.parse(req.body));
      res.json({ property });
    }),
  );

  router.get(
    '/rentals/properties/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await getPropertyDetail(db, id));
    }),
  );

  router.delete(
    '/rentals/properties/:id',
    asyncHandler(async (req, res) => {
      const id = parseId(String(req.params.id));
      res.json(await deleteProperty(db, id));
    }),
  );

  router.post(
    '/rentals/properties/:id/lease',
    asyncHandler(async (req, res) => {
      const propertyId = parseId(String(req.params.id));
      const schema = z.object({
        tenantName: z.string().min(1),
        tenantPhone: z.string().nullable().optional(),
        tenantDoc: z.string().nullable().optional(),
        monthlyRentCents: z.number().int().positive().optional(),
        dueDay: z.number().int().min(1).max(31).optional(),
        startDate: z.string().optional(),
        notes: z.string().nullable().optional(),
      });
      const leaseId = await startLease(db, { ...schema.parse(req.body), propertyId });
      res.status(201).json({ leaseId });
    }),
  );

  router.put(
    '/rentals/leases/:id',
    asyncHandler(async (req, res) => {
      const leaseId = parseId(String(req.params.id));
      const schema = z.object({
        tenantName: z.string().min(1),
        tenantPhone: z.string().nullable().optional(),
        tenantDoc: z.string().nullable().optional(),
        monthlyRentCents: z.number().int().positive(),
        dueDay: z.number().int().min(1).max(31),
        notes: z.string().nullable().optional(),
      });
      const lease = await updateLease(db, leaseId, schema.parse(req.body));
      res.json({ lease });
    }),
  );

  router.post(
    '/rentals/leases/:id/end',
    asyncHandler(async (req, res) => {
      const leaseId = parseId(String(req.params.id));
      res.json(await endLease(db, leaseId));
    }),
  );

  router.post(
    '/rentals/charges/:id/pay',
    asyncHandler(async (req, res) => {
      const rentChargeId = parseId(String(req.params.id));
      const schema = z.object({
        amountCents: z.number().int().positive(),
        paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']),
        paymentDate: z.string().optional(),
        notes: z.string().nullable().optional(),
        idempotencyKey: z.string().min(1),
      });
      const result = await receiveRentPayment(db, { ...schema.parse(req.body), rentChargeId });
      res.status(201).json(result);
    }),
  );

  router.post(
    '/rentals/leases/:id/pay',
    asyncHandler(async (req, res) => {
      const leaseId = parseId(String(req.params.id));
      const schema = z.object({
        referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        amountCents: z.number().int().positive(),
        paymentMethod: z.enum(['DINHEIRO', 'PIX', 'CARTAO']),
        paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        notes: z.string().nullable().optional(),
        idempotencyKey: z.string().min(1),
      });
      const result = await receiveLeaseMonthPayment(db, { ...schema.parse(req.body), leaseId });
      res.status(201).json(result);
    }),
  );

  router.delete(
    '/rentals/payments/:id',
    asyncHandler(async (req, res) => {
      const paymentId = parseId(String(req.params.id));
      res.json(await reverseRentPayment(db, paymentId));
    }),
  );

  // Backup download (JSON snapshot directly from PostgreSQL)
  router.get(
    '/backup/download',
    asyncHandler(async (_req, res) => {
      const snapshot = await createDatabaseBackupSnapshot(db);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${snapshot.filename}"`);
      res.send(snapshot.content);
    }),
  );

  // Error handler for API
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Confira os dados preenchidos e tente de novo.' });
      return;
    }
    if (err && typeof err === 'object' && 'name' in err && err.name === 'MulterError') {
      res.status(400).json({ error: 'A foto é muito grande (máximo 5 MB).' });
      return;
    }
    console.error('[API Error]', err);
    res.status(500).json({ error: 'Ocorreu um erro interno. Tente novamente.' });
  });

  return router;
}
