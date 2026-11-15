import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.ts';
import { config, type AppConfig } from '../config.ts';
import { createDatabase, type AppDatabase } from '../db/database.ts';

describe('Cris Parambu - API HTTP ponta a ponta', () => {
  let testSchema: string;
  let baseUrl: string;
  let server: ReturnType<Awaited<ReturnType<typeof createApp>>['listen']>;
  let db: AppDatabase;

  beforeAll(async () => {
    testSchema = `test_api_${crypto.randomBytes(6).toString('hex')}`;
    const testConfig: AppConfig = {
      port: 0,
      nodeEnv: 'test',
      databaseUrl: config.databaseUrl,
      supabaseUrl: config.supabaseUrl,
      supabaseAnonKey: '',
      allowedLoginEmails: [],
      sessionSecret: 'test-secret',
      defaultAdminUser: 'cris',
      defaultAdminPassword: '1234',
    };

    db = await createDatabase(testConfig.databaseUrl, { schema: testSchema, maxConnections: 2 });
    const app = await createApp(db, testConfig);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (db) {
      await db.exec(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`).catch(() => undefined);
      await db.close().catch(() => undefined);
    }
  });

  it('bloqueia acesso sem login, faz login e executa fluxo completo de venda, fiado, foto no banco, aluguel e backup', async () => {
    const unauth = await fetch(`${baseUrl}/dashboard`);
    expect(unauth.status).toBe(401);

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cris', password: '1234' }),
    });
    expect(loginRes.status).toBe(200);
    const cookieHeader = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    expect(cookieHeader).toContain('cp_session=');

    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    };

    // 0. Envia e lê foto armazenada 100% no PostgreSQL
    const form = new FormData();
    const pngHeader = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 1]);
    form.append('photo', new Blob([pngHeader], { type: 'image/png' }), 'teste.png');
    const uploadRes = await fetch(`${baseUrl}/uploads`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
      body: form,
    });
    expect(uploadRes.status).toBe(200);
    const { url: photoUrl } = (await uploadRes.json()) as { url: string };
    expect(photoUrl).toMatch(/^\/api\/uploads\/.+\.png$/);

    const imgGetRes = await fetch(`${baseUrl}${photoUrl.replace('/api', '')}`, {
      headers: { Cookie: cookieHeader },
    });
    expect(imgGetRes.status).toBe(200);
    expect(imgGetRes.headers.get('content-type')).toContain('image/png');

    // 1. Cadastra produto
    const prodRes = await fetch(`${baseUrl}/products`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Boné Sertão',
        photoUrl,
        stockQty: 10,
        costCents: 1500,
        priceCents: 3500,
      }),
    });
    expect(prodRes.status).toBe(201);
    const { product } = (await prodRes.json()) as { product: { id: number } };

    // 2. Cadastra cliente
    const custRes = await fetch(`${baseUrl}/customers`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Seu Chico' }),
    });
    expect(custRes.status).toBe(201);
    const { customer } = (await custRes.json()) as { customer: { id: number } };

    // 3. Registra venda parcelada (2x) com entrada
    const saleRes = await fetch(`${baseUrl}/sales`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        saleType: 'INSTALLMENT',
        paymentMethod: 'DINHEIRO',
        items: [{ productId: product.id, quantity: 4 }],
        downPaymentCents: 4000,
        downPaymentMethod: 'DINHEIRO',
        installmentCount: 2,
      }),
    });
    expect(saleRes.status).toBe(201);

    // 4. Recebe R$ 50,00 do fiado
    const payRes = await fetch(`${baseUrl}/debts/pay`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId: customer.id,
        amountCents: 5000,
        paymentMethod: 'PIX',
        idempotencyKey: 'api-pay-1',
      }),
    });
    expect(payRes.status).toBe(201);
    const payJson = (await payRes.json()) as { remainingCents: number };
    expect(payJson.remainingCents).toBe(5000);

    // 5. Confere backup JSON
    const backupRes = await fetch(`${baseUrl}/backup/download`, {
      headers: { Cookie: cookieHeader },
    });
    expect(backupRes.status).toBe(200);
    const backupText = await backupRes.text();
    const backupParsed = JSON.parse(backupText) as {
      database: string;
      tables: { products: unknown[]; media_files: unknown[] };
    };
    expect(backupParsed.database).toContain('PostgreSQL');
    expect(backupParsed.tables.products.length).toBe(1);
    expect(backupParsed.tables.media_files.length).toBe(1);

    // 6. Confere lançamento manual + edição + Cache-Control no-store
    const txRes = await fetch(`${baseUrl}/finance/transactions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        direction: 'IN',
        category: 'OTHER_IN',
        description: 'Entrada teste',
        amountCents: 20000,
        paymentMethod: 'DINHEIRO',
      }),
    });
    expect(txRes.status).toBe(201);
    const { transaction: createdTx } = (await txRes.json()) as {
      transaction: { id: number; amount_cents: number };
    };

    const editTxRes = await fetch(`${baseUrl}/finance/transactions/${createdTx.id}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        direction: 'OUT',
        category: 'EXPENSE',
        description: 'Gasolina entrega',
        amountCents: 3500,
        paymentMethod: 'PIX',
      }),
    });
    expect(editTxRes.status).toBe(200);

    // 7. Confere DRE Completo declarado
    const dreRes = await fetch(`${baseUrl}/finance/dre`, {
      headers: { Cookie: cookieHeader },
    });
    expect(dreRes.status).toBe(200);
    const dreJson = (await dreRes.json()) as {
      sales: { netRevenueCents: number; cmvCents: number; grossProfitCents: number };
      expenses: { totalOperatingExpensesCents: number };
      result: { netOperatingResultCents: number };
      cashFlow: { debtPaymentsInCents: number; expensesOutCents: number };
      declaredDetails: {
        expenseItems: Array<{ description: string; amount_cents: number }>;
        topProducts: Array<{ product_name: string; qty_sold: number }>;
      };
    };
    expect(dreJson.sales.netRevenueCents).toBe(14000);
    expect(dreJson.sales.cmvCents).toBe(6000);
    expect(dreJson.sales.grossProfitCents).toBe(8000);
    expect(dreJson.expenses.totalOperatingExpensesCents).toBe(3500);
    expect(dreJson.result.netOperatingResultCents).toBe(4500);
    expect(dreJson.declaredDetails.expenseItems[0]?.description).toBe('Gasolina entrega');
    expect(dreJson.declaredDetails.topProducts[0]?.qty_sold).toBe(4);

    // 8. Confere exclusão do lançamento manual e estorno do pagamento de fiado
    const delTxRes = await fetch(`${baseUrl}/finance/transactions/${createdTx.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(delTxRes.status).toBe(200);

    const finRes = await fetch(`${baseUrl}/finance`, {
      headers: { Cookie: cookieHeader },
    });
    expect(finRes.status).toBe(200);
    expect(finRes.headers.get('cache-control')).toContain('no-store');
    const finJson = (await finRes.json()) as {
      periodStats: { otherInCents: number; expensesOutCents: number };
      debtPayments: Array<{ id: number; status: string }>;
    };
    expect(finJson.periodStats.otherInCents).toBe(0);
    expect(finJson.periodStats.expensesOutCents).toBe(0);

    const delCustBlocked = await fetch(`${baseUrl}/customers/${customer.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(delCustBlocked.status).toBe(400);

    const paymentId = finJson.debtPayments[0]!.id;
    const revPayRes = await fetch(`${baseUrl}/debts/payments/${paymentId}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(revPayRes.status).toBe(200);
    const revPayJson = (await revPayRes.json()) as { remainingCents: number };
    expect(revPayJson.remainingCents).toBe(10000);

    // 9. Confere edição de locação e exclusão de imóvel
    const propRes = await fetch(`${baseUrl}/rentals/properties`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Casa Teste', monthlyRentCents: 60000, dueDay: 10 }),
    });
    expect(propRes.status).toBe(201);
    const { property } = (await propRes.json()) as { property: { id: number } };

    const leaseRes = await fetch(`${baseUrl}/rentals/properties/${property.id}/lease`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ tenantName: 'João', monthlyRentCents: 60000, dueDay: 10 }),
    });
    expect(leaseRes.status).toBe(201);
    const { leaseId } = (await leaseRes.json()) as { leaseId: number };

    const editLeaseRes = await fetch(`${baseUrl}/rentals/leases/${leaseId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ tenantName: 'João Silva', monthlyRentCents: 65000, dueDay: 15 }),
    });
    expect(editLeaseRes.status).toBe(200);

    const endLeaseRes = await fetch(`${baseUrl}/rentals/leases/${leaseId}/end`, {
      method: 'POST',
      headers: { Cookie: cookieHeader },
    });
    expect(endLeaseRes.status).toBe(200);

    const delPropWithOpenCharge = await fetch(`${baseUrl}/rentals/properties/${property.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(delPropWithOpenCharge.status).toBe(200);

    const freePropRes = await fetch(`${baseUrl}/rentals/properties`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Casa Errada', monthlyRentCents: 50000, dueDay: 5 }),
    });
    const { property: freeProp } = (await freePropRes.json()) as { property: { id: number } };
    const delFreeProp = await fetch(`${baseUrl}/rentals/properties/${freeProp.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader },
    });
    expect(delFreeProp.status).toBe(200);
  });
});
