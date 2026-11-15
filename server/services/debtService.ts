import { AppError, runInTransaction, type AppDatabase } from '../db/database.ts';
import { nowIso, todayBR } from '../utils/dates.ts';

export interface ReceiveDebtPaymentInput {
  customerId: number;
  debtId?: number;
  amountCents: number;
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO';
  paymentDate?: string;
  notes?: string | null;
  idempotencyKey: string;
}

export async function listOpenDebtsSummary(db: AppDatabase) {
  const today = todayBR();
  return db.all(
    `SELECT d.*,
       c.name AS customer_name,
       c.phone AS customer_phone,
       (SELECT MIN(di.due_date) FROM debt_installments di WHERE di.debt_id = d.id AND di.status IN ('PENDING', 'PARTIAL')) AS next_due_date,
       (SELECT COUNT(*) FROM debt_installments di WHERE di.debt_id = d.id AND di.status IN ('PENDING', 'PARTIAL') AND di.due_date < ?) AS overdue_count
     FROM debts d
     JOIN customers c ON c.id = d.customer_id
     WHERE d.status = 'OPEN'
     ORDER BY overdue_count DESC, next_due_date ASC, d.id ASC`,
    [today],
  );
}

async function allocatePaymentToDebt(
  db: AppDatabase,
  debtId: number,
  customerId: number,
  amountCents: number,
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO',
  paymentDate: string,
  notes: string | null,
  idempotencyKey: string,
  now: string,
) {
  const debt = await db.get<{
    id: number;
    description: string;
    total_cents: number;
    paid_cents: number;
    remaining_cents: number;
  }>("SELECT * FROM debts WHERE id = ? AND customer_id = ? AND status = 'OPEN'", [
    debtId,
    customerId,
  ]);

  if (!debt) {
    throw new AppError('Dívida não encontrada ou já quitada.', 404, 'DEBT_NOT_FOUND');
  }
  if (amountCents > debt.remaining_cents) {
    throw new AppError('O valor informado é maior que o saldo restante desta dívida.');
  }

  const installments = await db.all<{
    id: number;
    amount_cents: number;
    paid_cents: number;
  }>(
    `SELECT * FROM debt_installments
     WHERE debt_id = ? AND status IN ('PENDING', 'PARTIAL')
     ORDER BY due_date ASC, installment_number ASC`,
    [debtId],
  );

  let toAllocate = amountCents;
  for (const inst of installments) {
    if (toAllocate <= 0) break;
    const instRemaining = inst.amount_cents - inst.paid_cents;
    if (instRemaining <= 0) continue;

    const applied = Math.min(toAllocate, instRemaining);
    const newInstPaid = inst.paid_cents + applied;
    const newInstStatus = newInstPaid >= inst.amount_cents ? 'PAID' : 'PARTIAL';

    await db.run(
      `UPDATE debt_installments
       SET paid_cents = ?, status = ?, paid_at = ?
       WHERE id = ?`,
      [newInstPaid, newInstStatus, newInstStatus === 'PAID' ? now : null, inst.id],
    );

    toAllocate -= applied;
  }

  const newPaid = debt.paid_cents + amountCents;
  const newRemaining = debt.total_cents - newPaid;
  const isSettled = newRemaining === 0;

  await db.run(
    `UPDATE debts
     SET paid_cents = ?, remaining_cents = ?, status = ?, settled_at = ?
     WHERE id = ?`,
    [newPaid, newRemaining, isSettled ? 'PAID' : 'OPEN', isSettled ? now : null, debtId],
  );

  const payRes = await db.run(
    `INSERT INTO debt_payments (
       debt_id, customer_id, amount_cents, payment_method, payment_date,
       notes, idempotency_key, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
     RETURNING id`,
    [debtId, customerId, amountCents, paymentMethod, paymentDate, notes, idempotencyKey, now],
  );

  const paymentId = payRes.lastInsertRowid;

  const customer = (await db.get<{ name: string }>('SELECT name FROM customers WHERE id = ?', [
    customerId,
  ]))!;

  await db.run(
    `INSERT INTO financial_transactions (
       direction, category, description, amount_cents, payment_method,
       reference_type, reference_id, transaction_date, created_at
     ) VALUES ('IN', 'DEBT_PAYMENT', ?, ?, ?, 'DEBT_PAYMENT', ?, ?, ?)`,
    [
      `Recebimento fiado: ${customer.name} (${debt.description})`,
      amountCents,
      paymentMethod,
      paymentId,
      paymentDate,
      now,
    ],
  );

  return { paymentId, newRemaining, settled: isSettled };
}

export async function receiveDebtPayment(db: AppDatabase, input: ReceiveDebtPaymentInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AppError('Informe um valor de pagamento maior que zero.');
  }
  const key = input.idempotencyKey?.trim();
  if (!key) {
    throw new AppError('Chave de segurança do pagamento ausente.');
  }

  return runInTransaction(db, async () => {
    const existing = await db.get<{ id: number; debt_id: number; amount_cents: number }>(
      'SELECT id, debt_id, amount_cents FROM debt_payments WHERE idempotency_key = ?',
      [key],
    );

    if (existing) {
      return {
        duplicated: true,
        paymentIds: [existing.id],
        paidCents: existing.amount_cents,
      };
    }

    const existingPrefix = await db.all<{ id: number; amount_cents: number }>(
      'SELECT id, amount_cents FROM debt_payments WHERE idempotency_key LIKE ?',
      [`${key}-%`],
    );

    if (existingPrefix.length > 0) {
      return {
        duplicated: true,
        paymentIds: existingPrefix.map((p) => p.id),
        paidCents: existingPrefix.reduce((a, p) => a + p.amount_cents, 0),
      };
    }

    const paymentDate = input.paymentDate || todayBR();
    const notes = input.notes?.trim() || null;
    const now = nowIso();

    if (input.debtId) {
      const res = await allocatePaymentToDebt(
        db,
        input.debtId,
        input.customerId,
        input.amountCents,
        input.paymentMethod,
        paymentDate,
        notes,
        key,
        now,
      );
      return {
        duplicated: false,
        paymentIds: [res.paymentId],
        paidCents: input.amountCents,
        remainingCents: res.newRemaining,
        settled: res.settled,
      };
    }

    const openDebts = await db.all<{ id: number; remaining_cents: number }>(
      `SELECT id, remaining_cents FROM debts
       WHERE customer_id = ? AND status = 'OPEN'
       ORDER BY id ASC`,
      [input.customerId],
    );

    const totalRemaining = openDebts.reduce((acc, d) => acc + d.remaining_cents, 0);
    if (totalRemaining <= 0) {
      throw new AppError('Este cliente não tem dívidas em aberto.');
    }
    if (input.amountCents > totalRemaining) {
      throw new AppError('O valor informado é maior que a dívida total do cliente.');
    }

    let left = input.amountCents;
    const paymentIds: number[] = [];
    let index = 0;

    for (const d of openDebts) {
      if (left <= 0) break;
      const slice = Math.min(left, d.remaining_cents);
      const subKey = openDebts.length === 1 && slice === input.amountCents ? key : `${key}-${index}`;
      const res = await allocatePaymentToDebt(
        db,
        d.id,
        input.customerId,
        slice,
        input.paymentMethod,
        paymentDate,
        notes,
        subKey,
        now,
      );
      paymentIds.push(res.paymentId);
      left -= slice;
      index += 1;
    }

    const remainingAfter = totalRemaining - input.amountCents;
    return {
      duplicated: false,
      paymentIds,
      paidCents: input.amountCents,
      remainingCents: remainingAfter,
      settled: remainingAfter === 0,
    };
  });
}

export async function reverseDebtPayment(db: AppDatabase, paymentId: number) {
  return runInTransaction(db, async () => {
    const payment = await db.get<{
      id: number;
      debt_id: number;
      customer_id: number;
      amount_cents: number;
    }>("SELECT * FROM debt_payments WHERE id = ? AND status = 'ACTIVE'", [paymentId]);

    if (!payment) {
      throw new AppError('Pagamento não encontrado ou já estornado.', 404, 'NOT_FOUND');
    }

    const debt = await db.get<{ id: number; total_cents: number; status: string }>(
      'SELECT * FROM debts WHERE id = ?',
      [payment.debt_id],
    );

    if (!debt || debt.status === 'CANCELLED') {
      throw new AppError('A dívida vinculada a este pagamento foi cancelada.');
    }

    await db.run("UPDATE debt_payments SET status = 'REVERSED' WHERE id = ?", [paymentId]);
    await db.run(
      "DELETE FROM financial_transactions WHERE reference_type = 'DEBT_PAYMENT' AND reference_id = ?",
      [paymentId],
    );

    const activePaidRow = (await db.get<{ total_paid: number }>(
      "SELECT COALESCE(SUM(amount_cents), 0) AS total_paid FROM debt_payments WHERE debt_id = ? AND status = 'ACTIVE'",
      [debt.id],
    )) ?? { total_paid: 0 };

    const newPaid = Math.min(debt.total_cents, activePaidRow.total_paid);
    const newRemaining = Math.max(0, debt.total_cents - newPaid);
    const isSettled = newRemaining === 0;
    const now = nowIso();

    await db.run(
      `UPDATE debts
       SET paid_cents = ?, remaining_cents = ?, status = ?, settled_at = ?
       WHERE id = ?`,
      [newPaid, newRemaining, isSettled ? 'PAID' : 'OPEN', isSettled ? now : null, debt.id],
    );

    const installments = await db.all<{ id: number; amount_cents: number }>(
      `SELECT id, amount_cents
       FROM debt_installments
       WHERE debt_id = ? AND status != 'CANCELLED'
       ORDER BY due_date ASC, installment_number ASC`,
      [debt.id],
    );

    let pool = newPaid;
    for (const inst of installments) {
      const applied = Math.min(pool, inst.amount_cents);
      const status = applied >= inst.amount_cents ? 'PAID' : applied > 0 ? 'PARTIAL' : 'PENDING';
      await db.run(
        'UPDATE debt_installments SET paid_cents = ?, status = ?, paid_at = ? WHERE id = ?',
        [applied, status, status === 'PAID' ? now : null, inst.id],
      );
      pool -= applied;
    }

    return {
      reversed: true,
      paymentId,
      amountCents: payment.amount_cents,
      remainingCents: newRemaining,
    };
  });
}
