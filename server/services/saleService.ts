import crypto from 'node:crypto';
import { AppError, runInTransaction, type AppDatabase } from '../db/database.ts';
import { addDays, addMonthsClamped, nowIso, todayBR } from '../utils/dates.ts';

export interface SaleItemInput {
  productId: number;
  quantity: number;
  unitPriceCents?: number;
}

export interface CustomInstallmentInput {
  dueDate: string;
  amountCents: number;
}

export interface CreateSaleInput {
  customerId?: number | null;
  saleType: 'CASH' | 'FIADO' | 'INSTALLMENT';
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'FIADO';
  items: SaleItemInput[];
  discountCents?: number;
  downPaymentCents?: number;
  downPaymentMethod?: 'DINHEIRO' | 'PIX' | 'CARTAO';
  dueDate?: string;
  installmentCount?: number;
  firstDueDate?: string;
  installments?: CustomInstallmentInput[];
  saleDate?: string;
  notes?: string | null;
  idempotencyKey?: string;
}

export interface SaleDetailRow {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  customer_address: string | null;
  customer_notes: string | null;
  sale_type: 'CASH' | 'FIADO' | 'INSTALLMENT';
  payment_method: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'FIADO';
  discount_cents: number;
  total_cents: number;
  total_cost_cents: number;
  profit_cents: number;
  paid_cents: number;
  status: 'COMPLETED' | 'CANCELLED';
  cancel_reason: string | null;
  cancelled_at: string | null;
  sale_date: string;
  notes: string | null;
  created_at: string;
  items: Array<Record<string, unknown>>;
  debt: (Record<string, unknown> & { installments: unknown[] }) | null;
}

export async function getSaleById(db: AppDatabase, id: number): Promise<SaleDetailRow> {
  const sale = await db.get<Omit<SaleDetailRow, 'items' | 'debt'>>(
    `SELECT s.*,
            c.name AS customer_name,
            c.phone AS customer_phone,
            c.cpf AS customer_cpf,
            c.address AS customer_address,
            c.notes AS customer_notes
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.id = ?`,
    [id],
  );

  if (!sale) throw new AppError('Venda não encontrada.', 404, 'NOT_FOUND');

  const items = await db.all<Record<string, unknown>>(
    'SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC',
    [id],
  );

  const debt = await db.get<Record<string, unknown>>('SELECT * FROM debts WHERE sale_id = ?', [id]);

  let debtInstallments: unknown[] = [];
  if (debt) {
    debtInstallments = await db.all(
      'SELECT * FROM debt_installments WHERE debt_id = ? ORDER BY installment_number ASC',
      [debt.id as number],
    );
  }

  return {
    ...sale,
    items,
    debt: debt ? { ...debt, installments: debtInstallments } : null,
  };
}

export async function listSales(
  db: AppDatabase,
  options?: {
    from?: string;
    to?: string;
    status?: 'ALL' | 'COMPLETED' | 'CANCELLED';
    customerId?: number;
    limit?: number;
  },
) {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options?.from) {
    conditions.push('s.sale_date >= ?');
    params.push(options.from);
  }
  if (options?.to) {
    conditions.push('s.sale_date <= ?');
    params.push(options.to);
  }
  if (options?.status && options.status !== 'ALL') {
    conditions.push('s.status = ?');
    params.push(options.status);
  }
  if (options?.customerId) {
    conditions.push('s.customer_id = ?');
    params.push(options.customerId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 100;
  params.push(limit);

  return db.all(
    `SELECT s.*,
       c.name AS customer_name,
       c.cpf AS customer_cpf,
       d.remaining_cents AS debt_remaining_cents,
       d.status AS debt_status,
       (SELECT COUNT(*) FROM debt_installments di WHERE di.debt_id = d.id) AS installment_count,
       (SELECT di.amount_cents FROM debt_installments di WHERE di.debt_id = d.id ORDER BY di.installment_number ASC LIMIT 1) AS installment_amount_cents,
       (SELECT MIN(di.due_date) FROM debt_installments di WHERE di.debt_id = d.id AND di.status IN ('PENDING', 'PARTIAL')) AS next_due_date,
       (SELECT MIN(di.due_date) FROM debt_installments di WHERE di.debt_id = d.id) AS first_due_date,
       (SELECT MAX(di.due_date) FROM debt_installments di WHERE di.debt_id = d.id) AS last_due_date,
       (SELECT STRING_AGG(si.quantity::text || 'x ' || si.product_name_snapshot, ', ')
        FROM sale_items si WHERE si.sale_id = s.id) AS items_summary
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN debts d ON d.sale_id = s.id
     ${where}
     ORDER BY s.sale_date DESC, s.id DESC
     LIMIT ?`,
    params,
  );
}

async function createSaleInternal(db: AppDatabase, input: CreateSaleInput) {
  if (!input.items || input.items.length === 0) {
    throw new AppError('Escolha pelo menos 1 produto para vender.');
  }

  const key = input.idempotencyKey?.trim() || null;
  if (key) {
    const existing = await db.get<{ id: number }>('SELECT id FROM sales WHERE idempotency_key = ?', [
      key,
    ]);
    if (existing) {
      return getSaleById(db, existing.id);
    }
  }

  if ((input.saleType === 'FIADO' || input.saleType === 'INSTALLMENT') && !input.customerId) {
    throw new AppError('Escolha o cliente para venda fiada ou parcelada.');
  }

  if (input.customerId) {
    const customer = await db.get('SELECT id FROM customers WHERE id = ? AND is_active = 1', [
      input.customerId,
    ]);
    if (!customer) throw new AppError('Cliente não encontrado.', 404, 'CUSTOMER_NOT_FOUND');
  }

  const saleDate = input.saleDate || todayBR();
  const now = nowIso();

  const mergedMap = new Map<number, { productId: number; quantity: number; unitPriceCents?: number }>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError('A quantidade de cada produto precisa ser maior que zero.');
    }
    const prev = mergedMap.get(item.productId);
    if (prev) {
      prev.quantity += item.quantity;
      if (item.unitPriceCents !== undefined) prev.unitPriceCents = item.unitPriceCents;
    } else {
      mergedMap.set(item.productId, { ...item });
    }
  }

  const resolvedItems: Array<{
    productId: number;
    name: string;
    quantity: number;
    stockBefore: number;
    unitCostCents: number;
    unitPriceCents: number;
    subtotalCents: number;
    costSubtotalCents: number;
  }> = [];

  let itemsTotalCents = 0;
  let totalCostCents = 0;

  for (const item of mergedMap.values()) {
    const product = await db.get<{
      id: number;
      name: string;
      stock_qty: number;
      cost_cents: number;
      price_cents: number;
      is_active: number;
    }>('SELECT id, name, stock_qty, cost_cents, price_cents, is_active FROM products WHERE id = ?', [
      item.productId,
    ]);

    if (!product || product.is_active !== 1) {
      throw new AppError('Um dos produtos escolhidos não está disponível.');
    }
    if (product.stock_qty < item.quantity) {
      throw new AppError(`Estoque insuficiente de "${product.name}". Só tem ${product.stock_qty} no estoque.`);
    }

    const unitPrice =
      item.unitPriceCents !== undefined && Number.isInteger(item.unitPriceCents) && item.unitPriceCents > 0
        ? item.unitPriceCents
        : product.price_cents;

    const subtotalCents = unitPrice * item.quantity;
    const costSubtotalCents = product.cost_cents * item.quantity;

    itemsTotalCents += subtotalCents;
    totalCostCents += costSubtotalCents;

    resolvedItems.push({
      productId: product.id,
      name: product.name,
      quantity: item.quantity,
      stockBefore: product.stock_qty,
      unitCostCents: product.cost_cents,
      unitPriceCents: unitPrice,
      subtotalCents,
      costSubtotalCents,
    });
  }

  const discountCents = input.discountCents ?? 0;
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new AppError('Valor de desconto inválido.');
  }
  if (discountCents >= itemsTotalCents) {
    throw new AppError('O desconto não pode ser igual ou maior que o valor total dos produtos.');
  }

  const totalCents = itemsTotalCents - discountCents;
  const profitCents = totalCents - totalCostCents;
  const downPaymentCents = input.downPaymentCents ?? 0;
  if (!Number.isInteger(downPaymentCents) || downPaymentCents < 0) {
    throw new AppError('Valor de entrada inválido.');
  }

  let paidCents = 0;
  let storedPaymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'FIADO' = input.paymentMethod;

  if (input.saleType === 'CASH') {
    if (input.paymentMethod === 'FIADO') {
      throw new AppError('Para venda à vista, escolha Dinheiro, Pix ou Cartão.');
    }
    paidCents = totalCents;
  } else {
    if (downPaymentCents >= totalCents) {
      throw new AppError('A entrada é igual ou maior que o total. Use "À vista"!');
    }
    paidCents = downPaymentCents;
    storedPaymentMethod = downPaymentCents > 0 ? (input.downPaymentMethod || 'DINHEIRO') : 'FIADO';
  }

  const saleRes = await db.run(
    `INSERT INTO sales (
       customer_id, sale_type, payment_method, discount_cents, total_cents, total_cost_cents,
       profit_cents, paid_cents, status, sale_date, notes, idempotency_key, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)
     RETURNING id`,
    [
      input.customerId || null,
      input.saleType,
      storedPaymentMethod,
      discountCents,
      totalCents,
      totalCostCents,
      profitCents,
      paidCents,
      saleDate,
      input.notes?.trim() || null,
      key,
      now,
    ],
  );

  const saleId = saleRes.lastInsertRowid;

  for (const item of resolvedItems) {
    await db.run(
      `INSERT INTO sale_items (
         sale_id, product_id, product_name_snapshot, quantity,
         unit_cost_cents, unit_price_cents, subtotal_cents, cost_subtotal_cents
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleId,
        item.productId,
        item.name,
        item.quantity,
        item.unitCostCents,
        item.unitPriceCents,
        item.subtotalCents,
        item.costSubtotalCents,
      ],
    );

    const qtyAfter = item.stockBefore - item.quantity;
    await db.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [
      qtyAfter,
      now,
      item.productId,
    ]);

    await db.run(
      `INSERT INTO stock_movements (
         product_id, type, delta_qty, qty_after, unit_cost_cents, reason, reference_type, reference_id, created_at
       ) VALUES (?, 'SALE', ?, ?, ?, ?, 'SALE', ?, ?)`,
      [
        item.productId,
        -item.quantity,
        qtyAfter,
        item.unitCostCents,
        `Venda #${saleId}`,
        saleId,
        now,
      ],
    );
  }

  if (paidCents > 0) {
    const cashMethod =
      input.saleType === 'CASH'
        ? (input.paymentMethod === 'FIADO' ? 'DINHEIRO' : input.paymentMethod)
        : (input.downPaymentMethod || 'DINHEIRO');

    const desc =
      input.saleType === 'CASH'
        ? `Venda à vista #${saleId}`
        : `Entrada da venda #${saleId}`;

    await db.run(
      `INSERT INTO financial_transactions (
         direction, category, description, amount_cents, payment_method,
         reference_type, reference_id, transaction_date, created_at
       ) VALUES ('IN', 'CASH_SALE', ?, ?, ?, 'SALE', ?, ?, ?)`,
      [desc, paidCents, cashMethod, saleId, saleDate, now],
    );
  }

  if (input.saleType === 'FIADO' || input.saleType === 'INSTALLMENT') {
    const debtAmountCents = totalCents - paidCents;
    const summaryDesc = resolvedItems.map((i) => `${i.quantity}x ${i.name}`).join(', ');
    const debtDesc = `Venda #${saleId}: ${summaryDesc}`;

    const debtRes = await db.run(
      `INSERT INTO debts (
         customer_id, sale_id, description, total_cents, paid_cents, remaining_cents, status, created_at
       ) VALUES (?, ?, ?, ?, 0, ?, 'OPEN', ?)
       RETURNING id`,
      [input.customerId!, saleId, debtDesc, debtAmountCents, debtAmountCents, now],
    );

    const debtId = debtRes.lastInsertRowid;
    const installmentsToCreate = buildInstallmentsSchedule(
      input.saleType,
      debtAmountCents,
      saleDate,
      input,
    );

    for (let idx = 0; idx < installmentsToCreate.length; idx += 1) {
      const inst = installmentsToCreate[idx];
      await db.run(
        `INSERT INTO debt_installments (
           debt_id, installment_number, due_date, amount_cents, paid_cents, status
         ) VALUES (?, ?, ?, ?, 0, 'PENDING')`,
        [debtId, idx + 1, inst.dueDate, inst.amountCents],
      );
    }
  }

  return getSaleById(db, saleId);
}

export async function createSale(db: AppDatabase, input: CreateSaleInput) {
  return runInTransaction(db, () => createSaleInternal(db, input));
}

async function cancelSaleInternal(db: AppDatabase, saleId: number, reason?: string) {
  const sale = await db.get<{
    id: number;
    status: string;
    paid_cents: number;
    payment_method: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'FIADO';
    sale_type: string;
  }>('SELECT * FROM sales WHERE id = ?', [saleId]);

  if (!sale) throw new AppError('Venda não encontrada.', 404, 'NOT_FOUND');
  if (sale.status === 'CANCELLED') {
    throw new AppError('Esta venda já foi cancelada.');
  }

  const now = nowIso();
  const today = todayBR();

  const items = await db.all<{
    product_id: number;
    quantity: number;
    unit_cost_cents: number;
  }>('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]);

  for (const item of items) {
    const product = (await db.get<{ stock_qty: number }>(
      'SELECT stock_qty FROM products WHERE id = ?',
      [item.product_id],
    ))!;
    const nextQty = product.stock_qty + item.quantity;
    await db.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [
      nextQty,
      now,
      item.product_id,
    ]);
    await db.run(
      `INSERT INTO stock_movements (
         product_id, type, delta_qty, qty_after, unit_cost_cents, reason, reference_type, reference_id, created_at
       ) VALUES (?, 'SALE_CANCEL', ?, ?, ?, ?, 'SALE', ?, ?)`,
      [
        item.product_id,
        item.quantity,
        nextQty,
        item.unit_cost_cents,
        `Cancelamento venda #${saleId}`,
        saleId,
        now,
      ],
    );
  }

  if (sale.paid_cents > 0) {
    const refundMethod = sale.payment_method === 'FIADO' ? 'DINHEIRO' : sale.payment_method;
    await db.run(
      `INSERT INTO financial_transactions (
         direction, category, description, amount_cents, payment_method,
         reference_type, reference_id, transaction_date, created_at
       ) VALUES ('OUT', 'SALE_REFUND', ?, ?, ?, 'SALE', ?, ?, ?)`,
      [`Estorno venda #${saleId}`, sale.paid_cents, refundMethod, saleId, today, now],
    );
  }

  const debt = await db.get<{ id: number }>('SELECT * FROM debts WHERE sale_id = ?', [saleId]);

  if (debt) {
    const activePayments = await db.all<{
      id: number;
      amount_cents: number;
      payment_method: 'DINHEIRO' | 'PIX' | 'CARTAO';
    }>("SELECT * FROM debt_payments WHERE debt_id = ? AND status = 'ACTIVE'", [debt.id]);

    for (const pay of activePayments) {
      await db.run("UPDATE debt_payments SET status = 'REVERSED' WHERE id = ?", [pay.id]);
      await db.run(
        `INSERT INTO financial_transactions (
           direction, category, description, amount_cents, payment_method,
           reference_type, reference_id, transaction_date, created_at
         ) VALUES ('OUT', 'SALE_REFUND', ?, ?, ?, 'DEBT_PAYMENT', ?, ?, ?)`,
        [
          `Estorno recebimento fiado (venda #${saleId} cancelada)`,
          pay.amount_cents,
          pay.payment_method,
          pay.id,
          today,
          now,
        ],
      );
    }

    await db.run("UPDATE debt_installments SET status = 'CANCELLED' WHERE debt_id = ?", [debt.id]);
    await db.run("UPDATE debts SET status = 'CANCELLED', remaining_cents = 0 WHERE id = ?", [debt.id]);
  }

  await db.run(
    `UPDATE sales
     SET status = 'CANCELLED', cancel_reason = ?, cancelled_at = ?
     WHERE id = ?`,
    [reason?.trim() || 'Cancelada pelo usuário', now, saleId],
  );
}

export async function cancelSale(db: AppDatabase, saleId: number, reason?: string) {
  return runInTransaction(db, async () => {
    await cancelSaleInternal(db, saleId, reason);
    return getSaleById(db, saleId);
  });
}

export async function deleteSale(db: AppDatabase, saleId: number) {
  return runInTransaction(db, async () => {
    const sale = await db.get<{ id: number; status: string }>(
      'SELECT id, status FROM sales WHERE id = ?',
      [saleId],
    );
    if (!sale) throw new AppError('Venda não encontrada.', 404, 'NOT_FOUND');

    const now = nowIso();

    // Só devolve ao estoque se a venda ainda não tinha sido cancelada antes
    if (sale.status !== 'CANCELLED') {
      const items = await db.all<{ product_id: number; quantity: number }>(
        'SELECT product_id, quantity FROM sale_items WHERE sale_id = ?',
        [saleId],
      );
      for (const item of items) {
        const product = await db.get<{ stock_qty: number }>(
          'SELECT stock_qty FROM products WHERE id = ?',
          [item.product_id],
        );
        if (product) {
          await db.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [
            product.stock_qty + item.quantity,
            now,
            item.product_id,
          ]);
        }
      }
    }

    const debt = await db.get<{ id: number }>('SELECT id FROM debts WHERE sale_id = ?', [saleId]);
    if (debt) {
      const debtPays = await db.all<{ id: number }>(
        'SELECT id FROM debt_payments WHERE debt_id = ?',
        [debt.id],
      );
      for (const dp of debtPays) {
        await db.run(
          "DELETE FROM financial_transactions WHERE reference_type = 'DEBT_PAYMENT' AND reference_id = ?",
          [dp.id],
        );
      }
      await db.run('DELETE FROM debt_payments WHERE debt_id = ?', [debt.id]);
      await db.run('DELETE FROM debt_installments WHERE debt_id = ?', [debt.id]);
      await db.run('DELETE FROM debts WHERE id = ?', [debt.id]);
    }

    await db.run(
      "DELETE FROM financial_transactions WHERE reference_type = 'SALE' AND reference_id = ?",
      [saleId],
    );
    await db.run(
      "DELETE FROM stock_movements WHERE reference_type = 'SALE' AND reference_id = ?",
      [saleId],
    );
    await db.run('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    await db.run('DELETE FROM sales WHERE id = ?', [saleId]);

    return { deleted: true, id: saleId };
  });
}

export async function correctSale(
  db: AppDatabase,
  originalSaleId: number,
  correctedInput: CreateSaleInput,
) {
  return runInTransaction(db, async () => {
    await cancelSaleInternal(db, originalSaleId, 'Corrigida para nova venda');
    return createSaleInternal(db, {
      ...correctedInput,
      idempotencyKey: correctedInput.idempotencyKey || `correct-${originalSaleId}-${crypto.randomUUID()}`,
    });
  });
}

function buildInstallmentsSchedule(
  saleType: 'CASH' | 'FIADO' | 'INSTALLMENT',
  debtAmountCents: number,
  saleDate: string,
  input: CreateSaleInput,
): CustomInstallmentInput[] {
  if (saleType === 'FIADO') {
    const dueDate = input.dueDate || addDays(saleDate, 30);
    return [{ dueDate, amountCents: debtAmountCents }];
  }
  if (input.installments && input.installments.length > 0) {
    const sumInstallments = input.installments.reduce((acc, cur) => acc + cur.amountCents, 0);
    if (sumInstallments !== debtAmountCents) {
      throw new AppError('A soma das parcelas não bate com o valor restante da venda.');
    }
    return input.installments;
  }

  const count = input.installmentCount ?? 2;
  if (!Number.isInteger(count) || count < 1 || count > 36) {
    throw new AppError('Quantidade de parcelas inválida (1 a 36).');
  }
  const firstDue = input.firstDueDate || addMonthsClamped(saleDate, 1);
  const baseAmount = Math.floor(debtAmountCents / count);
  const remainder = debtAmountCents - baseAmount * count;

  const list: CustomInstallmentInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const amount = i === 0 ? baseAmount + remainder : baseAmount;
    list.push({
      dueDate: addMonthsClamped(firstDue, i),
      amountCents: amount,
    });
  }
  return list;
}

export async function updateSale(
  db: AppDatabase,
  saleId: number,
  input: CreateSaleInput,
): Promise<SaleDetailRow> {
  return runInTransaction(db, async () => {
    if (!input.items || input.items.length === 0) {
      throw new AppError('Escolha pelo menos 1 produto para manter na venda.');
    }

    const existing = await db.get<{
      id: number;
      status: string;
      sale_date: string;
    }>('SELECT * FROM sales WHERE id = ?', [saleId]);

    if (!existing) throw new AppError('Venda não encontrada.', 404, 'NOT_FOUND');
    if (existing.status === 'CANCELLED') {
      throw new AppError('Não é possível editar uma venda cancelada.');
    }

    if ((input.saleType === 'FIADO' || input.saleType === 'INSTALLMENT') && !input.customerId) {
      throw new AppError('Escolha o cliente para venda fiada ou parcelada.');
    }

    if (input.customerId) {
      const customer = await db.get('SELECT id FROM customers WHERE id = ? AND is_active = 1', [
        input.customerId,
      ]);
      if (!customer) throw new AppError('Cliente não encontrado.', 404, 'CUSTOMER_NOT_FOUND');
    }

    const saleDate = input.saleDate || existing.sale_date;
    const now = nowIso();

    const origItems = await db.all<{ product_id: number; quantity: number; unit_cost_cents: number }>(
      'SELECT product_id, quantity, unit_cost_cents FROM sale_items WHERE sale_id = ?',
      [saleId],
    );

    const origByProduct = new Map<number, { quantity: number; unitCostCents: number }>();
    for (const row of origItems) {
      const prev = origByProduct.get(row.product_id);
      if (prev) {
        prev.quantity += row.quantity;
      } else {
        origByProduct.set(row.product_id, {
          quantity: row.quantity,
          unitCostCents: row.unit_cost_cents,
        });
      }
    }

    const mergedMap = new Map<number, { productId: number; quantity: number; unitPriceCents?: number }>();
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new AppError('A quantidade de cada produto precisa ser maior que zero.');
      }
      const prev = mergedMap.get(item.productId);
      if (prev) {
        prev.quantity += item.quantity;
        if (item.unitPriceCents !== undefined) prev.unitPriceCents = item.unitPriceCents;
      } else {
        mergedMap.set(item.productId, { ...item });
      }
    }

    const resolvedItems: Array<{
      productId: number;
      name: string;
      quantity: number;
      unitCostCents: number;
      unitPriceCents: number;
      subtotalCents: number;
      costSubtotalCents: number;
    }> = [];

    let itemsTotalCents = 0;
    let totalCostCents = 0;

    for (const item of mergedMap.values()) {
      const product = await db.get<{
        id: number;
        name: string;
        stock_qty: number;
        cost_cents: number;
        price_cents: number;
        is_active: number;
      }>('SELECT id, name, stock_qty, cost_cents, price_cents, is_active FROM products WHERE id = ?', [
        item.productId,
      ]);

      const origInfo = origByProduct.get(item.productId);
      if (!product || (!origInfo && product.is_active !== 1)) {
        throw new AppError('Um dos produtos escolhidos não está disponível.');
      }

      const origQty = origInfo?.quantity ?? 0;
      const availableQty = product.stock_qty + origQty;
      if (availableQty < item.quantity) {
        throw new AppError(
          `Estoque insuficiente de "${product.name}". Só tem ${availableQty} no estoque.`,
        );
      }

      const unitPrice =
        item.unitPriceCents !== undefined && Number.isInteger(item.unitPriceCents) && item.unitPriceCents > 0
          ? item.unitPriceCents
          : product.price_cents;
      const unitCost = origInfo?.unitCostCents ?? product.cost_cents;
      const subtotalCents = unitPrice * item.quantity;
      const costSubtotalCents = unitCost * item.quantity;

      itemsTotalCents += subtotalCents;
      totalCostCents += costSubtotalCents;

      resolvedItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitCostCents: unitCost,
        unitPriceCents: unitPrice,
        subtotalCents,
        costSubtotalCents,
      });
    }

    const discountCents = input.discountCents ?? 0;
    if (!Number.isInteger(discountCents) || discountCents < 0) {
      throw new AppError('Valor de desconto inválido.');
    }
    if (discountCents >= itemsTotalCents) {
      throw new AppError('O desconto não pode ser igual ou maior que o valor total dos produtos.');
    }

    const totalCents = itemsTotalCents - discountCents;
    const profitCents = totalCents - totalCostCents;
    const downPaymentCents = input.downPaymentCents ?? 0;
    if (!Number.isInteger(downPaymentCents) || downPaymentCents < 0) {
      throw new AppError('Valor de entrada inválido.');
    }

    let paidCents = 0;
    let storedPaymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'FIADO' = input.paymentMethod;

    if (input.saleType === 'CASH') {
      if (input.paymentMethod === 'FIADO') {
        throw new AppError('Para venda à vista, escolha Dinheiro, Pix ou Cartão.');
      }
      paidCents = totalCents;
    } else {
      if (downPaymentCents >= totalCents) {
        throw new AppError('A entrada é igual ou maior que o total. Use "À vista"!');
      }
      paidCents = downPaymentCents;
      storedPaymentMethod = downPaymentCents > 0 ? (input.downPaymentMethod || 'DINHEIRO') : 'FIADO';
    }

    const origDebt = await db.get<{ id: number; paid_cents: number }>(
      'SELECT id, paid_cents FROM debts WHERE sale_id = ?',
      [saleId],
    );

    const alreadyPaidDebtCents = origDebt?.paid_cents ?? 0;
    if (alreadyPaidDebtCents > 0) {
      if (input.saleType === 'CASH') {
        throw new AppError(
          'Esta venda já teve pagamento de fiado recebido. Mantenha em Fiado/Parcelado ou cancele a venda.',
        );
      }
      const nextDebtTotal = totalCents - paidCents;
      if (nextDebtTotal < alreadyPaidDebtCents) {
        throw new AppError(
          `Esta venda já recebeu R$ ${(alreadyPaidDebtCents / 100).toFixed(2).replace('.', ',')} de fiado. O restante da dívida não pode ser menor que o valor já pago.`,
        );
      }
    }

    const newInstallments =
      input.saleType === 'CASH'
        ? []
        : buildInstallmentsSchedule(input.saleType, totalCents - paidCents, saleDate, input);

    const allProductIds = new Set<number>([...origByProduct.keys(), ...mergedMap.keys()]);
    for (const productId of allProductIds) {
      const origQty = origByProduct.get(productId)?.quantity ?? 0;
      const newQty = mergedMap.get(productId)?.quantity ?? 0;
      const diffStock = origQty - newQty;

      if (diffStock !== 0) {
        const product = (await db.get<{ stock_qty: number; cost_cents: number }>(
          'SELECT stock_qty, cost_cents FROM products WHERE id = ?',
          [productId],
        ))!;
        const nextQty = product.stock_qty + diffStock;
        const unitCost = origByProduct.get(productId)?.unitCostCents ?? product.cost_cents;

        await db.run('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?', [
          nextQty,
          now,
          productId,
        ]);

        const reason =
          diffStock > 0
            ? newQty === 0
              ? `Produto removido na edição da venda #${saleId}`
              : `Quantidade reduzida na edição da venda #${saleId}`
            : origQty === 0
              ? `Produto adicionado na edição da venda #${saleId}`
              : `Quantidade aumentada na edição da venda #${saleId}`;

        await db.run(
          `INSERT INTO stock_movements (
             product_id, type, delta_qty, qty_after, unit_cost_cents, reason, reference_type, reference_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'SALE', ?, ?)`,
          [
            productId,
            diffStock > 0 ? 'ADJUST' : 'SALE',
            diffStock,
            nextQty,
            unitCost,
            reason,
            saleId,
            now,
          ],
        );
      }
    }

    await db.run('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    for (const item of resolvedItems) {
      await db.run(
        `INSERT INTO sale_items (
           sale_id, product_id, product_name_snapshot, quantity,
           unit_cost_cents, unit_price_cents, subtotal_cents, cost_subtotal_cents
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          item.productId,
          item.name,
          item.quantity,
          item.unitCostCents,
          item.unitPriceCents,
          item.subtotalCents,
          item.costSubtotalCents,
        ],
      );
    }

    await db.run(
      `UPDATE sales
       SET customer_id = ?, sale_type = ?, payment_method = ?, discount_cents = ?,
           total_cents = ?, total_cost_cents = ?, profit_cents = ?, paid_cents = ?,
           sale_date = ?, notes = ?
       WHERE id = ?`,
      [
        input.customerId || null,
        input.saleType,
        storedPaymentMethod,
        discountCents,
        totalCents,
        totalCostCents,
        profitCents,
        paidCents,
        saleDate,
        input.notes?.trim() || null,
        saleId,
      ],
    );

    const existingFinTx = await db.get<{ id: number }>(
      `SELECT id FROM financial_transactions
       WHERE reference_type = 'SALE' AND reference_id = ? AND category = 'CASH_SALE' AND direction = 'IN'
       ORDER BY id DESC LIMIT 1`,
      [saleId],
    );

    if (paidCents > 0) {
      const cashMethod =
        input.saleType === 'CASH'
          ? (input.paymentMethod === 'FIADO' ? 'DINHEIRO' : input.paymentMethod)
          : (input.downPaymentMethod || 'DINHEIRO');
      const desc =
        input.saleType === 'CASH'
          ? `Venda à vista #${saleId}`
          : `Entrada da venda #${saleId}`;

      if (existingFinTx) {
        await db.run(
          `UPDATE financial_transactions
           SET description = ?, amount_cents = ?, payment_method = ?, transaction_date = ?
           WHERE id = ?`,
          [desc, paidCents, cashMethod, saleDate, existingFinTx.id],
        );
      } else {
        await db.run(
          `INSERT INTO financial_transactions (
             direction, category, description, amount_cents, payment_method,
             reference_type, reference_id, transaction_date, created_at
           ) VALUES ('IN', 'CASH_SALE', ?, ?, ?, 'SALE', ?, ?, ?)`,
          [desc, paidCents, cashMethod, saleId, saleDate, now],
        );
      }
    } else if (existingFinTx) {
      await db.run(
        `DELETE FROM financial_transactions
         WHERE reference_type = 'SALE' AND reference_id = ? AND category = 'CASH_SALE' AND direction = 'IN'`,
        [saleId],
      );
    }

    if (input.saleType === 'CASH') {
      if (origDebt) {
        await db.run('DELETE FROM debts WHERE id = ?', [origDebt.id]);
      }
    } else {
      const debtAmountCents = totalCents - paidCents;
      const remainingCents = debtAmountCents - alreadyPaidDebtCents;
      const debtStatus = remainingCents === 0 ? 'PAID' : 'OPEN';
      const settledAt = remainingCents === 0 ? now : null;
      const summaryDesc = resolvedItems.map((i) => `${i.quantity}x ${i.name}`).join(', ');
      const debtDesc = `Venda #${saleId}: ${summaryDesc}`;

      let debtId: number;
      if (origDebt) {
        debtId = origDebt.id;
        await db.run(
          `UPDATE debts
           SET customer_id = ?, description = ?, total_cents = ?, remaining_cents = ?, status = ?, settled_at = ?
           WHERE id = ?`,
          [input.customerId!, debtDesc, debtAmountCents, remainingCents, debtStatus, settledAt, debtId],
        );
      } else {
        const debtRes = await db.run(
          `INSERT INTO debts (
             customer_id, sale_id, description, total_cents, paid_cents, remaining_cents, status, created_at
           ) VALUES (?, ?, ?, ?, 0, ?, 'OPEN', ?)
           RETURNING id`,
          [input.customerId!, saleId, debtDesc, debtAmountCents, debtAmountCents, now],
        );
        debtId = debtRes.lastInsertRowid;
      }

      await db.run('DELETE FROM debt_installments WHERE debt_id = ?', [debtId]);
      let leftPaidToAllocate = alreadyPaidDebtCents;
      for (let idx = 0; idx < newInstallments.length; idx += 1) {
        const inst = newInstallments[idx];
        const instPaid = Math.min(inst.amountCents, leftPaidToAllocate);
        leftPaidToAllocate -= instPaid;
        const instStatus =
          instPaid >= inst.amountCents ? 'PAID' : instPaid > 0 ? 'PARTIAL' : 'PENDING';
        await db.run(
          `INSERT INTO debt_installments (
             debt_id, installment_number, due_date, amount_cents, paid_cents, status, paid_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            debtId,
            idx + 1,
            inst.dueDate,
            inst.amountCents,
            instPaid,
            instStatus,
            instStatus === 'PAID' ? now : null,
          ],
        );
      }
    }

    return getSaleById(db, saleId);
  });
}
