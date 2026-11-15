import { AppError, runInTransaction, type AppDatabase } from '../db/database.ts';
import { currentMonthBR, monthEnd, monthStart, nowIso, todayBR } from '../utils/dates.ts';
import { reverseDebtPayment } from './debtService.ts';
import { ensureMonthlyRentCharges, reverseRentPayment } from './rentalService.ts';
import { deleteSale } from './saleService.ts';

export interface ManualTransactionInput {
  direction: 'IN' | 'OUT';
  category: 'EXPENSE' | 'STOCK_PURCHASE' | 'OTHER_IN' | 'ADJUSTMENT';
  description: string;
  amountCents: number;
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO';
  transactionDate?: string;
  dueDate?: string | null;
}

export interface UpdateTransactionInput {
  direction: 'IN' | 'OUT';
  category:
    | 'EXPENSE'
    | 'STOCK_PURCHASE'
    | 'OTHER_IN'
    | 'ADJUSTMENT'
    | 'RENT_PAYMENT'
    | 'DEBT_PAYMENT';
  description: string;
  amountCents: number;
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO';
  transactionDate?: string;
  dueDate?: string | null;
}

export async function getHomeDashboard(db: AppDatabase) {
  await ensureMonthlyRentCharges(db);
  const today = todayBR();
  const ym = currentMonthBR();
  const mStart = monthStart(ym);
  const mEnd = monthEnd(ym);

  const [
    receivedTodayRowRaw,
    salesTodayRowRaw,
    fiadosReceivableRowRaw,
    overdueFiadosRowRaw,
    rentsReceivableRowRaw,
    lowStockRowRaw,
    cashBalanceRowRaw,
    monthSalesRowRaw,
  ] = await Promise.all([
    db.get<{ in_today: number; refunds_today: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE 0 END), 0) AS in_today,
         COALESCE(SUM(CASE WHEN direction = 'OUT' AND category = 'SALE_REFUND' THEN amount_cents ELSE 0 END), 0) AS refunds_today
       FROM financial_transactions
       WHERE transaction_date = ?`,
      [today],
    ),
    db.get<{
      count_today: number;
      total_today: number;
      profit_today: number;
    }>(
      `SELECT
         COUNT(*) AS count_today,
         COALESCE(SUM(total_cents), 0) AS total_today,
         COALESCE(SUM(profit_cents), 0) AS profit_today
       FROM sales
       WHERE status = 'COMPLETED' AND sale_date = ?`,
      [today],
    ),
    db.get<{ total: number }>(
      "SELECT COALESCE(SUM(remaining_cents), 0) AS total FROM debts WHERE status = 'OPEN'",
    ),
    db.get<{ customers_overdue: number }>(
      `SELECT COUNT(DISTINCT d.customer_id) AS customers_overdue
       FROM debt_installments di
       JOIN debts d ON d.id = di.debt_id
       WHERE d.status = 'OPEN' AND di.status IN ('PENDING', 'PARTIAL') AND di.due_date < ?`,
      [today],
    ),
    db.get<{ total: number; overdue_count: number }>(
      `SELECT
         COALESCE(SUM(amount_cents - paid_cents), 0) AS total,
         COALESCE(SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END), 0) AS overdue_count
       FROM rent_charges
       WHERE status IN ('PENDING', 'PARTIAL')`,
      [today],
    ),
    db.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM products WHERE is_active = 1 AND stock_qty <= min_stock_qty',
    ),
    db.get<{ balance: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE -amount_cents END), 0) AS balance
       FROM financial_transactions`,
    ),
    db.get<{ total: number }>(
      `SELECT COALESCE(SUM(total_cents), 0) AS total
       FROM sales
       WHERE status = 'COMPLETED' AND sale_date BETWEEN ? AND ?`,
      [mStart, mEnd],
    ),
  ]);

  const receivedTodayRow = receivedTodayRowRaw ?? { in_today: 0, refunds_today: 0 };
  const salesTodayRow = salesTodayRowRaw ?? { count_today: 0, total_today: 0, profit_today: 0 };
  const fiadosReceivableRow = fiadosReceivableRowRaw ?? { total: 0 };
  const overdueFiadosRow = overdueFiadosRowRaw ?? { customers_overdue: 0 };
  const rentsReceivableRow = rentsReceivableRowRaw ?? { total: 0, overdue_count: 0 };
  const lowStockRow = lowStockRowRaw ?? { cnt: 0 };
  const cashBalanceRow = cashBalanceRowRaw ?? { balance: 0 };
  const monthSalesRow = monthSalesRowRaw ?? { total: 0 };

  return {
    today,
    receivedTodayCents: Math.max(0, receivedTodayRow.in_today - receivedTodayRow.refunds_today),
    salesTodayCount: salesTodayRow.count_today,
    salesTodayCents: salesTodayRow.total_today,
    profitTodayCents: salesTodayRow.profit_today,
    monthSalesCents: monthSalesRow.total,
    fiadosReceivableCents: fiadosReceivableRow.total,
    customersOverdueCount: overdueFiadosRow.customers_overdue,
    rentsReceivableCents: rentsReceivableRow.total,
    rentsOverdueCount: rentsReceivableRow.overdue_count,
    totalReceivableCents: fiadosReceivableRow.total + rentsReceivableRow.total,
    lowStockCount: lowStockRow.cnt,
    cashBalanceCents: cashBalanceRow.balance,
  };
}

export async function getFinanceSummary(
  db: AppDatabase,
  options?: { from?: string; to?: string; category?: string; direction?: string },
) {
  await ensureMonthlyRentCharges(db);
  const today = todayBR();
  const ym = currentMonthBR();
  const from = options?.from || monthStart(ym);
  const to = options?.to || monthEnd(ym);

  const txConditions = ['ft.transaction_date BETWEEN ? AND ?'];
  const txParams: Array<string | number> = [from, to];

  if (options?.category && options.category !== 'ALL') {
    txConditions.push('ft.category = ?');
    txParams.push(options.category);
  }
  if (options?.direction && options.direction !== 'ALL') {
    txConditions.push('ft.direction = ?');
    txParams.push(options.direction);
  }

  const [
    periodCashRowRaw,
    periodSalesRowRaw,
    todayRowRaw,
    fiadosReceivableRaw,
    rentsReceivableRaw,
    globalBalanceRaw,
    methodRows,
    transactions,
    sales,
    debtPayments,
  ] = await Promise.all([
    db.get<Record<string, number>>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE 0 END), 0) AS total_in,
         COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_cents ELSE 0 END), 0) AS total_out,
         COALESCE(SUM(CASE WHEN category = 'CASH_SALE' THEN amount_cents ELSE 0 END), 0) AS cash_sales_in,
         COALESCE(SUM(CASE WHEN category = 'DEBT_PAYMENT' THEN amount_cents ELSE 0 END), 0) AS debt_payments_in,
         COALESCE(SUM(CASE WHEN category = 'RENT_PAYMENT' THEN amount_cents ELSE 0 END), 0) AS rent_payments_in,
         COALESCE(SUM(CASE WHEN category = 'OTHER_IN' THEN amount_cents ELSE 0 END), 0) AS other_in,
         COALESCE(SUM(CASE WHEN direction = 'IN' AND category = 'ADJUSTMENT' THEN amount_cents ELSE 0 END), 0) AS adj_in,
         COALESCE(SUM(CASE WHEN category = 'EXPENSE' THEN amount_cents ELSE 0 END), 0) AS expenses_out,
         COALESCE(SUM(CASE WHEN category = 'STOCK_PURCHASE' THEN amount_cents ELSE 0 END), 0) AS stock_purchases_out,
         COALESCE(SUM(CASE WHEN category = 'SALE_REFUND' THEN amount_cents ELSE 0 END), 0) AS refunds_out,
         COALESCE(SUM(CASE WHEN direction = 'OUT' AND category = 'ADJUSTMENT' THEN amount_cents ELSE 0 END), 0) AS adj_out
       FROM financial_transactions
       WHERE transaction_date BETWEEN ? AND ?`,
      [from, to],
    ),
    db.get<Record<string, number>>(
      `SELECT
         COUNT(*) AS sales_count,
         COALESCE(SUM(total_cents), 0) AS sales_total,
         COALESCE(SUM(total_cost_cents), 0) AS sales_cost,
         COALESCE(SUM(profit_cents), 0) AS gross_profit
       FROM sales
       WHERE status = 'COMPLETED' AND sale_date BETWEEN ? AND ?`,
      [from, to],
    ),
    db.get<{ in_today: number; refund_today: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE 0 END), 0) AS in_today,
         COALESCE(SUM(CASE WHEN direction = 'OUT' AND category = 'SALE_REFUND' THEN amount_cents ELSE 0 END), 0) AS refund_today
       FROM financial_transactions
       WHERE transaction_date = ?`,
      [today],
    ),
    db.get<{ total: number }>(
      "SELECT COALESCE(SUM(remaining_cents), 0) AS total FROM debts WHERE status = 'OPEN'",
    ),
    db.get<{ total: number }>(
      "SELECT COALESCE(SUM(amount_cents - paid_cents), 0) AS total FROM rent_charges WHERE status IN ('PENDING', 'PARTIAL')",
    ),
    db.get<{ balance: number }>(
      "SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE -amount_cents END), 0) AS balance FROM financial_transactions",
    ),
    db.all<{ payment_method: string; in_cents: number; out_cents: number }>(
      `SELECT
         payment_method,
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE 0 END), 0) AS in_cents,
         COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_cents ELSE 0 END), 0) AS out_cents
       FROM financial_transactions
       WHERE transaction_date BETWEEN ? AND ?
       GROUP BY payment_method`,
      [from, to],
    ),
    db.all(
      `SELECT
         ft.*,
         COALESCE(cs.id, cd.id) AS customer_id,
         COALESCE(cs.name, cd.name) AS customer_name,
         COALESCE(cs.cpf, cd.cpf) AS customer_cpf,
         COALESCE(s.id, d.sale_id) AS sale_id,
         s.sale_type AS sale_type,
         s.status AS sale_status,
         CASE
           WHEN s.id IS NOT NULL THEN (
             SELECT STRING_AGG(si.quantity::text || 'x ' || si.product_name_snapshot, ', ')
             FROM sale_items si WHERE si.sale_id = s.id
           )
           WHEN d.id IS NOT NULL THEN d.description
           ELSE NULL
         END AS items_summary,
         prop.id AS property_id,
         prop.name AS property_name,
         l.tenant_name AS tenant_name
       FROM financial_transactions ft
       LEFT JOIN sales s ON ft.reference_type = 'SALE' AND s.id = ft.reference_id
       LEFT JOIN customers cs ON cs.id = s.customer_id
       LEFT JOIN debt_payments dp ON ft.reference_type = 'DEBT_PAYMENT' AND dp.id = ft.reference_id
       LEFT JOIN debts d ON d.id = dp.debt_id
       LEFT JOIN customers cd ON cd.id = dp.customer_id
       LEFT JOIN rent_payments rp ON ft.reference_type = 'RENT_PAYMENT' AND rp.id = ft.reference_id
       LEFT JOIN properties prop ON prop.id = rp.property_id
       LEFT JOIN leases l ON l.id = rp.lease_id
       WHERE ${txConditions.join(' AND ')}
       ORDER BY ft.transaction_date DESC, ft.id DESC
       LIMIT 200`,
      txParams,
    ),
    db.all(
      `SELECT s.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
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
       WHERE s.sale_date BETWEEN ? AND ?
       ORDER BY s.sale_date DESC, s.id DESC
       LIMIT 200`,
      [from, to],
    ),
    db.all(
      `SELECT dp.id, dp.debt_id, dp.customer_id, dp.amount_cents, dp.payment_method,
         dp.payment_date, dp.notes, dp.status, dp.created_at,
         c.name AS customer_name, c.phone AS customer_phone, c.cpf AS customer_cpf,
         d.description AS debt_description, d.sale_id,
         d.total_cents AS debt_total_cents, d.remaining_cents AS debt_remaining_cents,
         d.status AS debt_status
       FROM debt_payments dp
       JOIN customers c ON c.id = dp.customer_id
       JOIN debts d ON d.id = dp.debt_id
       WHERE dp.payment_date BETWEEN ? AND ?
       ORDER BY dp.payment_date DESC, dp.id DESC
       LIMIT 200`,
      [from, to],
    ),
  ]);

  const periodCashRow = periodCashRowRaw!;
  const periodSalesRow = periodSalesRowRaw!;
  const todayRow = todayRowRaw ?? { in_today: 0, refund_today: 0 };
  const fiadosReceivable = fiadosReceivableRaw ?? { total: 0 };
  const rentsReceivable = rentsReceivableRaw ?? { total: 0 };
  const globalBalance = globalBalanceRaw ?? { balance: 0 };

  const paymentMethodTotals = {
    DINHEIRO: { inCents: 0, outCents: 0 },
    PIX: { inCents: 0, outCents: 0 },
    CARTAO: { inCents: 0, outCents: 0 },
  };
  for (const row of methodRows) {
    if (row.payment_method === 'DINHEIRO' || row.payment_method === 'PIX' || row.payment_method === 'CARTAO') {
      paymentMethodTotals[row.payment_method] = {
        inCents: row.in_cents,
        outCents: row.out_cents,
      };
    }
  }

  return {
    period: { from, to },
    receivedTodayCents: Math.max(0, todayRow.in_today - todayRow.refund_today),
    cashBalanceCents: globalBalance.balance,
    fiadosReceivableCents: fiadosReceivable.total,
    rentsReceivableCents: rentsReceivable.total,
    totalReceivableCents: fiadosReceivable.total + rentsReceivable.total,
    paymentMethodTotals,
    periodStats: {
      totalInCents: periodCashRow.total_in,
      totalOutCents: periodCashRow.total_out,
      netFlowCents: periodCashRow.total_in - periodCashRow.total_out,
      cashSalesInCents: periodCashRow.cash_sales_in,
      debtPaymentsInCents: periodCashRow.debt_payments_in,
      rentPaymentsInCents: periodCashRow.rent_payments_in,
      otherInCents: periodCashRow.other_in,
      adjustmentsInCents: periodCashRow.adj_in,
      otherRevenuesCents:
        periodCashRow.rent_payments_in + periodCashRow.other_in + periodCashRow.adj_in,
      expensesOutCents: periodCashRow.expenses_out,
      adjustmentsOutCents: periodCashRow.adj_out,
      operatingExpensesCents: periodCashRow.expenses_out + periodCashRow.adj_out,
      stockPurchasesOutCents: periodCashRow.stock_purchases_out,
      refundsOutCents: periodCashRow.refunds_out,
      salesCount: periodSalesRow.sales_count,
      salesTotalCents: periodSalesRow.sales_total,
      salesCostCents: periodSalesRow.sales_cost,
      grossProfitCents: periodSalesRow.gross_profit,
      netProfitCents:
        periodSalesRow.gross_profit +
        periodCashRow.rent_payments_in +
        periodCashRow.other_in +
        periodCashRow.adj_in -
        (periodCashRow.expenses_out + periodCashRow.adj_out),
    },
    transactions,
    sales,
    debtPayments,
  };
}

function validateManualTransactionInput(input: ManualTransactionInput): string {
  const desc = input.description.trim();
  if (!desc) throw new AppError('Escreva uma descrição curta.');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AppError('Informe um valor maior que zero.');
  }
  if (input.direction === 'IN' && input.category !== 'OTHER_IN' && input.category !== 'ADJUSTMENT') {
    throw new AppError('Categoria inválida para entrada manual.');
  }
  if (
    input.direction === 'OUT' &&
    input.category !== 'EXPENSE' &&
    input.category !== 'STOCK_PURCHASE' &&
    input.category !== 'ADJUSTMENT'
  ) {
    throw new AppError('Categoria inválida para saída.');
  }
  return desc;
}

export async function createManualTransaction(db: AppDatabase, input: ManualTransactionInput) {
  const desc = validateManualTransactionInput(input);
  const txDate = input.transactionDate || todayBR();
  const dueDate = input.dueDate?.trim() ? input.dueDate.trim() : null;
  const res = await db.run(
    `INSERT INTO financial_transactions (
       direction, category, description, amount_cents, payment_method,
       reference_type, reference_id, transaction_date, due_date, created_at
     ) VALUES (?, ?, ?, ?, ?, 'MANUAL', NULL, ?, ?, ?)
     RETURNING id`,
    [input.direction, input.category, desc, input.amountCents, input.paymentMethod, txDate, dueDate, nowIso()],
  );

  return db.get('SELECT * FROM financial_transactions WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateManualTransaction(
  db: AppDatabase,
  id: number,
  input: UpdateTransactionInput,
) {
  return runInTransaction(db, async () => {
    const existing = await db.get<{
      id: number;
      direction: 'IN' | 'OUT';
      category: string;
      amount_cents: number;
      reference_type: string;
      reference_id: number | null;
      transaction_date: string;
      due_date: string | null;
    }>(
      `SELECT id, direction, category, amount_cents, reference_type, reference_id, transaction_date, due_date
       FROM financial_transactions WHERE id = ?`,
      [id],
    );

    if (!existing) {
      throw new AppError('Lançamento não encontrado.', 404, 'NOT_FOUND');
    }

    const desc = input.description.trim();
    if (!desc) throw new AppError('Escreva uma descrição curta.');
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new AppError('Informe um valor maior que zero.');
    }

    const txDate = input.transactionDate || existing.transaction_date || todayBR();
    const dueDate =
      input.dueDate === undefined
        ? existing.due_date
        : input.dueDate?.trim()
          ? input.dueDate.trim()
          : null;

    if (existing.reference_type === 'SALE') {
      throw new AppError('Para editar uma venda, abra os detalhes dela e toque em Editar Venda.');
    }

    if (existing.reference_type === 'MANUAL') {
      if (
        input.category !== 'EXPENSE' &&
        input.category !== 'STOCK_PURCHASE' &&
        input.category !== 'OTHER_IN' &&
        input.category !== 'ADJUSTMENT'
      ) {
        throw new AppError('Categoria inválida para lançamento manual.');
      }
      validateManualTransactionInput({
        ...input,
        category: input.category,
      });

      await db.run(
        `UPDATE financial_transactions
         SET direction = ?, category = ?, description = ?, amount_cents = ?,
             payment_method = ?, transaction_date = ?, due_date = ?
         WHERE id = ?`,
        [
          input.direction,
          input.category,
          desc,
          input.amountCents,
          input.paymentMethod,
          txDate,
          dueDate,
          id,
        ],
      );
      return db.get('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    }

    if (existing.reference_type === 'STOCK_MOVEMENT') {
      await db.run(
        `UPDATE financial_transactions
         SET description = ?, amount_cents = ?, payment_method = ?, transaction_date = ?, due_date = ?
         WHERE id = ?`,
        [desc, input.amountCents, input.paymentMethod, txDate, dueDate, id],
      );
      return db.get('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    }

    if (existing.reference_type === 'RENT_PAYMENT' && existing.reference_id) {
      const rp = await db.get<{ id: number; rent_charge_id: number }>(
        'SELECT id, rent_charge_id FROM rent_payments WHERE id = ?',
        [existing.reference_id],
      );
      if (rp) {
        const charge = await db.get<{ id: number; amount_cents: number; status: string }>(
          'SELECT id, amount_cents, status FROM rent_charges WHERE id = ?',
          [rp.rent_charge_id],
        );
        const otherSumRow = (await db.get<{ total: number }>(
          'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM rent_payments WHERE rent_charge_id = ? AND id != ?',
          [rp.rent_charge_id, rp.id],
        )) ?? { total: 0 };

        if (charge && otherSumRow.total + input.amountCents > charge.amount_cents) {
          throw new AppError('O valor ultrapassa o total da cobrança desse aluguel.');
        }

        await db.run(
          'UPDATE rent_payments SET amount_cents = ?, payment_method = ?, payment_date = ? WHERE id = ?',
          [input.amountCents, input.paymentMethod, txDate, rp.id],
        );

        if (charge && charge.status !== 'CANCELLED') {
          const newPaid = otherSumRow.total + input.amountCents;
          const newStatus =
            newPaid <= 0 ? 'PENDING' : newPaid >= charge.amount_cents ? 'PAID' : 'PARTIAL';
          await db.run('UPDATE rent_charges SET paid_cents = ?, status = ? WHERE id = ?', [
            newPaid,
            newStatus,
            charge.id,
          ]);
        }
      }

      await db.run(
        `UPDATE financial_transactions
         SET description = ?, amount_cents = ?, payment_method = ?, transaction_date = ?, due_date = ?
         WHERE id = ?`,
        [desc, input.amountCents, input.paymentMethod, txDate, dueDate, id],
      );
      return db.get('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    }

    if (existing.reference_type === 'DEBT_PAYMENT') {
      if (input.amountCents !== existing.amount_cents) {
        throw new AppError(
          'Para alterar o valor de um pagamento de fiado, estorne o pagamento e registre o novo valor.',
        );
      }
      if (existing.reference_id) {
        await db.run('UPDATE debt_payments SET payment_method = ?, payment_date = ? WHERE id = ?', [
          input.paymentMethod,
          txDate,
          existing.reference_id,
        ]);
      }
      await db.run(
        `UPDATE financial_transactions
         SET description = ?, payment_method = ?, transaction_date = ?, due_date = ?
         WHERE id = ?`,
        [desc, input.paymentMethod, txDate, dueDate, id],
      );
      return db.get('SELECT * FROM financial_transactions WHERE id = ?', [id]);
    }

    throw new AppError('Este lançamento não pode ser editado.');
  });
}

export async function deleteManualTransaction(db: AppDatabase, id: number) {
  const existing = await db.get<{
    id: number;
    reference_type: string;
    reference_id: number | null;
  }>('SELECT id, reference_type, reference_id FROM financial_transactions WHERE id = ?', [id]);

  if (!existing) {
    throw new AppError('Lançamento não encontrado.', 404, 'NOT_FOUND');
  }

  if (existing.reference_type === 'RENT_PAYMENT' && existing.reference_id) {
    try {
      await reverseRentPayment(db, existing.reference_id);
      return { deleted: true, id };
    } catch {
      // Fallback if rent_payment row no longer exists
    }
  }

  if (existing.reference_type === 'DEBT_PAYMENT' && existing.reference_id) {
    try {
      await reverseDebtPayment(db, existing.reference_id);
      return { deleted: true, id };
    } catch {
      // Fallback if already reversed
    }
  }

  if (existing.reference_type === 'SALE' && existing.reference_id) {
    try {
      await deleteSale(db, existing.reference_id);
      return { deleted: true, id };
    } catch {
      // Fallback if sale row was already removed
    }
  }

  await db.run('DELETE FROM financial_transactions WHERE id = ?', [id]);
  return { deleted: true, id };
}

export async function getDreReport(db: AppDatabase, options?: { from?: string; to?: string }) {
  await ensureMonthlyRentCharges(db);
  const today = todayBR();
  const ym = currentMonthBR();
  const from = options?.from || monthStart(ym);
  const to = options?.to || monthEnd(ym);

  const salesRow = (await db.get<Record<string, number>>(
    `SELECT
       COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS total_count,
       COUNT(CASE WHEN status = 'COMPLETED' AND sale_type = 'CASH' THEN 1 END) AS cash_count,
       COUNT(CASE WHEN status = 'COMPLETED' AND sale_type != 'CASH' THEN 1 END) AS credit_count,
       COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled_count,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_cents + discount_cents ELSE 0 END), 0) AS gross_products_subtotal,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN discount_cents ELSE 0 END), 0) AS discounts_cents,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_cents ELSE 0 END), 0) AS net_revenue_cents,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND sale_type = 'CASH' THEN total_cents ELSE 0 END), 0) AS cash_sales_total,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND sale_type != 'CASH' THEN total_cents ELSE 0 END), 0) AS credit_sales_total,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' AND sale_type != 'CASH' THEN paid_cents ELSE 0 END), 0) AS down_payments_cents,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN total_cost_cents ELSE 0 END), 0) AS cmv_cents,
       COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN profit_cents ELSE 0 END), 0) AS gross_profit_cents
     FROM sales
     WHERE sale_date BETWEEN ? AND ?`,
    [from, to],
  ))!;

  const cashAgg = (await db.get<Record<string, number>>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE 0 END), 0) AS total_in,
       COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_cents ELSE 0 END), 0) AS total_out,
       COALESCE(SUM(CASE WHEN category = 'CASH_SALE' THEN amount_cents ELSE 0 END), 0) AS cash_sales_in,
       COALESCE(SUM(CASE WHEN category = 'DEBT_PAYMENT' THEN amount_cents ELSE 0 END), 0) AS debt_payments_in,
       COALESCE(SUM(CASE WHEN category = 'RENT_PAYMENT' THEN amount_cents ELSE 0 END), 0) AS rent_payments_in,
       COALESCE(SUM(CASE WHEN category = 'OTHER_IN' THEN amount_cents ELSE 0 END), 0) AS other_in,
       COALESCE(SUM(CASE WHEN direction = 'IN' AND category = 'ADJUSTMENT' THEN amount_cents ELSE 0 END), 0) AS adj_in,
       COALESCE(SUM(CASE WHEN category = 'EXPENSE' THEN amount_cents ELSE 0 END), 0) AS expenses_out,
       COALESCE(SUM(CASE WHEN category = 'STOCK_PURCHASE' THEN amount_cents ELSE 0 END), 0) AS stock_purchases_out,
       COALESCE(SUM(CASE WHEN category = 'SALE_REFUND' THEN amount_cents ELSE 0 END), 0) AS refunds_out,
       COALESCE(SUM(CASE WHEN direction = 'OUT' AND category = 'ADJUSTMENT' THEN amount_cents ELSE 0 END), 0) AS adj_out
     FROM financial_transactions
     WHERE transaction_date BETWEEN ? AND ?`,
    [from, to],
  ))!;

  const methodRows = await db.all<{ payment_method: string; in_cents: number; out_cents: number }>(
    `SELECT
       payment_method,
       COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE 0 END), 0) AS in_cents,
       COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount_cents ELSE 0 END), 0) AS out_cents
     FROM financial_transactions
     WHERE transaction_date BETWEEN ? AND ?
     GROUP BY payment_method`,
    [from, to],
  );

  const byMethod = {
    DINHEIRO: { inCents: 0, outCents: 0, netCents: 0 },
    PIX: { inCents: 0, outCents: 0, netCents: 0 },
    CARTAO: { inCents: 0, outCents: 0, netCents: 0 },
  };
  for (const row of methodRows) {
    if (row.payment_method === 'DINHEIRO' || row.payment_method === 'PIX' || row.payment_method === 'CARTAO') {
      byMethod[row.payment_method] = {
        inCents: row.in_cents,
        outCents: row.out_cents,
        netCents: row.in_cents - row.out_cents,
      };
    }
  }

  const globalBalance = (await db.get<{ balance: number }>(
    "SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount_cents ELSE -amount_cents END), 0) AS balance FROM financial_transactions",
  )) ?? { balance: 0 };

  const fiadosOpenRow = (await db.get<{ total: number }>(
    "SELECT COALESCE(SUM(remaining_cents), 0) AS total FROM debts WHERE status = 'OPEN'",
  )) ?? { total: 0 };

  const fiadosOverdueRow = (await db.get<{ overdue: number }>(
    `SELECT COALESCE(SUM(di.amount_cents - di.paid_cents), 0) AS overdue
     FROM debt_installments di
     JOIN debts d ON d.id = di.debt_id
     WHERE d.status = 'OPEN' AND di.status IN ('PENDING', 'PARTIAL') AND di.due_date < ?`,
    [today],
  )) ?? { overdue: 0 };

  const rentsReceivableRow = (await db.get<{ total: number; overdue: number }>(
    `SELECT
       COALESCE(SUM(amount_cents - paid_cents), 0) AS total,
       COALESCE(SUM(CASE WHEN due_date < ? THEN amount_cents - paid_cents ELSE 0 END), 0) AS overdue
     FROM rent_charges
     WHERE status IN ('PENDING', 'PARTIAL')`,
    [today],
  )) ?? { total: 0, overdue: 0 };

  const inventoryRow = (await db.get<{
    total_units: number;
    cost_value: number;
    sale_value: number;
  }>(
    `SELECT
       COALESCE(SUM(stock_qty), 0) AS total_units,
       COALESCE(SUM(stock_qty * cost_cents), 0) AS cost_value,
       COALESCE(SUM(stock_qty * price_cents), 0) AS sale_value
     FROM products
     WHERE is_active = 1`,
  )) ?? { total_units: 0, cost_value: 0, sale_value: 0 };

  const expenseItems = await db.all(
    `SELECT id, transaction_date AS date, description, payment_method, amount_cents, category
     FROM financial_transactions
     WHERE transaction_date BETWEEN ? AND ?
       AND (category = 'EXPENSE' OR (direction = 'OUT' AND category = 'ADJUSTMENT'))
     ORDER BY transaction_date ASC, id ASC`,
    [from, to],
  );

  const stockPurchaseItems = await db.all(
    `SELECT id, transaction_date AS date, description, payment_method, amount_cents
     FROM financial_transactions
     WHERE transaction_date BETWEEN ? AND ? AND category = 'STOCK_PURCHASE'
     ORDER BY transaction_date ASC, id ASC`,
    [from, to],
  );

  const otherInItems = await db.all(
    `SELECT id, transaction_date AS date, description, payment_method, amount_cents, category
     FROM financial_transactions
     WHERE transaction_date BETWEEN ? AND ?
       AND (category = 'OTHER_IN' OR (direction = 'IN' AND category = 'ADJUSTMENT'))
     ORDER BY transaction_date ASC, id ASC`,
    [from, to],
  );

  const rentItems = await db.all(
    `SELECT rp.id, rp.payment_date AS date, p.name AS property_name, l.tenant_name,
       rc.reference_month, rp.payment_method, rp.amount_cents
     FROM rent_payments rp
     JOIN properties p ON p.id = rp.property_id
     JOIN leases l ON l.id = rp.lease_id
     JOIN rent_charges rc ON rc.id = rp.rent_charge_id
     WHERE rp.payment_date BETWEEN ? AND ?
     ORDER BY rp.payment_date ASC, rp.id ASC`,
    [from, to],
  );

  const topProducts = await db.all(
    `SELECT
       si.product_id,
       MAX(si.product_name_snapshot) AS product_name,
       SUM(si.quantity) AS qty_sold,
       SUM(si.subtotal_cents) AS revenue_cents,
       SUM(si.cost_subtotal_cents) AS cost_cents,
       SUM(si.subtotal_cents - si.cost_subtotal_cents) AS profit_cents
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'COMPLETED' AND s.sale_date BETWEEN ? AND ?
     GROUP BY si.product_id
     ORDER BY revenue_cents DESC, qty_sold DESC
     LIMIT 20`,
    [from, to],
  );

  const netSalesRevenue = salesRow.net_revenue_cents;
  const grossSalesProfit = salesRow.gross_profit_cents;
  const grossMarginPct =
    netSalesRevenue > 0 ? Number(((grossSalesProfit / netSalesRevenue) * 100).toFixed(1)) : 0;

  const totalOtherRevenuesCents = cashAgg.rent_payments_in + cashAgg.other_in + cashAgg.adj_in;
  const totalOperatingExpensesCents = cashAgg.expenses_out + cashAgg.adj_out;
  const grossOperatingResultCents = grossSalesProfit + totalOtherRevenuesCents;
  const netOperatingResultCents = grossOperatingResultCents - totalOperatingExpensesCents;
  const totalOperatingRevenueBase = netSalesRevenue + totalOtherRevenuesCents;
  const netMarginPct =
    totalOperatingRevenueBase > 0
      ? Number(((netOperatingResultCents / totalOperatingRevenueBase) * 100).toFixed(1))
      : 0;

  return {
    period: { from, to },
    sales: {
      totalCount: salesRow.total_count,
      cashCount: salesRow.cash_count,
      creditCount: salesRow.credit_count,
      cancelledCount: salesRow.cancelled_count,
      grossProductsSubtotalCents: salesRow.gross_products_subtotal,
      discountsCents: salesRow.discounts_cents,
      netRevenueCents: netSalesRevenue,
      cashSalesTotalCents: salesRow.cash_sales_total,
      creditSalesTotalCents: salesRow.credit_sales_total,
      downPaymentsCents: salesRow.down_payments_cents,
      cmvCents: salesRow.cmv_cents,
      grossProfitCents: grossSalesProfit,
      grossMarginPct,
    },
    otherRevenues: {
      rentReceivedCents: cashAgg.rent_payments_in,
      otherInCents: cashAgg.other_in,
      adjustmentsInCents: cashAgg.adj_in,
      totalOtherRevenuesCents,
    },
    expenses: {
      expensesOutCents: cashAgg.expenses_out,
      adjustmentsOutCents: cashAgg.adj_out,
      totalOperatingExpensesCents,
      stockPurchasesOutCents: cashAgg.stock_purchases_out,
      refundsOutCents: cashAgg.refunds_out,
    },
    result: {
      grossOperatingResultCents,
      netOperatingResultCents,
      netMarginPct,
    },
    cashFlow: {
      cashSalesInCents: cashAgg.cash_sales_in,
      debtPaymentsInCents: cashAgg.debt_payments_in,
      rentPaymentsInCents: cashAgg.rent_payments_in,
      otherInCents: cashAgg.other_in + cashAgg.adj_in,
      totalInCents: cashAgg.total_in,
      expensesOutCents: cashAgg.expenses_out,
      stockPurchasesOutCents: cashAgg.stock_purchases_out,
      refundsOutCents: cashAgg.refunds_out,
      adjustmentsOutCents: cashAgg.adj_out,
      totalOutCents: cashAgg.total_out,
      netCashFlowCents: cashAgg.total_in - cashAgg.total_out,
      currentCashBalanceCents: globalBalance.balance,
      byMethod,
    },
    receivablesAndInventory: {
      fiadosOpenCents: fiadosOpenRow.total,
      fiadosOverdueCents: fiadosOverdueRow.overdue,
      rentsOpenCents: rentsReceivableRow.total,
      rentsOverdueCents: rentsReceivableRow.overdue,
      totalReceivableCents: fiadosOpenRow.total + rentsReceivableRow.total,
      inventoryTotalUnits: inventoryRow.total_units,
      inventoryCostValueCents: inventoryRow.cost_value,
      inventorySaleValueCents: inventoryRow.sale_value,
    },
    declaredDetails: {
      expenseItems,
      stockPurchaseItems,
      otherInItems,
      rentItems,
      topProducts,
    },
  };
}
