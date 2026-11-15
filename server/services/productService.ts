import { AppError, runInTransaction, type AppDatabase } from '../db/database.ts';
import { nowIso, todayBR } from '../utils/dates.ts';
import { matchesFlexibleSearch } from '../utils/search.ts';

export interface ProductRow {
  id: number;
  name: string;
  category: string | null;
  photo_url: string | null;
  stock_qty: number;
  min_stock_qty: number;
  cost_cents: number;
  price_cents: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateProductInput {
  name: string;
  category?: string | null;
  photoUrl?: string | null;
  stockQty: number;
  minStockQty?: number;
  costCents: number;
  priceCents: number;
  registerInitialPurchase?: boolean;
  paymentMethod?: 'DINHEIRO' | 'PIX' | 'CARTAO';
}

export interface UpdateProductInput {
  name: string;
  category?: string | null;
  photoUrl?: string | null;
  stockQty?: number;
  minStockQty?: number;
  costCents: number;
  priceCents: number;
}

export interface StockMovementInput {
  productId: number;
  type: 'IN' | 'OUT' | 'ADJUST';
  quantity: number;
  unitCostCents?: number;
  reason?: string;
  registerFinancialOutflow?: boolean;
  paymentMethod?: 'DINHEIRO' | 'PIX' | 'CARTAO';
  movementDate?: string;
}

export async function listProducts(
  db: AppDatabase,
  options?: { search?: string; category?: string; onlyLowStock?: boolean; includeInactive?: boolean },
) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (!options?.includeInactive) {
    conditions.push('is_active = 1');
  }
  if (options?.category?.trim()) {
    conditions.push('category = ?');
    params.push(options.category.trim());
  }
  if (options?.onlyLowStock) {
    conditions.push('stock_qty <= min_stock_qty');
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  let rows = await db.all<ProductRow>(
    `SELECT * FROM products ${where} ORDER BY LOWER(name) ASC`,
    params,
  );

  if (options?.search?.trim()) {
    rows = rows.filter((p) => matchesFlexibleSearch(options.search!, [p.name, p.category]));
  }

  return rows.map((p) => ({
    ...p,
    low_stock: p.stock_qty <= p.min_stock_qty,
  }));
}

export async function getProductById(db: AppDatabase, id: number): Promise<ProductRow> {
  const row = await db.get<ProductRow>('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) {
    throw new AppError('Produto não encontrado.', 404, 'NOT_FOUND');
  }
  return row;
}

export async function createProduct(db: AppDatabase, input: CreateProductInput) {
  const name = input.name.trim();
  if (!name) throw new AppError('Informe o nome do produto.');
  if (!Number.isInteger(input.stockQty) || input.stockQty < 0) {
    throw new AppError('Quantidade inicial inválida.');
  }
  if (!Number.isInteger(input.costCents) || input.costCents < 0) {
    throw new AppError('Custo inválido.');
  }
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
    throw new AppError('Preço de venda precisa ser maior que zero.');
  }
  const minStock =
    Number.isInteger(input.minStockQty) && (input.minStockQty ?? 5) >= 0
      ? (input.minStockQty ?? 5)
      : 5;

  return runInTransaction(db, async () => {
    const now = nowIso();
    const res = await db.run(
      `INSERT INTO products (name, category, photo_url, stock_qty, min_stock_qty, cost_cents, price_cents, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING id`,
      [
        name,
        input.category?.trim() || null,
        input.photoUrl || null,
        input.stockQty,
        minStock,
        input.costCents,
        input.priceCents,
        now,
        now,
      ],
    );

    const productId = res.lastInsertRowid;

    if (input.stockQty > 0) {
      const movRes = await db.run(
        `INSERT INTO stock_movements (product_id, type, delta_qty, qty_after, unit_cost_cents, reason, reference_type, reference_id, created_at)
         VALUES (?, 'IN', ?, ?, ?, ?, 'INITIAL', NULL, ?)
         RETURNING id`,
        [productId, input.stockQty, input.stockQty, input.costCents, 'Estoque inicial', now],
      );

      if (input.registerInitialPurchase && input.costCents > 0) {
        const totalOut = input.stockQty * input.costCents;
        await db.run(
          `INSERT INTO financial_transactions (direction, category, description, amount_cents, payment_method, reference_type, reference_id, transaction_date, created_at)
           VALUES ('OUT', 'STOCK_PURCHASE', ?, ?, ?, 'STOCK_MOVEMENT', ?, ?, ?)`,
          [
            `Compra inicial: ${name} (${input.stockQty}x)`,
            totalOut,
            input.paymentMethod || 'DINHEIRO',
            movRes.lastInsertRowid,
            todayBR(),
            now,
          ],
        );
      }
    }

    return getProductById(db, productId);
  });
}

export async function updateProduct(db: AppDatabase, id: number, input: UpdateProductInput) {
  const existing = await getProductById(db, id);
  const name = input.name.trim();
  if (!name) throw new AppError('Informe o nome do produto.');
  if (!Number.isInteger(input.costCents) || input.costCents < 0) {
    throw new AppError('Custo inválido.');
  }
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) {
    throw new AppError('Preço de venda precisa ser maior que zero.');
  }
  if (input.stockQty !== undefined && (!Number.isInteger(input.stockQty) || input.stockQty < 0)) {
    throw new AppError('Quantidade em estoque inválida.');
  }

  const nextStock = input.stockQty !== undefined ? input.stockQty : existing.stock_qty;
  const minStock =
    Number.isInteger(input.minStockQty) && (input.minStockQty ?? existing.min_stock_qty) >= 0
      ? (input.minStockQty ?? existing.min_stock_qty)
      : existing.min_stock_qty;

  return runInTransaction(db, async () => {
    const now = nowIso();
    await db.run(
      `UPDATE products
       SET name = ?, category = ?, photo_url = ?, stock_qty = ?, min_stock_qty = ?, cost_cents = ?, price_cents = ?, updated_at = ?
       WHERE id = ?`,
      [
        name,
        input.category?.trim() || null,
        input.photoUrl === undefined ? existing.photo_url : input.photoUrl,
        nextStock,
        minStock,
        input.costCents,
        input.priceCents,
        now,
        id,
      ],
    );

    if (nextStock !== existing.stock_qty) {
      await db.run(
        `INSERT INTO stock_movements (product_id, type, delta_qty, qty_after, unit_cost_cents, reason, reference_type, reference_id, created_at)
         VALUES (?, 'ADJUST', ?, ?, ?, ?, 'EDIT', NULL, ?)`,
        [
          id,
          nextStock - existing.stock_qty,
          nextStock,
          input.costCents,
          'Acerto ao editar produto',
          now,
        ],
      );
    }

    return getProductById(db, id);
  });
}

export async function deleteProduct(db: AppDatabase, id: number): Promise<{ mode: 'deleted' | 'archived' }> {
  await getProductById(db, id);
  const hasSales = (await db.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM sale_items WHERE product_id = ?',
    [id],
  )) ?? { cnt: 0 };

  if (hasSales.cnt > 0) {
    await db.run('UPDATE products SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
    return { mode: 'archived' };
  }

  await runInTransaction(db, async () => {
    await db.run('DELETE FROM stock_movements WHERE product_id = ?', [id]);
    await db.run('DELETE FROM products WHERE id = ?', [id]);
  });
  return { mode: 'deleted' };
}

export async function registerStockMovement(db: AppDatabase, input: StockMovementInput) {
  return runInTransaction(db, async () => {
    const product = await getProductById(db, input.productId);
    if (!Number.isInteger(input.quantity) || input.quantity < 0) {
      throw new AppError('Quantidade inválida.');
    }

    let delta = 0;
    let nextQty = product.stock_qty;
    if (input.type === 'IN') {
      if (input.quantity <= 0) throw new AppError('Quantidade de entrada deve ser maior que zero.');
      delta = input.quantity;
      nextQty = product.stock_qty + delta;
    } else if (input.type === 'OUT') {
      if (input.quantity <= 0) throw new AppError('Quantidade de saída deve ser maior que zero.');
      if (input.quantity > product.stock_qty) {
        throw new AppError(`Estoque insuficiente. Só tem ${product.stock_qty} de ${product.name}.`);
      }
      delta = -input.quantity;
      nextQty = product.stock_qty - input.quantity;
    } else if (input.type === 'ADJUST') {
      delta = input.quantity - product.stock_qty;
      nextQty = input.quantity;
      if (delta === 0) {
        throw new AppError('O estoque já está com essa quantidade.');
      }
    }

    const unitCost =
      input.unitCostCents !== undefined && input.unitCostCents >= 0
        ? input.unitCostCents
        : product.cost_cents;

    const now = nowIso();
    const movRes = await db.run(
      `INSERT INTO stock_movements (product_id, type, delta_qty, qty_after, unit_cost_cents, reason, reference_type, reference_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', NULL, ?)
       RETURNING id`,
      [
        product.id,
        input.type,
        delta,
        nextQty,
        unitCost,
        input.reason?.trim() ||
          (input.type === 'IN'
            ? 'Reposição de mercadoria'
            : input.type === 'OUT'
              ? 'Saída manual'
              : 'Acerto de estoque'),
        now,
      ],
    );

    if (input.type === 'IN' && input.unitCostCents !== undefined && input.unitCostCents >= 0) {
      await db.run('UPDATE products SET stock_qty = ?, cost_cents = ?, updated_at = ? WHERE id = ?', [
        nextQty,
        unitCost,
        now,
        product.id,
      ]);
    } else {
      await db.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [
        nextQty,
        now,
        product.id,
      ]);
    }

    if (input.type === 'IN' && input.registerFinancialOutflow && unitCost > 0) {
      const totalPurchaseCents = input.quantity * unitCost;
      await db.run(
        `INSERT INTO financial_transactions (direction, category, description, amount_cents, payment_method, reference_type, reference_id, transaction_date, created_at)
         VALUES ('OUT', 'STOCK_PURCHASE', ?, ?, ?, 'STOCK_MOVEMENT', ?, ?, ?)`,
        [
          `Compra mercadoria: ${product.name} (${input.quantity}x)`,
          totalPurchaseCents,
          input.paymentMethod || 'DINHEIRO',
          movRes.lastInsertRowid,
          input.movementDate || todayBR(),
          now,
        ],
      );
    }

    return getProductById(db, product.id);
  });
}

export async function listStockMovements(db: AppDatabase, productId?: number, limit = 80) {
  if (productId) {
    return db.all(
      `SELECT sm.*, p.name AS product_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.product_id = ?
       ORDER BY sm.id DESC
       LIMIT ?`,
      [productId, limit],
    );
  }
  return db.all(
    `SELECT sm.*, p.name AS product_name
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     ORDER BY sm.id DESC
     LIMIT ?`,
    [limit],
  );
}
