import { AppError, runInTransaction, type AppDatabase } from '../db/database.ts';
import {
  clampDayInMonth,
  currentMonthBR,
  enumerateMonths,
  nowIso,
  todayBR,
} from '../utils/dates.ts';

export interface CreatePropertyInput {
  name: string;
  address?: string | null;
  photoUrl?: string | null;
  monthlyRentCents: number;
  dueDay: number;
  notes?: string | null;
}

export interface StartLeaseInput {
  propertyId: number;
  tenantName: string;
  tenantPhone?: string | null;
  tenantDoc?: string | null;
  monthlyRentCents?: number;
  dueDay?: number;
  startDate?: string;
  notes?: string | null;
}

export interface ReceiveRentPaymentInput {
  rentChargeId: number;
  amountCents: number;
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO';
  paymentDate?: string;
  notes?: string | null;
  idempotencyKey: string;
}

export interface ReceiveLeaseMonthPaymentInput {
  leaseId: number;
  referenceMonth: string;
  amountCents: number;
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO';
  paymentDate?: string;
  notes?: string | null;
  idempotencyKey: string;
}

export interface UpdateLeaseInput {
  tenantName: string;
  tenantPhone?: string | null;
  tenantDoc?: string | null;
  monthlyRentCents: number;
  dueDay: number;
  notes?: string | null;
}

export interface RentPaymentResult {
  duplicated: boolean;
  paymentId: number;
  paidCents: number;
  remainingCents: number;
  settled: boolean;
}

function decorateChargeStatus<T extends { status: string; due_date: string; amount_cents: number; paid_cents: number }>(
  charge: T,
  today: string,
) {
  const remaining_cents = Math.max(0, charge.amount_cents - charge.paid_cents);
  let display_status: 'PAGO' | 'PENDENTE' | 'ATRASADO' | 'CANCELADO' = 'PENDENTE';
  if (charge.status === 'PAID') {
    display_status = 'PAGO';
  } else if (charge.status === 'CANCELLED') {
    display_status = 'CANCELADO';
  } else if (charge.due_date < today) {
    display_status = 'ATRASADO';
  } else {
    display_status = 'PENDENTE';
  }
  return {
    ...charge,
    remaining_cents,
    display_status,
  };
}

function addOneMonthYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

export async function ensureMonthlyRentCharges(
  db: AppDatabase,
  upToMonth = currentMonthBR(),
): Promise<number> {
  const [activeLeases, existingRows] = await Promise.all([
    db.all<{
      id: number;
      property_id: number;
      monthly_rent_cents: number;
      due_day: number;
      start_date: string;
    }>("SELECT * FROM leases WHERE status = 'ACTIVE'"),
    db.all<{ lease_id: number; reference_month: string; status: string }>(
      'SELECT lease_id, reference_month, status FROM rent_charges',
    ),
  ]);

  const statusByKey = new Map<string, string>();
  for (const r of existingRows) {
    statusByKey.set(`${r.lease_id}:${r.reference_month}`, r.status);
  }

  let createdCount = 0;
  const now = nowIso();

  const insertChargeIfMissing = async (
    lease: (typeof activeLeases)[number],
    ym: string,
  ) => {
    const key = `${lease.id}:${ym}`;
    if (statusByKey.has(key)) return;
    const dueDate = clampDayInMonth(ym, lease.due_day);
    const res = await db.run(
      `INSERT INTO rent_charges (
         lease_id, property_id, reference_month, due_date, amount_cents, paid_cents, status, created_at
       ) VALUES (?, ?, ?, ?, ?, 0, 'PENDING', ?)
       ON CONFLICT (lease_id, reference_month) DO NOTHING`,
      [lease.id, lease.property_id, ym, dueDate, lease.monthly_rent_cents, now],
    );
    statusByKey.set(key, 'PENDING');
    if (res.changes > 0) {
      createdCount += 1;
    }
  };

  for (const lease of activeLeases) {
    const startMonth = lease.start_date.slice(0, 7);
    if (startMonth <= upToMonth) {
      const months = enumerateMonths(startMonth, upToMonth);
      for (const ym of months) {
        await insertChargeIfMissing(lease, ym);
      }
    }

    // Se o mês atual (ou adiantados) já estiver quitado, lança o próximo mês como pendente
    let probeYm = upToMonth;
    for (let i = 0; i < 24; i++) {
      if (statusByKey.get(`${lease.id}:${probeYm}`) !== 'PAID') break;
      const nextYm = addOneMonthYM(probeYm);
      await insertChargeIfMissing(lease, nextYm);
      probeYm = nextYm;
    }
  }

  return createdCount;
}

export async function listProperties(
  db: AppDatabase,
  options?: { skipEnsure?: boolean },
) {
  if (!options?.skipEnsure) {
    await ensureMonthlyRentCharges(db);
  }
  const today = todayBR();

  const [properties, activeLeases, openCharges, nonCancelledCharges] = await Promise.all([
    db.all<{
      id: number;
      name: string;
      address: string | null;
      photo_url: string | null;
      monthly_rent_cents: number;
      due_day: number;
      status: 'AVAILABLE' | 'OCCUPIED' | 'INACTIVE';
      notes: string | null;
      created_at: string;
    }>("SELECT * FROM properties WHERE status != 'INACTIVE' ORDER BY LOWER(name) ASC"),
    db.all<{
      id: number;
      property_id: number;
      tenant_name: string;
      tenant_phone: string | null;
      monthly_rent_cents: number;
      due_day: number;
      start_date: string;
    }>("SELECT * FROM leases WHERE status = 'ACTIVE' ORDER BY id DESC"),
    db.all<{
      id: number;
      property_id: number;
      reference_month: string;
      due_date: string;
      amount_cents: number;
      paid_cents: number;
      status: string;
    }>(
      `SELECT * FROM rent_charges
       WHERE status IN ('PENDING', 'PARTIAL')
       ORDER BY reference_month ASC`,
    ),
    db.all<{
      id: number;
      property_id: number;
      reference_month: string;
      due_date: string;
      amount_cents: number;
      paid_cents: number;
      status: string;
    }>(
      `SELECT * FROM rent_charges
       WHERE status != 'CANCELLED'
       ORDER BY reference_month DESC`,
    ),
  ]);

  const activeLeaseByProp = new Map<number, (typeof activeLeases)[number]>();
  for (const lease of activeLeases) {
    if (!activeLeaseByProp.has(lease.property_id)) {
      activeLeaseByProp.set(lease.property_id, lease);
    }
  }

  const openChargesByProp = new Map<number, typeof openCharges>();
  for (const charge of openCharges) {
    const arr = openChargesByProp.get(charge.property_id);
    if (arr) arr.push(charge);
    else openChargesByProp.set(charge.property_id, [charge]);
  }

  const latestChargeByProp = new Map<number, (typeof nonCancelledCharges)[number]>();
  for (const charge of nonCancelledCharges) {
    if (!latestChargeByProp.has(charge.property_id)) {
      latestChargeByProp.set(charge.property_id, charge);
    }
  }

  return properties.map((prop) => {
    const activeLease = activeLeaseByProp.get(prop.id) ?? null;
    const decoratedOpen = (openChargesByProp.get(prop.id) ?? []).map((c) =>
      decorateChargeStatus(c, today),
    );
    const totalDebtCents = decoratedOpen.reduce((acc, c) => acc + c.remaining_cents, 0);
    const hasOverdue = decoratedOpen.some((c) => c.display_status === 'ATRASADO');
    const latestCharge = latestChargeByProp.get(prop.id) ?? null;

    let currentStatus: 'LIVRE' | 'PAGO' | 'PENDENTE' | 'ATRASADO' = 'LIVRE';
    if (activeLease) {
      if (hasOverdue) currentStatus = 'ATRASADO';
      else if (totalDebtCents > 0) currentStatus = 'PENDENTE';
      else currentStatus = 'PAGO';
    } else if (totalDebtCents > 0) {
      currentStatus = hasOverdue ? 'ATRASADO' : 'PENDENTE';
    }

    return {
      ...prop,
      active_lease: activeLease,
      total_debt_cents: totalDebtCents,
      open_charges_count: decoratedOpen.length,
      current_status: currentStatus,
      latest_charge: latestCharge ? decorateChargeStatus(latestCharge, today) : null,
    };
  });
}

export async function createProperty(db: AppDatabase, input: CreatePropertyInput) {
  const name = input.name.trim();
  if (!name) throw new AppError('Informe o nome ou número da casinha/imóvel.');
  if (!Number.isInteger(input.monthlyRentCents) || input.monthlyRentCents <= 0) {
    throw new AppError('Valor do aluguel precisa ser maior que zero.');
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) {
    throw new AppError('Dia de vencimento inválido (1 a 31).');
  }

  const res = await db.run(
    `INSERT INTO properties (name, address, photo_url, monthly_rent_cents, due_day, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, 'AVAILABLE', ?, ?)
     RETURNING id`,
    [
      name,
      input.address?.trim() || null,
      input.photoUrl || null,
      input.monthlyRentCents,
      input.dueDay,
      input.notes?.trim() || null,
      nowIso(),
    ],
  );

  return db.get('SELECT * FROM properties WHERE id = ?', [res.lastInsertRowid]);
}

export async function updateProperty(db: AppDatabase, id: number, input: CreatePropertyInput) {
  const prop = await db.get<{ id: number; photo_url: string | null }>(
    'SELECT * FROM properties WHERE id = ?',
    [id],
  );
  if (!prop) throw new AppError('Imóvel não encontrado.', 404, 'NOT_FOUND');

  const name = input.name.trim();
  if (!name) throw new AppError('Informe o nome ou número do imóvel.');
  if (!Number.isInteger(input.monthlyRentCents) || input.monthlyRentCents <= 0) {
    throw new AppError('Valor do aluguel inválido.');
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) {
    throw new AppError('Dia de vencimento inválido.');
  }

  await runInTransaction(db, async () => {
    await db.run(
      `UPDATE properties
       SET name = ?, address = ?, photo_url = ?, monthly_rent_cents = ?, due_day = ?, notes = ?
       WHERE id = ?`,
      [
        name,
        input.address?.trim() || null,
        input.photoUrl === undefined ? prop.photo_url : input.photoUrl,
        input.monthlyRentCents,
        input.dueDay,
        input.notes?.trim() || null,
        id,
      ],
    );

    await db.run(
      `UPDATE leases SET monthly_rent_cents = ?, due_day = ?
       WHERE property_id = ? AND status = 'ACTIVE'`,
      [input.monthlyRentCents, input.dueDay, id],
    );
  });

  return db.get('SELECT * FROM properties WHERE id = ?', [id]);
}

export async function startLease(db: AppDatabase, input: StartLeaseInput) {
  const tenantName = input.tenantName.trim();
  if (!tenantName) throw new AppError('Informe o nome do inquilino.');

  return runInTransaction(db, async () => {
    const prop = await db.get<{
      id: number;
      monthly_rent_cents: number;
      due_day: number;
      status: string;
    }>('SELECT * FROM properties WHERE id = ?', [input.propertyId]);

    if (!prop) throw new AppError('Imóvel não encontrado.', 404, 'NOT_FOUND');

    const existingActive = await db.get(
      "SELECT id FROM leases WHERE property_id = ? AND status = 'ACTIVE'",
      [input.propertyId],
    );
    if (existingActive) {
      throw new AppError('Este imóvel já está alugado. Encerre a locação atual antes.');
    }

    const monthlyRentCents =
      input.monthlyRentCents && input.monthlyRentCents > 0
        ? input.monthlyRentCents
        : prop.monthly_rent_cents;
    const dueDay =
      input.dueDay && input.dueDay >= 1 && input.dueDay <= 31 ? input.dueDay : prop.due_day;
    const startDate = input.startDate || todayBR();

    const leaseRes = await db.run(
      `INSERT INTO leases (
         property_id, tenant_name, tenant_phone, tenant_doc,
         monthly_rent_cents, due_day, start_date, status, notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
       RETURNING id`,
      [
        input.propertyId,
        tenantName,
        input.tenantPhone?.trim() || null,
        input.tenantDoc?.trim() || null,
        monthlyRentCents,
        dueDay,
        startDate,
        input.notes?.trim() || null,
        nowIso(),
      ],
    );

    await db.run(
      "UPDATE properties SET status = 'OCCUPIED', monthly_rent_cents = ?, due_day = ? WHERE id = ?",
      [monthlyRentCents, dueDay, input.propertyId],
    );

    await ensureMonthlyRentCharges(db);

    return leaseRes.lastInsertRowid;
  });
}

export async function endLease(db: AppDatabase, leaseId: number, cancelUnpaidFuture = true) {
  return runInTransaction(db, async () => {
    const lease = await db.get<{ id: number; property_id: number }>(
      "SELECT * FROM leases WHERE id = ? AND status = 'ACTIVE'",
      [leaseId],
    );

    if (!lease) throw new AppError('Locação ativa não encontrada.', 404, 'NOT_FOUND');

    const today = todayBR();
    await db.run("UPDATE leases SET status = 'ENDED', end_date = ? WHERE id = ?", [today, leaseId]);
    await db.run("UPDATE properties SET status = 'AVAILABLE' WHERE id = ?", [lease.property_id]);

    if (cancelUnpaidFuture) {
      await db.run(
        `UPDATE rent_charges
         SET status = 'CANCELLED'
         WHERE lease_id = ? AND status = 'PENDING' AND paid_cents = 0 AND due_date > ?`,
        [leaseId, today],
      );
    }

    return { ended: true };
  });
}

export async function updateLease(db: AppDatabase, leaseId: number, input: UpdateLeaseInput) {
  const tenantName = input.tenantName.trim();
  if (!tenantName) throw new AppError('Informe o nome do inquilino.');
  if (!Number.isInteger(input.monthlyRentCents) || input.monthlyRentCents <= 0) {
    throw new AppError('Valor do aluguel inválido.');
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) {
    throw new AppError('Dia de vencimento inválido.');
  }

  return runInTransaction(db, async () => {
    const lease = await db.get<{ id: number; property_id: number; status: string }>(
      'SELECT id, property_id, status FROM leases WHERE id = ?',
      [leaseId],
    );

    if (!lease) throw new AppError('Contrato de aluguel não encontrado.', 404, 'NOT_FOUND');

    await db.run(
      `UPDATE leases
       SET tenant_name = ?, tenant_phone = ?, tenant_doc = ?,
           monthly_rent_cents = ?, due_day = ?, notes = ?
       WHERE id = ?`,
      [
        tenantName,
        input.tenantPhone?.trim() || null,
        input.tenantDoc?.trim() || null,
        input.monthlyRentCents,
        input.dueDay,
        input.notes?.trim() || null,
        leaseId,
      ],
    );

    if (lease.status === 'ACTIVE') {
      await db.run('UPDATE properties SET monthly_rent_cents = ?, due_day = ? WHERE id = ?', [
        input.monthlyRentCents,
        input.dueDay,
        lease.property_id,
      ]);

      const pendingCharges = await db.all<{ id: number; reference_month: string }>(
        "SELECT id, reference_month FROM rent_charges WHERE lease_id = ? AND status = 'PENDING' AND paid_cents = 0",
        [leaseId],
      );

      for (const c of pendingCharges) {
        await db.run('UPDATE rent_charges SET amount_cents = ?, due_date = ? WHERE id = ?', [
          input.monthlyRentCents,
          clampDayInMonth(c.reference_month, input.dueDay),
          c.id,
        ]);
      }
    }

    return db.get('SELECT * FROM leases WHERE id = ?', [leaseId]);
  });
}

export async function deleteProperty(db: AppDatabase, id: number) {
  const prop = await db.get("SELECT id FROM properties WHERE id = ? AND status != 'INACTIVE'", [id]);
  if (!prop) throw new AppError('Imóvel não encontrado.', 404, 'NOT_FOUND');

  const activeLease = await db.get(
    "SELECT id FROM leases WHERE property_id = ? AND status = 'ACTIVE'",
    [id],
  );
  if (activeLease) {
    throw new AppError('Encerre a locação atual antes de excluir este imóvel.');
  }

  const openCharge = await db.get(
    "SELECT id FROM rent_charges WHERE property_id = ? AND status IN ('PENDING', 'PARTIAL')",
    [id],
  );
  if (openCharge) {
    throw new AppError('Este imóvel ainda possui cobranças de aluguel em aberto.');
  }

  const leasesCount = (await db.get<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM leases WHERE property_id = ?',
    [id],
  )) ?? { cnt: 0 };

  if (leasesCount.cnt === 0) {
    await db.run('DELETE FROM properties WHERE id = ?', [id]);
  } else {
    await db.run("UPDATE properties SET status = 'INACTIVE' WHERE id = ?", [id]);
  }

  return { deleted: true, id };
}

export async function reverseRentPayment(db: AppDatabase, paymentId: number) {
  return runInTransaction(db, async () => {
    const payment = await db.get<{ id: number; rent_charge_id: number; amount_cents: number }>(
      'SELECT id, rent_charge_id, amount_cents FROM rent_payments WHERE id = ?',
      [paymentId],
    );

    if (!payment) {
      throw new AppError('Pagamento de aluguel não encontrado.', 404, 'NOT_FOUND');
    }

    const charge = await db.get<{
      id: number;
      lease_id: number;
      reference_month: string;
      amount_cents: number;
      status: string;
    }>(
      'SELECT id, lease_id, reference_month, amount_cents, status FROM rent_charges WHERE id = ?',
      [payment.rent_charge_id],
    );

    await db.run('DELETE FROM rent_payments WHERE id = ?', [paymentId]);
    await db.run(
      "DELETE FROM financial_transactions WHERE reference_type = 'RENT_PAYMENT' AND reference_id = ?",
      [paymentId],
    );

    if (charge && charge.status !== 'CANCELLED') {
      const sumRow = (await db.get<{ total: number }>(
        'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM rent_payments WHERE rent_charge_id = ?',
        [charge.id],
      )) ?? { total: 0 };
      const newPaid = Math.min(charge.amount_cents, sumRow.total);
      const newStatus = newPaid <= 0 ? 'PENDING' : newPaid >= charge.amount_cents ? 'PAID' : 'PARTIAL';
      await db.run('UPDATE rent_charges SET paid_cents = ?, status = ? WHERE id = ?', [
        newPaid,
        newStatus,
        charge.id,
      ]);

      // Se deixou de estar quitado, remove cobrança futura ainda não paga gerada automaticamente para o mês seguinte
      if (newStatus !== 'PAID') {
        const nextYm = addOneMonthYM(charge.reference_month);
        if (nextYm > currentMonthBR()) {
          await db.run(
            `DELETE FROM rent_charges
             WHERE lease_id = ? AND reference_month = ? AND status = 'PENDING' AND paid_cents = 0`,
            [charge.lease_id, nextYm],
          );
        }
      }
    }

    return { reversed: true, paymentId, amountCents: payment.amount_cents };
  });
}

export async function getPropertyDetail(db: AppDatabase, propertyId: number) {
  await ensureMonthlyRentCharges(db);
  const today = todayBR();

  const [property, leases, chargesRaw, payments] = await Promise.all([
    db.get<Record<string, unknown>>(
      'SELECT * FROM properties WHERE id = ?',
      [propertyId],
    ),
    db.all<Record<string, unknown>>(
      'SELECT * FROM leases WHERE property_id = ? ORDER BY id DESC',
      [propertyId],
    ),
    db.all<{
      id: number;
      lease_id: number;
      property_id: number;
      reference_month: string;
      due_date: string;
      amount_cents: number;
      paid_cents: number;
      status: string;
      tenant_name: string;
    }>(
      `SELECT rc.*, l.tenant_name
       FROM rent_charges rc
       JOIN leases l ON l.id = rc.lease_id
       WHERE rc.property_id = ? AND rc.status != 'CANCELLED'
       ORDER BY rc.reference_month DESC, rc.id DESC`,
      [propertyId],
    ),
    db.all(
      `SELECT rp.*, l.tenant_name, rc.reference_month
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       JOIN rent_charges rc ON rc.id = rp.rent_charge_id
       WHERE rp.property_id = ?
       ORDER BY rp.payment_date DESC, rp.id DESC`,
      [propertyId],
    ),
  ]);

  if (!property) throw new AppError('Imóvel não encontrado.', 404, 'NOT_FOUND');

  const activeLease = leases.find((l) => l.status === 'ACTIVE') || null;
  const charges = chargesRaw.map((c) => decorateChargeStatus(c, today));

  const totalDebtCents = charges
    .filter((c) => c.status === 'PENDING' || c.status === 'PARTIAL')
    .reduce((acc, c) => acc + c.remaining_cents, 0);

  return {
    property,
    activeLease,
    leases,
    charges,
    payments,
    totalDebtCents,
  };
}

function validatePaymentInput(amountCents: number, idempotencyKey?: string) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new AppError('Informe um valor maior que zero.');
  }
  const key = idempotencyKey?.trim();
  if (!key) {
    throw new AppError('Chave de segurança do pagamento ausente.');
  }
  return key;
}

async function findExistingRentPayment(
  db: AppDatabase,
  key: string,
): Promise<RentPaymentResult | null> {
  const existing = await db.get<{
    id: number;
    amount_cents: number;
    charge_amount_cents: number;
    paid_cents: number;
    status: string;
  }>(
    `SELECT rp.id, rp.amount_cents, rc.amount_cents AS charge_amount_cents, rc.paid_cents, rc.status
     FROM rent_payments rp
     JOIN rent_charges rc ON rc.id = rp.rent_charge_id
     WHERE rp.idempotency_key = ?`,
    [key],
  );

  if (!existing) return null;
  const remainingCents = Math.max(0, existing.charge_amount_cents - existing.paid_cents);
  return {
    duplicated: true,
    paymentId: existing.id,
    paidCents: existing.amount_cents,
    remainingCents,
    settled: existing.status === 'PAID' || remainingCents === 0,
  };
}

async function applyRentPaymentToCharge(
  db: AppDatabase,
  rentChargeId: number,
  key: string,
  amountCents: number,
  paymentMethod: 'DINHEIRO' | 'PIX' | 'CARTAO',
  paymentDate?: string,
  notes?: string | null,
): Promise<RentPaymentResult> {
  const charge = await db.get<{
    id: number;
    lease_id: number;
    property_id: number;
    reference_month: string;
    amount_cents: number;
    paid_cents: number;
    status: string;
    property_name: string;
    tenant_name: string;
    lease_status: string;
    lease_monthly_rent_cents: number;
    lease_due_day: number;
  }>(
    `SELECT rc.*,
            p.name AS property_name,
            l.tenant_name,
            l.status AS lease_status,
            l.monthly_rent_cents AS lease_monthly_rent_cents,
            l.due_day AS lease_due_day
     FROM rent_charges rc
     JOIN properties p ON p.id = rc.property_id
     JOIN leases l ON l.id = rc.lease_id
     WHERE rc.id = ?`,
    [rentChargeId],
  );

  if (!charge) throw new AppError('Cobrança de aluguel não encontrada.', 404, 'NOT_FOUND');
  if (charge.status === 'PAID' || charge.status === 'CANCELLED') {
    throw new AppError('Esta cobrança de aluguel já está fechada.');
  }

  const remaining = charge.amount_cents - charge.paid_cents;
  if (amountCents > remaining) {
    throw new AppError('O valor informado é maior que o saldo em aberto deste aluguel.');
  }

  const newPaid = charge.paid_cents + amountCents;
  const newStatus = newPaid >= charge.amount_cents ? 'PAID' : 'PARTIAL';
  const resolvedDate = paymentDate || todayBR();
  const now = nowIso();

  await db.run('UPDATE rent_charges SET paid_cents = ?, status = ? WHERE id = ?', [
    newPaid,
    newStatus,
    charge.id,
  ]);

  const payRes = await db.run(
    `INSERT INTO rent_payments (
       rent_charge_id, lease_id, property_id, amount_cents, payment_method,
       payment_date, notes, idempotency_key, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      charge.id,
      charge.lease_id,
      charge.property_id,
      amountCents,
      paymentMethod,
      resolvedDate,
      notes?.trim() || null,
      key,
      now,
    ],
  );

  const paymentId = payRes.lastInsertRowid;

  await db.run(
    `INSERT INTO financial_transactions (
       direction, category, description, amount_cents, payment_method,
       reference_type, reference_id, transaction_date, created_at
     ) VALUES ('IN', 'RENT_PAYMENT', ?, ?, ?, 'RENT_PAYMENT', ?, ?, ?)`,
    [
      `Aluguel ${charge.property_name} (${charge.reference_month}) - ${charge.tenant_name}`,
      amountCents,
      paymentMethod,
      paymentId,
      resolvedDate,
      now,
    ],
  );

  // Ao quitar o aluguel do mês atual (ou futuro), já deixa o mês seguinte lançado como pendente
  if (
    newStatus === 'PAID' &&
    charge.lease_status === 'ACTIVE' &&
    charge.reference_month >= currentMonthBR()
  ) {
    const nextYm = addOneMonthYM(charge.reference_month);
    const nextDueDate = clampDayInMonth(nextYm, charge.lease_due_day);
    await db.run(
      `INSERT INTO rent_charges (
         lease_id, property_id, reference_month, due_date, amount_cents, paid_cents, status, created_at
       ) VALUES (?, ?, ?, ?, ?, 0, 'PENDING', ?)
       ON CONFLICT (lease_id, reference_month) DO NOTHING`,
      [
        charge.lease_id,
        charge.property_id,
        nextYm,
        nextDueDate,
        charge.lease_monthly_rent_cents,
        now,
      ],
    );
  }

  return {
    duplicated: false,
    paymentId,
    paidCents: amountCents,
    remainingCents: charge.amount_cents - newPaid,
    settled: newStatus === 'PAID',
  };
}

export async function receiveRentPayment(
  db: AppDatabase,
  input: ReceiveRentPaymentInput,
): Promise<RentPaymentResult> {
  const key = validatePaymentInput(input.amountCents, input.idempotencyKey);

  return runInTransaction(db, async () => {
    const existing = await findExistingRentPayment(db, key);
    if (existing) return existing;

    return applyRentPaymentToCharge(
      db,
      input.rentChargeId,
      key,
      input.amountCents,
      input.paymentMethod,
      input.paymentDate,
      input.notes,
    );
  });
}

export async function receiveLeaseMonthPayment(
  db: AppDatabase,
  input: ReceiveLeaseMonthPaymentInput,
): Promise<RentPaymentResult> {
  const key = validatePaymentInput(input.amountCents, input.idempotencyKey);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.referenceMonth)) {
    throw new AppError('Mês de referência inválido.');
  }

  return runInTransaction(db, async () => {
    const existing = await findExistingRentPayment(db, key);
    if (existing) return existing;

    const lease = await db.get<{
      id: number;
      property_id: number;
      monthly_rent_cents: number;
      due_day: number;
      status: string;
    }>('SELECT id, property_id, monthly_rent_cents, due_day, status FROM leases WHERE id = ?', [
      input.leaseId,
    ]);

    if (!lease) {
      throw new AppError('Inquilino / contrato não encontrado.', 404, 'NOT_FOUND');
    }

    const chargeRow = await db.get<{ id: number; status: string }>(
      'SELECT id, status FROM rent_charges WHERE lease_id = ? AND reference_month = ?',
      [lease.id, input.referenceMonth],
    );

    let chargeId: number;
    if (chargeRow) {
      if (chargeRow.status === 'PAID') {
        throw new AppError('O aluguel deste mês já foi pago integralmente.');
      }
      if (chargeRow.status === 'CANCELLED') {
        throw new AppError('A cobrança deste mês foi cancelada.');
      }
      chargeId = chargeRow.id;
    } else {
      if (lease.status !== 'ACTIVE') {
        throw new AppError('Contrato encerrado: escolha uma cobrança em aberto.');
      }
      const dueDate = clampDayInMonth(input.referenceMonth, lease.due_day);
      const inserted = await db.run(
        `INSERT INTO rent_charges (
           lease_id, property_id, reference_month, due_date, amount_cents, paid_cents, status, created_at
         ) VALUES (?, ?, ?, ?, ?, 0, 'PENDING', ?)
         RETURNING id`,
        [
          lease.id,
          lease.property_id,
          input.referenceMonth,
          dueDate,
          lease.monthly_rent_cents,
          nowIso(),
        ],
      );
      chargeId = inserted.lastInsertRowid;
    }

    return applyRentPaymentToCharge(
      db,
      chargeId,
      key,
      input.amountCents,
      input.paymentMethod,
      input.paymentDate,
      input.notes,
    );
  });
}

export async function listRentReceivables(
  db: AppDatabase,
  options?: { skipEnsure?: boolean },
) {
  if (!options?.skipEnsure) {
    await ensureMonthlyRentCharges(db);
  }
  const today = todayBR();

  const rows = await db.all<{
    id: number;
    lease_id: number;
    property_id: number;
    reference_month: string;
    due_date: string;
    amount_cents: number;
    paid_cents: number;
    status: string;
    property_name: string;
    tenant_name: string;
    tenant_phone: string | null;
  }>(
    `SELECT rc.*, p.name AS property_name, l.tenant_name, l.tenant_phone
     FROM rent_charges rc
     JOIN properties p ON p.id = rc.property_id
     JOIN leases l ON l.id = rc.lease_id
     WHERE rc.status IN ('PENDING', 'PARTIAL')
     ORDER BY rc.due_date ASC, rc.id ASC`,
  );

  return rows.map((r) => decorateChargeStatus(r, today));
}

export async function getRentalsOverview(db: AppDatabase) {
  await ensureMonthlyRentCharges(db);
  const ym = currentMonthBR();
  const monthStartIso = `${ym}-01`;

  const [properties, receivables, monthReceivedRowRaw, leases, payments] = await Promise.all([
    listProperties(db, { skipEnsure: true }),
    listRentReceivables(db, { skipEnsure: true }),
    db.get<{ total: number }>(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM rent_payments
       WHERE payment_date >= ?`,
      [monthStartIso],
    ),
    db.all(
      `SELECT l.*,
         p.name AS property_name,
         p.address AS property_address,
         COALESCE((
           SELECT SUM(rc.amount_cents - rc.paid_cents)
           FROM rent_charges rc
           WHERE rc.lease_id = l.id AND rc.status IN ('PENDING', 'PARTIAL')
         ), 0) AS open_debt_cents,
         COALESCE((
           SELECT SUM(rp.amount_cents)
           FROM rent_payments rp
           WHERE rp.lease_id = l.id
         ), 0) AS total_paid_cents
       FROM leases l
       JOIN properties p ON p.id = l.property_id
       ORDER BY CASE WHEN l.status = 'ACTIVE' THEN 0 ELSE 1 END, l.id DESC`,
    ),
    db.all(
      `SELECT rp.*,
         p.name AS property_name,
         l.tenant_name,
         rc.reference_month
       FROM rent_payments rp
       JOIN properties p ON p.id = rp.property_id
       JOIN leases l ON l.id = rp.lease_id
       JOIN rent_charges rc ON rc.id = rp.rent_charge_id
       ORDER BY rp.payment_date DESC, rp.id DESC
       LIMIT 150`,
    ),
  ]);

  const monthReceivedRow = monthReceivedRowRaw ?? { total: 0 };

  return {
    summary: {
      receivedThisMonthCents: monthReceivedRow.total,
      toReceiveCents: receivables.reduce((acc, c) => acc + c.remaining_cents, 0),
      propertiesCount: properties.length,
      occupiedCount: properties.filter((p) => p.status === 'OCCUPIED').length,
      availableCount: properties.filter((p) => p.status === 'AVAILABLE').length,
    },
    properties,
    receivables,
    leases,
    payments,
  };
}
