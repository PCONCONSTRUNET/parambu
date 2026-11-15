import { createReceiptHeader } from './pdfReceipt';
import { formatBRL, formatDateBR, formatMonthBR, paymentMethodLabel, todayLocalISO } from './format';

export interface DreReportData {
  period: { from: string; to: string };
  sales: {
    totalCount: number;
    cashCount: number;
    creditCount: number;
    cancelledCount: number;
    grossProductsSubtotalCents: number;
    discountsCents: number;
    netRevenueCents: number;
    cashSalesTotalCents: number;
    creditSalesTotalCents: number;
    downPaymentsCents: number;
    cmvCents: number;
    grossProfitCents: number;
    grossMarginPct: number;
  };
  otherRevenues: {
    rentReceivedCents: number;
    otherInCents: number;
    adjustmentsInCents: number;
    totalOtherRevenuesCents: number;
  };
  expenses: {
    expensesOutCents: number;
    adjustmentsOutCents: number;
    totalOperatingExpensesCents: number;
    stockPurchasesOutCents: number;
    refundsOutCents: number;
  };
  result: {
    grossOperatingResultCents: number;
    netOperatingResultCents: number;
    netMarginPct: number;
  };
  cashFlow: {
    cashSalesInCents: number;
    debtPaymentsInCents: number;
    rentPaymentsInCents: number;
    otherInCents: number;
    totalInCents: number;
    expensesOutCents: number;
    stockPurchasesOutCents: number;
    refundsOutCents: number;
    adjustmentsOutCents: number;
    totalOutCents: number;
    netCashFlowCents: number;
    currentCashBalanceCents: number;
    byMethod: {
      DINHEIRO: { inCents: number; outCents: number; netCents: number };
      PIX: { inCents: number; outCents: number; netCents: number };
      CARTAO: { inCents: number; outCents: number; netCents: number };
    };
  };
  receivablesAndInventory: {
    fiadosOpenCents: number;
    fiadosOverdueCents: number;
    rentsOpenCents: number;
    rentsOverdueCents: number;
    totalReceivableCents: number;
    inventoryTotalUnits: number;
    inventoryCostValueCents: number;
    inventorySaleValueCents: number;
  };
  declaredDetails: {
    expenseItems: Array<{
      id: number;
      date: string;
      description: string;
      payment_method: string;
      amount_cents: number;
      category: string;
    }>;
    stockPurchaseItems: Array<{
      id: number;
      date: string;
      description: string;
      payment_method: string;
      amount_cents: number;
    }>;
    otherInItems: Array<{
      id: number;
      date: string;
      description: string;
      payment_method: string;
      amount_cents: number;
      category: string;
    }>;
    rentItems: Array<{
      id: number;
      date: string;
      property_name: string;
      tenant_name: string;
      reference_month: string;
      payment_method: string;
      amount_cents: number;
    }>;
    topProducts: Array<{
      product_id: number;
      product_name: string;
      qty_sold: number;
      revenue_cents: number;
      cost_cents: number;
      profit_cents: number;
    }>;
  };
}

type RGB = [number, number, number];

const DARK_GREEN: RGB = [11, 70, 25];
const STONE_900: RGB = [28, 25, 23];
const STONE_700: RGB = [68, 64, 60];
const STONE_500: RGB = [120, 113, 108];
const RED_700: RGB = [185, 28, 28];
const AMBER_800: RGB = [146, 64, 14];

function formatSignedBRL(cents: number): string {
  if (cents < 0) return `- ${formatBRL(Math.abs(cents))}`;
  return formatBRL(cents);
}

export async function downloadDreReportPdf(dre: DreReportData): Promise<void> {
  const fromStr = formatDateBR(dre.period.from);
  const toStr = formatDateBR(dre.period.to);
  const { doc, y: startY, margin, contentW } = await createReceiptHeader(
    'DRE COMPLETO • FECHAMENTO FINANCEIRO',
    `Período: ${fromStr} até ${toStr}  •  Emitido em ${formatDateBR(todayLocalISO())}`,
  );

  const pageW = 210;
  const rightX = pageW - margin;
  let y = startY;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > 274) {
      doc.addPage();
      y = 16;
    }
  };

  const drawSectionTitle = (title: string, subtitle?: string) => {
    ensureSpace(16);
    doc.setFillColor(11, 70, 25);
    doc.roundedRect(margin, y, contentW, subtitle ? 11 : 8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title, margin + 3.5, y + 5.5);
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(220, 252, 231);
      doc.text(subtitle, margin + 3.5, y + 9.5);
    }
    y += subtitle ? 14 : 11;
  };

  const drawStatementRow = (
    label: string,
    valueText: string,
    options?: {
      bold?: boolean;
      color?: RGB;
      note?: string;
      highlightBg?: RGB;
      borderColor?: RGB;
      divider?: boolean;
    },
  ) => {
    const hasNote = Boolean(options?.note);
    const rowH = hasNote ? 10.5 : 6.8;
    ensureSpace(rowH + 2);

    if (options?.highlightBg) {
      doc.setFillColor(...options.highlightBg);
      if (options.borderColor) {
        doc.setDrawColor(...options.borderColor);
        doc.roundedRect(margin, y - 4.5, contentW, rowH + 1.5, 1.5, 1.5, 'FD');
      } else {
        doc.roundedRect(margin, y - 4.5, contentW, rowH + 1.5, 1.5, 1.5, 'F');
      }
    }

    const color = options?.color ?? STONE_900;
    doc.setFont('helvetica', options?.bold ? 'bold' : 'normal');
    doc.setFontSize(options?.bold ? 10.2 : 9.8);
    doc.setTextColor(...color);
    doc.text(label, margin + 3, y);
    doc.text(valueText, rightX - 3, y, { align: 'right' });

    if (options?.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(...STONE_500);
      doc.text(options.note, margin + 6, y + 4);
    }

    y += rowH;
    if (options?.divider) {
      doc.setDrawColor(214, 211, 209);
      doc.setLineWidth(0.3);
      doc.line(margin, y - 2, rightX, y - 2);
      y += 2;
    }
  };

  // =========================================================================
  // 1. DRE COMPLETO (RESULTADO ECONÔMICO / COMPETÊNCIA)
  // =========================================================================
  drawSectionTitle(
    '1. DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO (DRE)',
    'Visão contábil/gerencial: receitas de vendas, custos (CMV), outras receitas e despesas operacionais',
  );

  drawStatementRow(
    '(+) Receita Bruta de Vendas (Produtos)',
    formatBRL(dre.sales.grossProductsSubtotalCents),
    {
      bold: true,
      note: `${dre.sales.totalCount} vendas concluídas (${dre.sales.cashCount} à vista: ${formatBRL(dre.sales.cashSalesTotalCents)} • ${dre.sales.creditCount} fiado/parcelado: ${formatBRL(dre.sales.creditSalesTotalCents)})${dre.sales.cancelledCount > 0 ? ` • ${dre.sales.cancelledCount} cancelada(s)` : ''}`,
    },
  );
  drawStatementRow(
    '(-) Descontos Concedidos nas Vendas',
    dre.sales.discountsCents > 0 ? `- ${formatBRL(dre.sales.discountsCents)}` : formatBRL(0),
    { color: dre.sales.discountsCents > 0 ? RED_700 : STONE_700, divider: true },
  );
  drawStatementRow('(=) Receita Líquida de Vendas', formatBRL(dre.sales.netRevenueCents), {
    bold: true,
    color: STONE_900,
    highlightBg: [245, 245, 244],
  });
  drawStatementRow(
    '(-) Custo das Mercadorias Vendidas (CMV)',
    `- ${formatBRL(dre.sales.cmvCents)}`,
    {
      color: RED_700,
      note: 'Soma do preço de custo unitário dos produtos efetivamente vendidos no período',
      divider: true,
    },
  );
  drawStatementRow(
    '(=) Lucro Bruto das Vendas',
    `${formatSignedBRL(dre.sales.grossProfitCents)}  (${dre.sales.grossMarginPct.toFixed(1)}%)`,
    {
      bold: true,
      color: dre.sales.grossProfitCents >= 0 ? DARK_GREEN : RED_700,
      highlightBg: [240, 253, 244],
      borderColor: [167, 243, 208],
    },
  );
  drawStatementRow(
    '(+) Receita de Aluguéis Recebidos',
    `+ ${formatBRL(dre.otherRevenues.rentReceivedCents)}`,
    { color: DARK_GREEN },
  );
  drawStatementRow(
    '(+) Outras Entradas / Receitas Operacionais',
    `+ ${formatBRL(dre.otherRevenues.otherInCents + dre.otherRevenues.adjustmentsInCents)}`,
    {
      color: DARK_GREEN,
      divider: true,
    },
  );
  drawStatementRow(
    '(=) Resultado Bruto Total (Lucro Vendas + Aluguéis + Outras)',
    formatSignedBRL(dre.result.grossOperatingResultCents),
    { bold: true, color: STONE_900 },
  );
  drawStatementRow(
    '(-) Gastos e Despesas Operacionais do Período',
    `- ${formatBRL(dre.expenses.totalOperatingExpensesCents)}`,
    {
      color: dre.expenses.totalOperatingExpensesCents > 0 ? RED_700 : STONE_700,
      note: 'Não inclui compras de reposição de estoque (declaradas no Fluxo de Caixa abaixo)',
      divider: true,
    },
  );

  const isProfit = dre.result.netOperatingResultCents >= 0;
  drawStatementRow(
    `(=) RESULTADO LÍQUIDO DO EXERCÍCIO (${isProfit ? 'LUCRO' : 'PREJUÍZO'})`,
    `${formatSignedBRL(dre.result.netOperatingResultCents)}  (Margem ${dre.result.netMarginPct.toFixed(1)}%)`,
    {
      bold: true,
      color: isProfit ? DARK_GREEN : RED_700,
      highlightBg: isProfit ? [236, 253, 245] : [254, 242, 242],
      borderColor: isProfit ? [110, 231, 183] : [252, 165, 165],
    },
  );

  y += 4;

  // =========================================================================
  // 2. FLUXO DE CAIXA REAL DO PERÍODO
  // =========================================================================
  drawSectionTitle(
    '2. FLUXO DE CAIXA REAL DO PERÍODO (DINHEIRO QUE ENTROU E SAIU)',
    'Movimento financeiro efetivo no caixa, separado por origem e por forma de pagamento',
  );

  drawStatementRow(
    '(+) Vendas à vista e entradas recebidas na hora',
    `+ ${formatBRL(dre.cashFlow.cashSalesInCents)}`,
    { color: DARK_GREEN },
  );
  drawStatementRow(
    '(+) Recebimentos de fiado / parcelas de clientes',
    `+ ${formatBRL(dre.cashFlow.debtPaymentsInCents)}`,
    { color: DARK_GREEN },
  );
  drawStatementRow(
    '(+) Recebimentos de aluguéis',
    `+ ${formatBRL(dre.cashFlow.rentPaymentsInCents)}`,
    { color: DARK_GREEN },
  );
  drawStatementRow(
    '(+) Outras entradas manuais no caixa',
    `+ ${formatBRL(dre.cashFlow.otherInCents)}`,
    { color: DARK_GREEN },
  );
  drawStatementRow('(=) Total de Entradas no Período', formatBRL(dre.cashFlow.totalInCents), {
    bold: true,
    color: DARK_GREEN,
    highlightBg: [240, 253, 244],
    divider: true,
  });

  drawStatementRow(
    '(-) Gastos / Despesas pagas',
    `- ${formatBRL(dre.cashFlow.expensesOutCents)}`,
    { color: dre.cashFlow.expensesOutCents > 0 ? RED_700 : STONE_700 },
  );
  drawStatementRow(
    '(-) Compras de mercadoria / reposição de estoque',
    `- ${formatBRL(dre.cashFlow.stockPurchasesOutCents)}`,
    { color: dre.cashFlow.stockPurchasesOutCents > 0 ? AMBER_800 : STONE_700 },
  );
  if (dre.cashFlow.refundsOutCents > 0 || dre.cashFlow.adjustmentsOutCents > 0) {
    drawStatementRow(
      '(-) Estornos de vendas canceladas / ajustes',
      `- ${formatBRL(dre.cashFlow.refundsOutCents + dre.cashFlow.adjustmentsOutCents)}`,
      { color: RED_700 },
    );
  }
  drawStatementRow('(=) Total de Saídas no Período', `- ${formatBRL(dre.cashFlow.totalOutCents)}`, {
    bold: true,
    color: RED_700,
    highlightBg: [254, 242, 242],
    divider: true,
  });

  drawStatementRow(
    '(=) Saldo Gerado no Período (Entradas - Saídas)',
    formatSignedBRL(dre.cashFlow.netCashFlowCents),
    {
      bold: true,
      color: dre.cashFlow.netCashFlowCents >= 0 ? DARK_GREEN : RED_700,
    },
  );
  drawStatementRow(
    'SALDO TOTAL ATUAL ACUMULADO NO CAIXA',
    formatSignedBRL(dre.cashFlow.currentCashBalanceCents),
    {
      bold: true,
      color: dre.cashFlow.currentCashBalanceCents >= 0 ? DARK_GREEN : RED_700,
      highlightBg: [247, 254, 249],
      borderColor: [167, 243, 208],
    },
  );

  // Payment methods table
  ensureSpace(28);
  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...STONE_700);
  doc.text('Resumo por Forma de Pagamento no Período:', margin, y);
  y += 5;

  doc.setFillColor(245, 245, 244);
  doc.roundedRect(margin, y, contentW, 7, 1, 1, 'F');
  doc.setFontSize(8.8);
  doc.text('FORMA', margin + 3, y + 4.8);
  doc.text('ENTRADAS', margin + 95, y + 4.8, { align: 'right' });
  doc.text('SAÍDAS', margin + 138, y + 4.8, { align: 'right' });
  doc.text('SALDO', rightX - 3, y + 4.8, { align: 'right' });
  y += 10;

  for (const method of ['DINHEIRO', 'PIX', 'CARTAO'] as const) {
    const m = dre.cashFlow.byMethod[method];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.2);
    doc.setTextColor(...STONE_900);
    doc.text(paymentMethodLabel(method), margin + 3, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK_GREEN);
    doc.text(formatBRL(m.inCents), margin + 95, y, { align: 'right' });
    doc.setTextColor(...RED_700);
    doc.text(formatBRL(m.outCents), margin + 138, y, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(m.netCents >= 0 ? STONE_900 : RED_700));
    doc.text(formatSignedBRL(m.netCents), rightX - 3, y, { align: 'right' });
    y += 6;
  }
  y += 4;

  // =========================================================================
  // 3. CONTAS A RECEBER E POSIÇÃO DE ESTOQUE ATUAL
  // =========================================================================
  drawSectionTitle(
    '3. CONTAS A RECEBER E POSIÇÃO ATUAL DO ESTOQUE',
    'Valores que ainda faltam entrar na loja + capital investido atualmente em mercadoria',
  );

  const pos = dre.receivablesAndInventory;
  drawStatementRow('Fiados e Parcelamentos em Aberto', formatBRL(pos.fiadosOpenCents), {
    bold: true,
    note:
      pos.fiadosOverdueCents > 0
        ? `Desse total, ${formatBRL(pos.fiadosOverdueCents)} já estão vencidos`
        : 'Nenhuma parcela de fiado vencida até hoje',
  });
  drawStatementRow('Aluguéis em Aberto a Receber', formatBRL(pos.rentsOpenCents), {
    bold: true,
    note:
      pos.rentsOverdueCents > 0
        ? `Desse total, ${formatBRL(pos.rentsOverdueCents)} estão em atraso`
        : 'Nenhum aluguel em atraso até hoje',
    divider: true,
  });
  drawStatementRow('Total Geral a Receber (Fiados + Aluguéis)', formatBRL(pos.totalReceivableCents), {
    bold: true,
    color: AMBER_800,
    highlightBg: [255, 251, 235],
    borderColor: [253, 230, 138],
  });
  drawStatementRow(
    `Estoque Atual (${pos.inventoryTotalUnits} unidades ativas)`,
    `Custo: ${formatBRL(pos.inventoryCostValueCents)}`,
    {
      bold: true,
      note: `Valor potencial de venda do estoque atual: ${formatBRL(pos.inventorySaleValueCents)}`,
    },
  );
  y += 4;

  // =========================================================================
  // 4. DETALHAMENTO DECLARADO DO PERÍODO
  // =========================================================================
  const drawDetailList = (
    heading: string,
    items: Array<{ col1: string; col2: string; col3: string; value: string; valueColor?: RGB }>,
    emptyMsg: string,
  ) => {
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...DARK_GREEN);
    doc.text(heading, margin, y);
    y += 5;

    if (items.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...STONE_500);
      doc.text(emptyMsg, margin + 2, y);
      y += 6.5;
      return;
    }

    for (const row of items) {
      const descLines = doc.splitTextToSize(row.col2, contentW - 68) as string[];
      const rowH = Math.max(6, descLines.length * 4.4 + 1.8);
      ensureSpace(rowH + 2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);
      doc.setTextColor(...STONE_700);
      doc.text(row.col1, margin + 2, y);

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...STONE_900);
      doc.text(descLines, margin + 23, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...STONE_500);
      doc.text(row.col3, rightX - 28, y, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(row.valueColor ?? STONE_900));
      doc.text(row.value, rightX - 2, y, { align: 'right' });

      y += rowH;
      doc.setDrawColor(231, 229, 228);
      doc.setLineWidth(0.2);
      doc.line(margin, y - 1, rightX, y - 1);
      y += 1.5;
    }
    y += 3;
  };

  drawSectionTitle(
    '4. DETALHAMENTO DECLARADO DOS LANÇAMENTOS E PRODUTOS',
    'Discriminação item a item para conferência e prestação de contas do período',
  );

  drawDetailList(
    `Gastos e Despesas Declarados (${dre.declaredDetails.expenseItems.length})`,
    dre.declaredDetails.expenseItems.map((e) => ({
      col1: formatDateBR(e.date),
      col2: e.description,
      col3: paymentMethodLabel(e.payment_method),
      value: `- ${formatBRL(e.amount_cents)}`,
      valueColor: RED_700,
    })),
    'Nenhum gasto ou despesa lançada neste período.',
  );

  drawDetailList(
    `Compras de Mercadoria / Reposição (${dre.declaredDetails.stockPurchaseItems.length})`,
    dre.declaredDetails.stockPurchaseItems.map((s) => ({
      col1: formatDateBR(s.date),
      col2: s.description,
      col3: paymentMethodLabel(s.payment_method),
      value: `- ${formatBRL(s.amount_cents)}`,
      valueColor: AMBER_800,
    })),
    'Nenhuma compra de mercadoria lançada neste período.',
  );

  drawDetailList(
    `Aluguéis Recebidos (${dre.declaredDetails.rentItems.length})`,
    dre.declaredDetails.rentItems.map((r) => ({
      col1: formatDateBR(r.date),
      col2: `${r.property_name} • ${r.tenant_name} (${formatMonthBR(r.reference_month)})`,
      col3: paymentMethodLabel(r.payment_method),
      value: `+ ${formatBRL(r.amount_cents)}`,
      valueColor: DARK_GREEN,
    })),
    'Nenhum aluguel recebido neste período.',
  );

  drawDetailList(
    `Outras Entradas / Ajustes (${dre.declaredDetails.otherInItems.length})`,
    dre.declaredDetails.otherInItems.map((o) => ({
      col1: formatDateBR(o.date),
      col2: o.description,
      col3: paymentMethodLabel(o.payment_method),
      value: `+ ${formatBRL(o.amount_cents)}`,
      valueColor: DARK_GREEN,
    })),
    'Nenhuma outra entrada manual lançada neste período.',
  );

  // Top Products Ranking
  ensureSpace(22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...DARK_GREEN);
  doc.text(`Produtos Mais Vendidos no Período (${dre.declaredDetails.topProducts.length})`, margin, y);
  y += 5;

  if (dre.declaredDetails.topProducts.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...STONE_500);
    doc.text('Nenhum produto vendido neste período.', margin + 2, y);
    y += 7;
  } else {
    doc.setFillColor(245, 245, 244);
    doc.roundedRect(margin, y, contentW, 7, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...STONE_700);
    doc.text('PRODUTO', margin + 2, y + 4.8);
    doc.text('QTD', margin + 102, y + 4.8, { align: 'right' });
    doc.text('VENDA', margin + 130, y + 4.8, { align: 'right' });
    doc.text('CMV', margin + 154, y + 4.8, { align: 'right' });
    doc.text('LUCRO', rightX - 2, y + 4.8, { align: 'right' });
    y += 10;

    for (const prod of dre.declaredDetails.topProducts) {
      const nameLines = doc.splitTextToSize(prod.product_name, 88) as string[];
      const rowH = Math.max(6, nameLines.length * 4.4 + 1.8);
      ensureSpace(rowH + 2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(...STONE_900);
      doc.text(nameLines, margin + 2, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...STONE_700);
      doc.text(`${prod.qty_sold}x`, margin + 102, y, { align: 'right' });
      doc.text(formatBRL(prod.revenue_cents), margin + 130, y, { align: 'right' });
      doc.text(formatBRL(prod.cost_cents), margin + 154, y, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(prod.profit_cents >= 0 ? DARK_GREEN : RED_700));
      doc.text(formatSignedBRL(prod.profit_cents), rightX - 2, y, { align: 'right' });

      y += rowH;
      doc.setDrawColor(231, 229, 228);
      doc.setLineWidth(0.2);
      doc.line(margin, y - 1, rightX, y - 1);
      y += 1.5;
    }
  }

  // Page numbers on all pages
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(231, 229, 228);
    doc.setLineWidth(0.25);
    doc.line(margin, 283, rightX, 283);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...STONE_500);
    doc.text(
      `Cris Parambu  •  DRE Completo (${fromStr} a ${toStr})`,
      margin,
      288,
    );
    doc.text(`Página ${p} de ${pageCount}`, rightX, 288, { align: 'right' });
  }

  doc.save(`dre-cris-parambu-${dre.period.from}-a-${dre.period.to}.pdf`);
}
