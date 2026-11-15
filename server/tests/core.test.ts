import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../config.ts';
import { createDatabase, type AppDatabase } from '../db/database.ts';
import {
  changePassword,
  ensureDefaultUser,
  getUserBySessionToken,
  loginUser,
} from '../services/authService.ts';
import { createCustomer, getCustomerDetail, listCustomers } from '../services/customerService.ts';
import { receiveDebtPayment } from '../services/debtService.ts';
import {
  createManualTransaction,
  getFinanceSummary,
  getHomeDashboard,
  updateManualTransaction,
} from '../services/financeService.ts';
import {
  createProduct,
  deleteProduct,
  listProducts,
  listStockMovements,
  registerStockMovement,
  updateProduct,
} from '../services/productService.ts';
import {
  createProperty,
  endLease,
  ensureMonthlyRentCharges,
  getPropertyDetail,
  getRentalsOverview,
  listProperties,
  receiveLeaseMonthPayment,
  receiveRentPayment,
  startLease,
} from '../services/rentalService.ts';
import {
  cancelSale,
  correctSale,
  createSale,
  deleteSale,
  listSales,
  updateSale,
} from '../services/saleService.ts';
import { todayBR } from '../utils/dates.ts';

const createdSchemas: { db: AppDatabase; schema: string }[] = [];

async function makeIsolatedDb(): Promise<AppDatabase> {
  const schema = `test_core_${crypto.randomBytes(6).toString('hex')}`;
  const db = await createDatabase(config.databaseUrl, { schema, maxConnections: 2 });
  createdSchemas.push({ db, schema });
  return db;
}

describe('Cris Parambu - Regras de Negócio Integradas', () => {
  afterAll(async () => {
    for (const item of createdSchemas) {
      await item.db.exec(`DROP SCHEMA IF EXISTS "${item.schema}" CASCADE`).catch(() => undefined);
      await item.db.close().catch(() => undefined);
    }
  });

  it('autentica usuário, cria sessão e troca senha', async () => {
    const db = await makeIsolatedDb();
    await ensureDefaultUser(db, 'cris', '1234');

    const { token, user } = await loginUser(db, 'cris', '1234', true);
    expect(user.username).toBe('cris');
    expect(user.isDefaultPassword).toBe(true);

    const verified = await getUserBySessionToken(db, token);
    expect(verified?.id).toBe(user.id);

    await changePassword(db, user.id, '1234', '4321', 'Cris');
    await expect(loginUser(db, 'cris', '1234')).rejects.toThrow();
    const after = await loginUser(db, 'cris', '4321');
    expect(after.user.isDefaultPassword).toBe(false);
    expect(after.user.displayName).toBe('Cris');
  });

  it('controla estoque, venda fiada de R$ 1.000 e pagamento parcial de R$ 250 sem duplicidade e sem gerar nova venda', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();

    const prod = await createProduct(db, {
      name: 'Rede Cearense',
      stockQty: 10,
      minStockQty: 3,
      costCents: 6000,
      priceCents: 10000,
    });

    const prod2 = await createProduct(db, {
      name: 'Camisa Básica',
      stockQty: 2,
      minStockQty: 2,
      costCents: 2000,
      priceCents: 5000,
    });

    const lowBefore = await listProducts(db, { onlyLowStock: true });
    expect(lowBefore.map((p) => p.name)).toContain('Camisa Básica');

    const customer = (await createCustomer(db, {
      name: 'Maria José',
      phone: '88999990000',
    })) as { id: number };

    const sale = (await createSale(db, {
      customerId: customer.id,
      saleType: 'FIADO',
      paymentMethod: 'FIADO',
      items: [{ productId: prod.id, quantity: 10 }],
      saleDate: today,
      idempotencyKey: 'sale-fiado-1',
    })) as { id: number; total_cents: number; profit_cents: number };

    expect(sale.total_cents).toBe(100000);
    expect(sale.profit_cents).toBe(40000);

    const afterSaleProducts = await listProducts(db, { onlyLowStock: true });
    expect(afterSaleProducts.some((p) => p.id === prod.id)).toBe(true);

    const dashBefore = await getHomeDashboard(db);
    expect(dashBefore.salesTodayCents).toBe(100000);
    expect(dashBefore.receivedTodayCents).toBe(0);
    expect(dashBefore.fiadosReceivableCents).toBe(100000);

    const pay1 = await receiveDebtPayment(db, {
      customerId: customer.id,
      amountCents: 25000,
      paymentMethod: 'PIX',
      paymentDate: today,
      idempotencyKey: 'pay-250-key',
    });
    expect(pay1.duplicated).toBe(false);
    expect(pay1.remainingCents).toBe(75000);
    expect(pay1.settled).toBe(false);

    const payDup = await receiveDebtPayment(db, {
      customerId: customer.id,
      amountCents: 25000,
      paymentMethod: 'PIX',
      paymentDate: today,
      idempotencyKey: 'pay-250-key',
    });
    expect(payDup.duplicated).toBe(true);

    const fin = await getFinanceSummary(db, { from: today, to: today });
    expect(fin.receivedTodayCents).toBe(25000);
    expect(fin.fiadosReceivableCents).toBe(75000);
    expect(fin.periodStats.debtPaymentsInCents).toBe(25000);
    expect(fin.periodStats.salesCount).toBe(1);
    expect(fin.periodStats.salesTotalCents).toBe(100000);
    expect(fin.paymentMethodTotals.PIX.inCents).toBe(25000);
    expect(fin.sales.length).toBe(1);
    expect((fin.sales[0] as { items_summary: string; customer_name: string }).items_summary).toBe('10x Rede Cearense');
    expect((fin.sales[0] as { customer_name: string }).customer_name).toBe('Maria José');
    expect(fin.debtPayments.length).toBe(1);
    expect((fin.debtPayments[0] as { amount_cents: number; customer_name: string }).amount_cents).toBe(25000);
    expect((fin.transactions[0] as { customer_name: string; items_summary: string }).customer_name).toBe('Maria José');
    expect((fin.transactions[0] as { items_summary: string }).items_summary).toContain('10x Rede Cearense');

    const pay2 = await receiveDebtPayment(db, {
      customerId: customer.id,
      amountCents: 75000,
      paymentMethod: 'DINHEIRO',
      paymentDate: today,
      idempotencyKey: 'pay-750-key',
    });
    expect(pay2.remainingCents).toBe(0);
    expect(pay2.settled).toBe(true);

    const detail = await getCustomerDetail(db, customer.id);
    expect(detail.totalRemainingCents).toBe(0);
    expect(detail.debts[0].status).toBe('PAID');

    expect((await deleteProduct(db, prod.id)).mode).toBe('archived');
    expect((await deleteProduct(db, prod2.id)).mode).toBe('deleted');

    const prod3 = await createProduct(db, {
      name: 'Chapéu',
      stockQty: 1,
      costCents: 1000,
      priceCents: 2500,
    });
    const updated3 = await updateProduct(db, prod3.id, {
      name: 'Chapéu',
      stockQty: 12,
      costCents: 1000,
      priceCents: 2500,
    });
    expect(updated3.stock_qty).toBe(12);
    const movs3 = (await listStockMovements(db, prod3.id)) as Array<{ type: string; delta_qty: number }>;
    expect(movs3[0].type).toBe('ADJUST');
    expect(movs3[0].delta_qty).toBe(11);
  });

  it('cancela e corrige venda revertendo estoque, caixa e dívida corretamente', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();

    const prod = await createProduct(db, {
      name: 'Sandália Couro',
      stockQty: 5,
      costCents: 3000,
      priceCents: 6000,
    });

    const sale = (await createSale(db, {
      saleType: 'CASH',
      paymentMethod: 'DINHEIRO',
      items: [{ productId: prod.id, quantity: 2 }],
      saleDate: today,
    })) as { id: number };

    expect((await listProducts(db))[0].stock_qty).toBe(3);
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(12000);

    const corrected = (await correctSale(db, sale.id, {
      saleType: 'CASH',
      paymentMethod: 'PIX',
      items: [{ productId: prod.id, quantity: 1 }],
      saleDate: today,
    })) as { id: number; total_cents: number };

    expect(corrected.total_cents).toBe(6000);
    expect((await listProducts(db))[0].stock_qty).toBe(4);
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(6000);

    await cancelSale(db, corrected.id, 'Desistência');
    expect((await listProducts(db))[0].stock_qty).toBe(5);
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(0);

    await registerStockMovement(db, {
      productId: prod.id,
      type: 'IN',
      quantity: 4,
      unitCostCents: 3000,
      registerFinancialOutflow: true,
      paymentMethod: 'DINHEIRO',
    });
    expect((await listProducts(db))[0].stock_qty).toBe(9);

    await createManualTransaction(db, {
      direction: 'OUT',
      category: 'EXPENSE',
      description: 'Gasolina moto',
      amountCents: 3000,
      paymentMethod: 'DINHEIRO',
      dueDate: '2026-11-25',
    });

    await createManualTransaction(db, {
      direction: 'IN',
      category: 'OTHER_IN',
      description: 'Frete extra',
      amountCents: 5000,
      paymentMethod: 'PIX',
      dueDate: '2026-11-28',
    });

    const fin = await getFinanceSummary(db, { from: today, to: today });
    expect(fin.periodStats.stockPurchasesOutCents).toBe(12000);
    expect(fin.periodStats.expensesOutCents).toBe(3000);
    expect(fin.periodStats.otherRevenuesCents).toBe(5000);
    expect(fin.periodStats.operatingExpensesCents).toBe(3000);
    expect(fin.periodStats.netProfitCents).toBe(2000);
    expect(fin.periodStats.netFlowCents).toBe(-10000);
    const txOut = fin.transactions.find((t) => (t as { description: string }).description === 'Gasolina moto') as {
      due_date: string | null;
    };
    const txIn = fin.transactions.find((t) => (t as { description: string }).description === 'Frete extra') as {
      due_date: string | null;
    };
    expect(txOut.due_date).toBe('2026-11-25');
    expect(txIn.due_date).toBe('2026-11-28');

    // Permite editar lançamento de compra de mercadoria direto pelas entradas/saídas
    const stockTx = fin.transactions.find(
      (t) => (t as { reference_type: string }).reference_type === 'STOCK_MOVEMENT',
    ) as { id: number };
    await updateManualTransaction(db, stockTx.id, {
      direction: 'OUT',
      category: 'STOCK_PURCHASE',
      description: 'Reposição editada',
      amountCents: 8000,
      paymentMethod: 'PIX',
      transactionDate: today,
      dueDate: '2026-11-30',
    });
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(-6000);

    // Permite excluir venda e reajusta estoque e caixa automaticamente
    const saleToDelete = (await createSale(db, {
      saleType: 'CASH',
      paymentMethod: 'DINHEIRO',
      items: [{ productId: prod.id, quantity: 1 }],
      saleDate: today,
    })) as { id: number };
    expect((await listProducts(db))[0].stock_qty).toBe(8);
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(0);

    await deleteSale(db, saleToDelete.id);
    expect((await listProducts(db))[0].stock_qty).toBe(9);
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(-6000);
  });

  it('gerencia imóveis, gera cobranças mensais sem duplicação, recebe aluguel parcial e encerra preservando histórico', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();

    const prop = (await createProperty(db, {
      name: 'Casinha 01',
      monthlyRentCents: 50000,
      dueDay: 10,
    })) as { id: number };

    const leaseId = await startLease(db, {
      propertyId: prop.id,
      tenantName: 'João Pedro',
      tenantPhone: '88988887777',
      startDate: today,
    });

    const createdSecond = await ensureMonthlyRentCharges(db);
    expect(createdSecond).toBe(0);

    const detail1 = await getPropertyDetail(db, prop.id);
    expect(detail1.charges.length).toBe(1);
    const chargeId = detail1.charges[0].id;

    const r1 = await receiveRentPayment(db, {
      rentChargeId: chargeId,
      amountCents: 20000,
      paymentMethod: 'DINHEIRO',
      idempotencyKey: 'rent-1',
    });
    expect(r1.remainingCents).toBe(30000);
    expect(r1.settled).toBe(false);

    const r1Dup = await receiveRentPayment(db, {
      rentChargeId: chargeId,
      amountCents: 20000,
      paymentMethod: 'DINHEIRO',
      idempotencyKey: 'rent-1',
    });
    expect(r1Dup.duplicated).toBe(true);

    const r2 = await receiveRentPayment(db, {
      rentChargeId: chargeId,
      amountCents: 30000,
      paymentMethod: 'PIX',
      idempotencyKey: 'rent-2',
    });
    expect(r2.remainingCents).toBe(0);
    expect(r2.settled).toBe(true);

    const fin = await getFinanceSummary(db, { from: today, to: today });
    expect(fin.periodStats.rentPaymentsInCents).toBe(50000);

    const overview = await getRentalsOverview(db);
    expect(overview.summary.receivedThisMonthCents).toBe(50000);
    // Próximo mês é lançado automaticamente como pendente após quitar o mês atual
    expect(overview.summary.toReceiveCents).toBe(50000);
    expect(overview.leases.length).toBe(1);
    expect(overview.payments.length).toBe(2);

    await endLease(db, leaseId);
    const propsAfter = await listProperties(db);
    expect(propsAfter[0].status).toBe('AVAILABLE');
    expect((await getRentalsOverview(db)).summary.toReceiveCents).toBe(0);
    const detailAfter = await getPropertyDetail(db, prop.id);
    expect(detailAfter.payments.length).toBe(2);
    expect(detailAfter.charges[0].status).toBe('PAID');
  });

  it('busca clientes por nome, telefone, CPF (com ou sem pontuação) e endereço', async () => {
    const db = await makeIsolatedDb();

    await createCustomer(db, {
      name: 'Ana Ferreira',
      phone: '(88) 99988-1122',
      cpf: '123.456.789-01',
      address: 'Rua da Matriz, 40',
    });
    await createCustomer(db, {
      name: 'João Batista',
      phone: '(88) 98877-3344',
      cpf: '987.654.321-09',
      address: 'Bairro Horácio',
    });

    expect((await listCustomers(db, { search: 'ana' })).map((c) => c.name)).toEqual(['Ana Ferreira']);
    expect((await listCustomers(db, { search: '999881122' })).map((c) => c.name)).toEqual(['Ana Ferreira']);
    expect((await listCustomers(db, { search: '12345678901' })).map((c) => c.name)).toEqual(['Ana Ferreira']);
    expect((await listCustomers(db, { search: '123.456' })).map((c) => c.name)).toEqual(['Ana Ferreira']);
    expect((await listCustomers(db, { search: '654321' })).map((c) => c.name)).toEqual(['João Batista']);
    expect((await listCustomers(db, { search: 'horácio' })).map((c) => c.name)).toEqual(['João Batista']);
  });

  it('retorna quantidade de parcelas, valor da parcela e vencimento nas listagens de vendas', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();

    const prod = await createProduct(db, {
      name: 'Jogo de Panelas',
      stockQty: 5,
      costCents: 6000,
      priceCents: 12000,
    });
    const cust = (await createCustomer(db, { name: 'Luciana Silva' })) as { id: number };

    await createSale(db, {
      customerId: cust.id,
      saleType: 'INSTALLMENT',
      paymentMethod: 'FIADO',
      items: [{ productId: prod.id, quantity: 1 }],
      installments: [
        { dueDate: '2026-12-10', amountCents: 4000 },
        { dueDate: '2027-01-10', amountCents: 4000 },
        { dueDate: '2027-02-10', amountCents: 4000 },
      ],
      saleDate: today,
    });

    const listed = (await listSales(db, { from: today, to: today })) as Array<{
      installment_count: number;
      installment_amount_cents: number;
      next_due_date: string;
    }>;
    expect(listed.length).toBe(1);
    expect(listed[0].installment_count).toBe(3);
    expect(listed[0].installment_amount_cents).toBe(4000);
    expect(listed[0].next_due_date).toBe('2026-12-10');

    const fin = await getFinanceSummary(db, { from: today, to: today });
    const finSale = fin.sales[0] as {
      installment_count: number;
      installment_amount_cents: number;
      next_due_date: string;
    };
    expect(finSale.installment_count).toBe(3);
    expect(finSale.installment_amount_cents).toBe(4000);
    expect(finSale.next_due_date).toBe('2026-12-10');
  });

  it('aplica desconto na venda recalculando total, lucro e dívida corretamente', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();

    const prod = await createProduct(db, {
      name: 'Conjunto Fitness',
      stockQty: 5,
      costCents: 4000,
      priceCents: 10000,
    });
    const cust = (await createCustomer(db, { name: 'Fernanda Dias' })) as { id: number };

    const cashWithDiscount = (await createSale(db, {
      saleType: 'CASH',
      paymentMethod: 'PIX',
      items: [{ productId: prod.id, quantity: 1 }],
      discountCents: 1500,
      saleDate: today,
    })) as { total_cents: number; discount_cents: number; profit_cents: number; paid_cents: number };

    expect(cashWithDiscount.discount_cents).toBe(1500);
    expect(cashWithDiscount.total_cents).toBe(8500);
    expect(cashWithDiscount.paid_cents).toBe(8500);
    expect(cashWithDiscount.profit_cents).toBe(4500);

    const creditWithDiscount = (await createSale(db, {
      customerId: cust.id,
      saleType: 'INSTALLMENT',
      paymentMethod: 'FIADO',
      items: [{ productId: prod.id, quantity: 1 }],
      discountCents: 2000,
      installmentCount: 2,
      saleDate: today,
    })) as unknown as {
      total_cents: number;
      discount_cents: number;
      debt: { remaining_cents: number; installments: Array<{ amount_cents: number }> };
    };

    expect(creditWithDiscount.discount_cents).toBe(2000);
    expect(creditWithDiscount.total_cents).toBe(8000);
    expect(creditWithDiscount.debt.remaining_cents).toBe(8000);
    expect(creditWithDiscount.debt.installments[0].amount_cents).toBe(4000);

    await expect(
      createSale(db, {
        saleType: 'CASH',
        paymentMethod: 'DINHEIRO',
        items: [{ productId: prod.id, quantity: 1 }],
        discountCents: 10000,
        saleDate: today,
      }),
    ).rejects.toThrow();
  });

  it('busca produtos e clientes por palavras parciais, sem acento, plural e pequenas variações de escrita', async () => {
    const db = await makeIsolatedDb();

    await createProduct(db, {
      name: 'JOGO DE PLANELAS DE PRESSAO',
      category: 'Cozinha',
      stockQty: 2,
      costCents: 4000,
      priceCents: 12000,
    });
    await createProduct(db, {
      name: 'Sandália Rasteira Feminina',
      category: 'Calçados',
      stockQty: 4,
      costCents: 2000,
      priceCents: 5000,
    });

    expect((await listProducts(db, { search: 'panela' })).length).toBe(1);
    expect((await listProducts(db, { search: 'panelas pressao' })).length).toBe(1);
    expect((await listProducts(db, { search: 'jogo pressao' })).length).toBe(1);
    expect((await listProducts(db, { search: 'sandalia' })).length).toBe(1);
    expect((await listProducts(db, { search: 'inexistente' })).length).toBe(0);

    await createCustomer(db, {
      name: 'Lucas Pereira da Silva',
      phone: '(48) 99691-5303',
      cpf: '117.675.899-30',
      address: 'Rua João Paulo II',
      notes: 'Casa verde perto da igreja',
    });

    expect((await listCustomers(db, { search: 'lucas' })).length).toBe(1);
    expect((await listCustomers(db, { search: 'silva joao' })).length).toBe(1);
    expect((await listCustomers(db, { search: 'perera' })).length).toBe(1);
    expect((await listCustomers(db, { search: '99691' })).length).toBe(1);
    expect((await listCustomers(db, { search: '117675' })).length).toBe(1);
    expect((await listCustomers(db, { search: 'igreja' })).length).toBe(1);
  });

  it('edita venda no local ajustando caixa, estoque ao remover/alterar produtos, desconto e dívida', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();

    const prodA = await createProduct(db, {
      name: 'Panela Pressão',
      stockQty: 5,
      costCents: 4000,
      priceCents: 12000,
    });
    const prodB = await createProduct(db, {
      name: 'Frigideira',
      stockQty: 4,
      costCents: 2000,
      priceCents: 5000,
    });
    const customer = (await createCustomer(db, { name: 'Ana Paula' })) as { id: number };

    const sale = await createSale(db, {
      customerId: customer.id,
      saleType: 'CASH',
      paymentMethod: 'DINHEIRO',
      items: [
        { productId: prodA.id, quantity: 2 },
        { productId: prodB.id, quantity: 1 },
      ],
      saleDate: today,
    });

    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(29000);
    expect((await listProducts(db)).find((p) => p.id === prodA.id)?.stock_qty).toBe(3);
    expect((await listProducts(db)).find((p) => p.id === prodB.id)?.stock_qty).toBe(3);

    const edited1 = await updateSale(db, sale.id, {
      customerId: customer.id,
      saleType: 'CASH',
      paymentMethod: 'PIX',
      items: [{ productId: prodA.id, quantity: 1, unitPriceCents: 11000 }],
      discountCents: 1000,
      saleDate: today,
    });

    expect(edited1.total_cents).toBe(10000);
    expect(edited1.paid_cents).toBe(10000);
    expect(edited1.profit_cents).toBe(6000);
    expect(edited1.items.length).toBe(1);

    expect((await listProducts(db)).find((p) => p.id === prodA.id)?.stock_qty).toBe(4);
    expect((await listProducts(db)).find((p) => p.id === prodB.id)?.stock_qty).toBe(4);

    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(10000);
    const fin = await getFinanceSummary(db, { from: today, to: today });
    expect(fin.sales.length).toBe(1);
    expect(fin.paymentMethodTotals.PIX.inCents).toBe(10000);
    expect(fin.paymentMethodTotals.DINHEIRO.inCents).toBe(0);

    const edited2 = await updateSale(db, sale.id, {
      customerId: customer.id,
      saleType: 'FIADO',
      paymentMethod: 'FIADO',
      items: [
        { productId: prodA.id, quantity: 1, unitPriceCents: 11000 },
        { productId: prodB.id, quantity: 2, unitPriceCents: 5000 },
      ],
      discountCents: 1000,
      downPaymentCents: 3000,
      downPaymentMethod: 'DINHEIRO',
      saleDate: today,
    });

    expect(edited2.total_cents).toBe(20000);
    expect(edited2.paid_cents).toBe(3000);
    expect((await listProducts(db)).find((p) => p.id === prodB.id)?.stock_qty).toBe(2);
    expect((await getHomeDashboard(db)).cashBalanceCents).toBe(3000);
    expect((await getHomeDashboard(db)).fiadosReceivableCents).toBe(17000);
  });

  it('registra pagamento de aluguel por inquilino e mês (incluindo adiantamento de mês futuro)', async () => {
    const db = await makeIsolatedDb();
    const today = todayBR();
    const currentYm = today.slice(0, 7);
    const [y, m] = currentYm.split('-').map(Number);
    const nextYm = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;

    const prop = (await createProperty(db, {
      name: 'Casa 01',
      monthlyRentCents: 120000,
      dueDay: 15,
    })) as { id: number };

    const leaseId = await startLease(db, {
      propertyId: prop.id,
      tenantName: 'Lucas',
      startDate: `${currentYm}-01`,
    });

    const curRes = await receiveLeaseMonthPayment(db, {
      leaseId,
      referenceMonth: currentYm,
      amountCents: 120000,
      paymentMethod: 'PIX',
      paymentDate: today,
      idempotencyKey: 'lease-pay-cur',
    });
    expect(curRes.settled).toBe(true);
    // Quitar o mês atual lança automaticamente o mês seguinte como pendente
    expect((await getRentalsOverview(db)).summary.toReceiveCents).toBe(120000);

    const advRes = await receiveLeaseMonthPayment(db, {
      leaseId,
      referenceMonth: nextYm,
      amountCents: 60000,
      paymentMethod: 'DINHEIRO',
      paymentDate: today,
      notes: 'Adiantamento parcial',
      idempotencyKey: 'lease-pay-next',
    });
    expect(advRes.settled).toBe(false);
    expect(advRes.remainingCents).toBe(60000);

    const overview = await getRentalsOverview(db);
    expect(overview.payments.length).toBe(2);
    expect(overview.summary.receivedThisMonthCents).toBe(180000);
    expect(overview.summary.toReceiveCents).toBe(60000);

    await expect(
      receiveLeaseMonthPayment(db, {
        leaseId,
        referenceMonth: currentYm,
        amountCents: 1000,
        paymentMethod: 'PIX',
        idempotencyKey: 'lease-pay-dup-month',
      }),
    ).rejects.toThrow();
  });
});
