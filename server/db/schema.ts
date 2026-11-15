import type { AppDatabase } from './database.ts';

export async function initSchema(db: AppDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_default_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_files (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      photo_url TEXT,
      stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
      min_stock_qty INTEGER NOT NULL DEFAULT 5 CHECK (min_stock_qty >= 0),
      cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
      price_cents INTEGER NOT NULL CHECK (price_cents > 0),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      type TEXT NOT NULL CHECK (type IN ('IN', 'OUT', 'SALE', 'SALE_CANCEL', 'ADJUST')),
      delta_qty INTEGER NOT NULL,
      qty_after INTEGER NOT NULL,
      unit_cost_cents INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      cpf TEXT,
      address TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      sale_type TEXT NOT NULL CHECK (sale_type IN ('CASH', 'FIADO', 'INSTALLMENT')),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('DINHEIRO', 'PIX', 'CARTAO', 'FIADO')),
      discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents > 0),
      total_cost_cents INTEGER NOT NULL DEFAULT 0,
      profit_cents INTEGER NOT NULL DEFAULT 0,
      paid_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
      cancel_reason TEXT,
      cancelled_at TEXT,
      sale_date TEXT NOT NULL,
      notes TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id SERIAL PRIMARY KEY,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name_snapshot TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_cost_cents INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      cost_subtotal_cents INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS debts (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      sale_id INTEGER UNIQUE REFERENCES sales(id),
      description TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK (total_cents > 0),
      paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
      remaining_cents INTEGER NOT NULL CHECK (remaining_cents >= 0),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PAID', 'CANCELLED')),
      created_at TEXT NOT NULL,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS debt_installments (
      id SERIAL PRIMARY KEY,
      debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
      installment_number INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED')),
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS debt_payments (
      id SERIAL PRIMARY KEY,
      debt_id INTEGER NOT NULL REFERENCES debts(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('DINHEIRO', 'PIX', 'CARTAO')),
      payment_date TEXT NOT NULL,
      notes TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVERSED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS properties (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      photo_url TEXT,
      monthly_rent_cents INTEGER NOT NULL CHECK (monthly_rent_cents > 0),
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'INACTIVE')),
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leases (
      id SERIAL PRIMARY KEY,
      property_id INTEGER NOT NULL REFERENCES properties(id),
      tenant_name TEXT NOT NULL,
      tenant_phone TEXT,
      tenant_doc TEXT,
      monthly_rent_cents INTEGER NOT NULL CHECK (monthly_rent_cents > 0),
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rent_charges (
      id SERIAL PRIMARY KEY,
      lease_id INTEGER NOT NULL REFERENCES leases(id),
      property_id INTEGER NOT NULL REFERENCES properties(id),
      reference_month TEXT NOT NULL,
      due_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED')),
      created_at TEXT NOT NULL,
      UNIQUE (lease_id, reference_month)
    );

    CREATE TABLE IF NOT EXISTS rent_payments (
      id SERIAL PRIMARY KEY,
      rent_charge_id INTEGER NOT NULL REFERENCES rent_charges(id),
      lease_id INTEGER NOT NULL REFERENCES leases(id),
      property_id INTEGER NOT NULL REFERENCES properties(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('DINHEIRO', 'PIX', 'CARTAO')),
      payment_date TEXT NOT NULL,
      notes TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS financial_transactions (
      id SERIAL PRIMARY KEY,
      direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
      category TEXT NOT NULL CHECK (category IN (
        'CASH_SALE', 'DEBT_PAYMENT', 'RENT_PAYMENT', 'EXPENSE',
        'STOCK_PURCHASE', 'SALE_REFUND', 'OTHER_IN', 'ADJUSTMENT'
      )),
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('DINHEIRO', 'PIX', 'CARTAO')),
      reference_type TEXT NOT NULL,
      reference_id INTEGER,
      transaction_date TEXT NOT NULL,
      due_date TEXT,
      created_at TEXT NOT NULL
    );

    ALTER TABLE customers ADD COLUMN IF NOT EXISTS cpf TEXT;
    ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS due_date TEXT;

    CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
    CREATE INDEX IF NOT EXISTS idx_debts_customer ON debts(customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_debt_installments_debt ON debt_installments(debt_id, due_date);
    CREATE INDEX IF NOT EXISTS idx_debt_payments_customer ON debt_payments(customer_id, payment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_leases_property ON leases(property_id, status);
    CREATE INDEX IF NOT EXISTS idx_rent_charges_status ON rent_charges(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_rent_payments_property ON rent_payments(property_id, payment_date DESC);
    CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON financial_transactions(transaction_date DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_fin_tx_category ON financial_transactions(category, transaction_date DESC);
  `);
}
