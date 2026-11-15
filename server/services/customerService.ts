import { AppError, type AppDatabase } from '../db/database.ts';
import { nowIso, todayBR } from '../utils/dates.ts';
import { matchesFlexibleSearch } from '../utils/search.ts';

export interface CustomerInput {
  name: string;
  phone?: string | null;
  cpf?: string | null;
  address?: string | null;
  notes?: string | null;
}

export async function listCustomers(
  db: AppDatabase,
  options?: { search?: string; filter?: 'all' | 'owing' | 'overdue' },
) {
  const today = todayBR();
  const rows = await db.all<{
    id: number;
    name: string;
    phone: string | null;
    cpf: string | null;
    address: string | null;
    notes: string | null;
    total_debt_cents: number;
    open_debts_count: number;
    overdue_installments_count: number;
    next_due_date: string | null;
    created_at: string;
  }>(
    `SELECT
       c.*,
       COALESCE((SELECT SUM(d.remaining_cents) FROM debts d WHERE d.customer_id = c.id AND d.status = 'OPEN'), 0) AS total_debt_cents,
       COALESCE((SELECT COUNT(*) FROM debts d WHERE d.customer_id = c.id AND d.status = 'OPEN'), 0) AS open_debts_count,
       COALESCE((
         SELECT COUNT(*)
         FROM debt_installments di
         JOIN debts d ON d.id = di.debt_id
         WHERE d.customer_id = c.id
           AND d.status = 'OPEN'
           AND di.status IN ('PENDING', 'PARTIAL')
           AND di.due_date < ?
       ), 0) AS overdue_installments_count,
       (
         SELECT MIN(di.due_date)
         FROM debt_installments di
         JOIN debts d ON d.id = di.debt_id
         WHERE d.customer_id = c.id
           AND d.status = 'OPEN'
           AND di.status IN ('PENDING', 'PARTIAL')
       ) AS next_due_date
     FROM customers c
     WHERE c.is_active = 1
     ORDER BY total_debt_cents DESC, LOWER(c.name) ASC`,
    [today],
  );

  let filtered = rows;
  if (options?.search?.trim()) {
    filtered = filtered.filter((r) =>
      matchesFlexibleSearch(
        options.search!,
        [r.name, r.phone, r.cpf, r.address, r.notes],
        [r.phone, r.cpf],
      ),
    );
  }
  if (options?.filter === 'owing') {
    filtered = filtered.filter((r) => r.total_debt_cents > 0);
  } else if (options?.filter === 'overdue') {
    filtered = filtered.filter((r) => r.overdue_installments_count > 0);
  }

  return filtered;
}

export async function createCustomer(db: AppDatabase, input: CustomerInput) {
  const name = input.name.trim();
  if (!name) throw new AppError('Informe o nome do cliente.');

  const res = await db.run(
    `INSERT INTO customers (name, phone, cpf, address, notes, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     RETURNING id`,
    [
      name,
      input.phone?.trim() || null,
      input.cpf?.trim() || null,
      input.address?.trim() || null,
      input.notes?.trim() || null,
      nowIso(),
    ],
  );

  return db.get('SELECT * FROM customers WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateCustomer(db: AppDatabase, id: number, input: CustomerInput) {
  const existing = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
  if (!existing) throw new AppError('Cliente não encontrado.', 404, 'NOT_FOUND');

  const name = input.name.trim();
  if (!name) throw new AppError('Informe o nome do cliente.');

  await db.run(
    'UPDATE customers SET name = ?, phone = ?, cpf = ?, address = ?, notes = ? WHERE id = ?',
    [
      name,
      input.phone?.trim() || null,
      input.cpf?.trim() || null,
      input.address?.trim() || null,
      input.notes?.trim() || null,
      id,
    ],
  );

  return db.get('SELECT * FROM customers WHERE id = ?', [id]);
}

export async function deleteCustomer(db: AppDatabase, id: number) {
  const existing = await db.get('SELECT id FROM customers WHERE id = ? AND is_active = 1', [id]);
  if (!existing) throw new AppError('Cliente não encontrado.', 404, 'NOT_FOUND');

  const openDebt = (await db.get<{ remaining: number }>(
    "SELECT COALESCE(SUM(remaining_cents), 0) AS remaining FROM debts WHERE customer_id = ? AND status = 'OPEN'",
    [id],
  )) ?? { remaining: 0 };

  if (openDebt.remaining > 0) {
    throw new AppError(
      'Este cliente ainda tem fiado ou parcelamento em aberto. Quite ou cancele a venda antes de excluir.',
    );
  }

  const salesCount = (await db.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM sales WHERE customer_id = ?',
    [id],
  )) ?? { cnt: 0 };
  const debtsCount = (await db.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM debts WHERE customer_id = ?',
    [id],
  )) ?? { cnt: 0 };

  if (salesCount.cnt === 0 && debtsCount.cnt === 0) {
    await db.run('DELETE FROM customers WHERE id = ?', [id]);
  } else {
    await db.run('UPDATE customers SET is_active = 0 WHERE id = ?', [id]);
  }

  return { deleted: true, id };
}

export async function getCustomerDetail(db: AppDatabase, id: number) {
  const today = todayBR();
  const customer = await db.get<{
    id: number;
    name: string;
    phone: string | null;
    cpf: string | null;
    address: string | null;
    notes: string | null;
    created_at: string;
  }>('SELECT * FROM customers WHERE id = ? AND is_active = 1', [id]);

  if (!customer) throw new AppError('Cliente não encontrado.', 404, 'NOT_FOUND');

  const debts = await db.all<{
    id: number;
    customer_id: number;
    sale_id: number | null;
    description: string;
    total_cents: number;
    paid_cents: number;
    remaining_cents: number;
    status: string;
    created_at: string;
    settled_at: string | null;
    sale_date: string | null;
    sale_type: string | null;
  }>(
    `SELECT d.*, s.sale_date, s.sale_type
     FROM debts d
     LEFT JOIN sales s ON s.id = d.sale_id
     WHERE d.customer_id = ? AND d.status != 'CANCELLED'
     ORDER BY CASE WHEN d.status = 'OPEN' THEN 0 ELSE 1 END, d.id DESC`,
    [id],
  );

  const debtsWithInstallments = await Promise.all(
    debts.map(async (debt) => {
      const installments = await db.all<{
        id: number;
        debt_id: number;
        installment_number: number;
        due_date: string;
        amount_cents: number;
        paid_cents: number;
        status: string;
        paid_at: string | null;
      }>('SELECT * FROM debt_installments WHERE debt_id = ? ORDER BY installment_number ASC', [
        debt.id,
      ]);

      return {
        ...debt,
        installments: installments.map((inst) => ({
          ...inst,
          is_overdue: (inst.status === 'PENDING' || inst.status === 'PARTIAL') && inst.due_date < today,
        })),
      };
    }),
  );

  const payments = await db.all(
    `SELECT dp.*, d.description AS debt_description
     FROM debt_payments dp
     JOIN debts d ON d.id = dp.debt_id
     WHERE dp.customer_id = ? AND dp.status = 'ACTIVE'
     ORDER BY dp.payment_date DESC, dp.id DESC`,
    [id],
  );

  const sales = await db.all(
    `SELECT s.*,
       (SELECT STRING_AGG(si.quantity::text || 'x ' || si.product_name_snapshot, ', ')
        FROM sale_items si WHERE si.sale_id = s.id) AS items_summary
     FROM sales s
     WHERE s.customer_id = ?
     ORDER BY s.sale_date DESC, s.id DESC`,
    [id],
  );

  const totalRemainingCents = debtsWithInstallments
    .filter((d) => d.status === 'OPEN')
    .reduce((acc, d) => acc + d.remaining_cents, 0);

  return {
    customer,
    totalRemainingCents,
    debts: debtsWithInstallments,
    payments,
    sales,
  };
}
