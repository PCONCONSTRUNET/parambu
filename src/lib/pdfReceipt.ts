import { jsPDF } from 'jspdf';
import { formatBRL, formatDateBR, paymentMethodLabel, todayLocalISO } from './format';

export interface ReceiptSaleInput {
  id: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_cpf?: string | null;
  customer_address?: string | null;
  customer_notes?: string | null;
  sale_type: string;
  payment_method: string;
  discount_cents?: number;
  total_cents: number;
  paid_cents: number;
  status?: string;
  sale_date?: string;
  notes?: string | null;
  items?: Array<{
    product_name_snapshot: string;
    quantity: number;
    unit_price_cents: number;
    subtotal_cents: number;
  }>;
  debt?: {
    total_cents?: number;
    paid_cents?: number;
    remaining_cents: number;
    status?: string;
    installments?: Array<{
      installment_number: number;
      due_date: string;
      amount_cents: number;
      paid_cents?: number;
      status?: string;
    }>;
  } | null;
}

export interface ReceiptPaymentInput {
  paymentId: number;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerNotes?: string | null;
  amountCents: number;
  paymentMethod: string;
  paymentDate: string;
  debtDescription: string;
  debtTotalCents?: number;
  debtPaidCents?: number;
  debtRemainingCents?: number;
  notes?: string | null;
}

async function loadLogoPng(): Promise<{ dataUrl: string; aspectRatio: number } | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('logo load failed'));
      el.src = '/logo.png';
    });

    const maxW = 720;
    const scale = img.width > maxW ? maxW / img.width : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      aspectRatio: w / h,
    };
  } catch {
    return null;
  }
}

export async function createReceiptHeader(
  title: string,
  subtitle: string,
): Promise<{ doc: jsPDF; y: number; margin: number; contentW: number }> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 16;
  const contentW = pageW - margin * 2;
  let y = 14;

  const logo = await loadLogoPng();
  if (logo) {
    const logoW = 54;
    const logoH = logoW / (logo.aspectRatio || 3);
    doc.addImage(logo.dataUrl, 'PNG', (pageW - logoW) / 2, y, logoW, logoH);
    y += logoH + 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(11, 70, 25);
  doc.text(title, pageW / 2, y, { align: 'center' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(87, 83, 78);
  doc.text(subtitle, pageW / 2, y, { align: 'center' });
  y += 5;

  doc.setDrawColor(214, 211, 209);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  return { doc, y, margin, contentW };
}

function saleTypeLabelPdf(saleType: string): string {
  if (saleType === 'CASH') return 'À vista';
  if (saleType === 'FIADO') return 'Fiado';
  return 'Parcelado';
}

export async function downloadSaleReceiptPdf(sale: ReceiptSaleInput): Promise<void> {
  const saleDateStr = formatDateBR(sale.sale_date || todayLocalISO());
  const { doc, y: startY, margin, contentW } = await createReceiptHeader(
    'COMPROVANTE DE VENDA',
    `Venda #${sale.id}  •  Data: ${saleDateStr}`,
  );

  const pageW = 210;
  const rightX = pageW - margin;
  let y = startY;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > 276) {
      doc.addPage();
      y = 18;
    }
  };

  if (sale.status === 'CANCELLED') {
    doc.setFillColor(254, 226, 226);
    doc.roundedRect(margin, y, contentW, 9, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(185, 28, 28);
    doc.text('VENDA CANCELADA', pageW / 2, y + 6, { align: 'center' });
    y += 13;
  }

  // Customer & Sale Info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  const customerParts = [
    sale.customer_name || 'Sem nome (venda rápida)',
    sale.customer_phone ? `Tel: ${sale.customer_phone}` : null,
    sale.customer_cpf ? `CPF: ${sale.customer_cpf}` : null,
  ].filter(Boolean);
  const customerLines = doc.splitTextToSize(`Cliente: ${customerParts.join('  •  ')}`, contentW) as string[];
  doc.text(customerLines, margin, y);
  y += customerLines.length * 5.2 + 1;

  if (sale.customer_address || sale.customer_notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(68, 64, 60);
    if (sale.customer_address) {
      const addrLines = doc.splitTextToSize(`Endereço: ${sale.customer_address}`, contentW) as string[];
      doc.text(addrLines, margin, y);
      y += addrLines.length * 4.8 + 1;
    }
    if (sale.customer_notes) {
      const detailLines = doc.splitTextToSize(`Detalhamento: ${sale.customer_notes}`, contentW) as string[];
      doc.text(detailLines, margin, y);
      y += detailLines.length * 4.8 + 1;
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(68, 64, 60);
  const methodSuffix =
    sale.sale_type === 'CASH' || sale.payment_method !== 'FIADO'
      ? ` • Pagamento em ${paymentMethodLabel(sale.payment_method)}`
      : '';
  doc.text(`Condição: ${saleTypeLabelPdf(sale.sale_type)}${methodSuffix}`, margin, y);
  y += 8;

  // Products Table
  const items = sale.items || [];
  if (items.length > 0) {
    ensureSpace(16);
    doc.setFillColor(245, 245, 244);
    doc.roundedRect(margin, y, contentW, 8, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(87, 83, 78);
    doc.text('PRODUTO', margin + 3, y + 5.5);
    doc.text('QTD', margin + contentW - 58, y + 5.5, { align: 'right' });
    doc.text('UNIT.', margin + contentW - 30, y + 5.5, { align: 'right' });
    doc.text('TOTAL', rightX - 3, y + 5.5, { align: 'right' });
    y += 11;

    for (const item of items) {
      const nameLines = doc.splitTextToSize(item.product_name_snapshot, contentW - 68) as string[];
      const rowH = Math.max(7, nameLines.length * 5 + 2);
      ensureSpace(rowH + 2);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(28, 25, 23);
      doc.text(nameLines, margin + 3, y + 2);

      doc.setFont('helvetica', 'normal');
      doc.text(`${item.quantity}x`, margin + contentW - 58, y + 2, { align: 'right' });
      doc.text(formatBRL(item.unit_price_cents), margin + contentW - 30, y + 2, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.text(formatBRL(item.subtotal_cents), rightX - 3, y + 2, { align: 'right' });

      y += rowH;
      doc.setDrawColor(231, 229, 228);
      doc.setLineWidth(0.25);
      doc.line(margin, y - 1, rightX, y - 1);
      y += 2;
    }
    y += 3;
  }

  // Totals Section
  const discountCents = sale.discount_cents ?? 0;
  const subtotalCents = sale.total_cents + discountCents;
  ensureSpace(discountCents > 0 ? 26 : 14);

  if (discountCents > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(87, 83, 78);
    doc.text('Subtotal dos produtos:', margin, y);
    doc.text(formatBRL(subtotalCents), rightX, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(220, 38, 38);
    doc.text('Desconto aplicado:', margin, y);
    doc.text(`- ${formatBRL(discountCents)}`, rightX, y, { align: 'right' });
    y += 7;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(11, 70, 25);
  doc.text('TOTAL DA VENDA:', margin, y);
  doc.text(formatBRL(sale.total_cents), rightX, y, { align: 'right' });
  y += 9;

  // Payment Status & Paid / Remaining Breakdown
  const entryPaidCents = sale.paid_cents;
  const debtPaidCents = sale.debt?.paid_cents ?? 0;
  const totalPaidCents = sale.sale_type === 'CASH' ? sale.paid_cents : entryPaidCents + debtPaidCents;
  const remainingCents =
    sale.sale_type === 'CASH'
      ? 0
      : sale.debt?.remaining_cents ?? Math.max(0, sale.total_cents - totalPaidCents);

  const paymentLines: Array<{ label: string; value: string; color: [number, number, number]; bold?: boolean }> = [];

  if (sale.sale_type === 'CASH') {
    paymentLines.push({
      label: `Pago na hora (${paymentMethodLabel(sale.payment_method)}):`,
      value: formatBRL(totalPaidCents),
      color: [11, 70, 25],
      bold: true,
    });
    paymentLines.push({
      label: 'Situação:',
      value: 'QUITADO (Falta R$ 0,00)',
      color: [22, 101, 52],
      bold: true,
    });
  } else {
    if (entryPaidCents > 0) {
      paymentLines.push({
        label: `Entrada na hora (${paymentMethodLabel(sale.payment_method)}):`,
        value: formatBRL(entryPaidCents),
        color: [68, 64, 60],
      });
    }
    if (debtPaidCents > 0) {
      paymentLines.push({
        label: 'Pagamentos já recebidos:',
        value: formatBRL(debtPaidCents),
        color: [68, 64, 60],
      });
    }
    paymentLines.push({
      label: 'Total já pago até agora:',
      value: formatBRL(totalPaidCents),
      color: [22, 101, 52],
      bold: true,
    });
    if (remainingCents > 0) {
      paymentLines.push({
        label: 'Valor que ainda falta pagar:',
        value: formatBRL(remainingCents),
        color: [194, 65, 12],
        bold: true,
      });
    } else {
      paymentLines.push({
        label: 'Situação:',
        value: 'QUITADO (Falta R$ 0,00)',
        color: [22, 101, 52],
        bold: true,
      });
    }
  }

  const boxHeight = paymentLines.length * 6.5 + 11;
  ensureSpace(boxHeight + 6);

  doc.setFillColor(247, 254, 249);
  doc.setDrawColor(167, 243, 208);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentW, boxHeight, 2.5, 2.5, 'FD');

  let boxY = y + 6.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(11, 70, 25);
  doc.text('RESUMO DO PAGAMENTO', margin + 4, boxY);
  boxY += 6.5;

  for (const row of paymentLines) {
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(...row.color);
    doc.text(row.label, margin + 4, boxY);
    doc.text(row.value, rightX - 4, boxY, { align: 'right' });
    boxY += 6.5;
  }
  y += boxHeight + 7;

  // Installments list if present
  const installments = sale.debt?.installments || [];
  if (installments.length > 0) {
    ensureSpace(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(87, 83, 78);
    doc.text(installments.length > 1 ? 'PARCELAS' : 'VENCIMENTO', margin, y);
    y += 5.5;

    for (const inst of installments) {
      ensureSpace(7);
      const instPaid = inst.paid_cents ?? 0;
      const instRem = Math.max(0, inst.amount_cents - instPaid);
      const isPaid = inst.status === 'PAID' || instRem === 0;
      const label =
        installments.length > 1
          ? `${inst.installment_number}ª parcela • Vencimento ${formatDateBR(inst.due_date)}`
          : `Vencimento em ${formatDateBR(inst.due_date)}`;

      let statusText = `${formatBRL(inst.amount_cents)} (Em aberto)`;
      if (inst.status === 'CANCELLED') {
        statusText = 'Cancelada';
      } else if (isPaid) {
        statusText = `Pago (${formatBRL(inst.amount_cents)})`;
      } else if (instPaid > 0) {
        statusText = `Pago ${formatBRL(instPaid)} • Falta ${formatBRL(instRem)}`;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(28, 25, 23);
      doc.text(label, margin + 2, y);

      doc.setFont('helvetica', 'bold');
      if (isPaid) {
        doc.setTextColor(22, 101, 52);
      } else {
        doc.setTextColor(194, 65, 12);
      }
      doc.text(statusText, rightX - 2, y, { align: 'right' });
      y += 6;
    }
    y += 3;
  }

  if (sale.notes) {
    const noteLines = doc.splitTextToSize(`Obs: ${sale.notes}`, contentW) as string[];
    ensureSpace(noteLines.length * 5 + 6);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(87, 83, 78);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 5 + 4;
  }

  ensureSpace(12);
  doc.setDrawColor(231, 229, 228);
  doc.line(margin, y + 2, rightX, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(
    `Cris Parambu  •  Comprovante emitido em ${formatDateBR(todayLocalISO())}`,
    pageW / 2,
    y + 8,
    { align: 'center' },
  );

  doc.save(`comprovante-venda-${sale.id}.pdf`);
}

export async function downloadPaymentReceiptPdf(payment: ReceiptPaymentInput): Promise<void> {
  const { doc, y: startY, margin, contentW } = await createReceiptHeader(
    'RECIBO DE PAGAMENTO',
    `Pagamento #${payment.paymentId}  •  Data: ${formatDateBR(payment.paymentDate)}`,
  );

  const pageW = 210;
  const rightX = pageW - margin;
  let y = startY;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(28, 25, 23);
  doc.text(
    `Cliente: ${payment.customerName}${payment.customerPhone ? `  •  Tel: ${payment.customerPhone}` : ''}`,
    margin,
    y,
  );
  y += 6;

  if (payment.customerAddress || payment.customerNotes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(68, 64, 60);
    if (payment.customerAddress) {
      const addrLines = doc.splitTextToSize(`Endereço: ${payment.customerAddress}`, contentW) as string[];
      doc.text(addrLines, margin, y);
      y += addrLines.length * 4.8 + 1;
    }
    if (payment.customerNotes) {
      const detailLines = doc.splitTextToSize(`Detalhamento: ${payment.customerNotes}`, contentW) as string[];
      doc.text(detailLines, margin, y);
      y += detailLines.length * 4.8 + 1;
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(68, 64, 60);
  doc.text(`Forma de pagamento: ${paymentMethodLabel(payment.paymentMethod)}`, margin, y);
  y += 6;

  const refLines = doc.splitTextToSize(`Referente a: ${payment.debtDescription}`, contentW) as string[];
  doc.text(refLines, margin, y);
  y += refLines.length * 5.5 + 4;

  const rows: Array<{ label: string; value: string; color: [number, number, number]; bold?: boolean }> = [
    {
      label: 'Valor pago neste recibo:',
      value: formatBRL(payment.amountCents),
      color: [11, 70, 25],
      bold: true,
    },
  ];

  if (payment.debtTotalCents !== undefined) {
    rows.push({
      label: 'Total da dívida:',
      value: formatBRL(payment.debtTotalCents),
      color: [68, 64, 60],
    });
  }
  if (payment.debtPaidCents !== undefined) {
    rows.push({
      label: 'Total já pago:',
      value: formatBRL(payment.debtPaidCents),
      color: [22, 101, 52],
      bold: true,
    });
  }
  if (payment.debtRemainingCents !== undefined) {
    rows.push({
      label: payment.debtRemainingCents > 0 ? 'Valor que ainda falta pagar:' : 'Situação:',
      value: payment.debtRemainingCents > 0 ? formatBRL(payment.debtRemainingCents) : 'QUITADO (R$ 0,00)',
      color: payment.debtRemainingCents > 0 ? [194, 65, 12] : [22, 101, 52],
      bold: true,
    });
  }

  const boxH = rows.length * 7 + 8;
  doc.setFillColor(247, 254, 249);
  doc.setDrawColor(167, 243, 208);
  doc.roundedRect(margin, y, contentW, boxH, 2.5, 2.5, 'FD');

  let boxY = y + 7.5;
  for (const r of rows) {
    doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...r.color);
    doc.text(r.label, margin + 4, boxY);
    doc.text(r.value, rightX - 4, boxY, { align: 'right' });
    boxY += 7;
  }
  y += boxH + 7;

  if (payment.notes) {
    const noteLines = doc.splitTextToSize(`Obs: ${payment.notes}`, contentW) as string[];
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(87, 83, 78);
    doc.text(noteLines, margin, y);
    y += noteLines.length * 5 + 4;
  }

  doc.setDrawColor(231, 229, 228);
  doc.line(margin, y + 2, rightX, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 113, 108);
  doc.text(
    `Cris Parambu  •  Recibo emitido em ${formatDateBR(todayLocalISO())}`,
    pageW / 2,
    y + 8,
    { align: 'center' },
  );

  doc.save(`recibo-pagamento-${payment.paymentId}.pdf`);
}
