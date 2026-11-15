import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Edit3,
  FileSpreadsheet,
  MinusCircle,
  PlusCircle,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  Wallet,
} from 'lucide-react';
import { api, getCachedApi } from '../lib/api';
import { downloadDreReportPdf, type DreReportData } from '../lib/drePdf';
import { matchesFlexibleSearch } from '../lib/search';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import {
  centsToInputString,
  formatBRL,
  formatDateBR,
  monthStartLocalISO,
  parseMoneyToCents,
  paymentMethodLabel,
  todayLocalISO,
} from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import {
  PaymentMethodInline,
  PaymentMethodSelector,
} from '../components/PaymentMethodIcon';
import { SaleDetailModal, type SaleDetailData, SalePaymentBadges, saleTypeLabel } from '../components/SaleDetailModal';

interface SaleRecord {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf: string | null;
  sale_type: 'CASH' | 'FIADO' | 'INSTALLMENT';
  payment_method: string;
  discount_cents?: number;
  total_cents: number;
  profit_cents: number;
  paid_cents: number;
  status: 'COMPLETED' | 'CANCELLED';
  sale_date: string;
  items_summary: string | null;
  debt_remaining_cents: number | null;
  debt_status: 'OPEN' | 'PAID' | 'CANCELLED' | null;
  installment_count: number | null;
  installment_amount_cents: number | null;
  next_due_date: string | null;
  first_due_date: string | null;
  last_due_date: string | null;
}

interface DebtPaymentRecord {
  id: number;
  debt_id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  customer_cpf: string | null;
  amount_cents: number;
  payment_method: 'DINHEIRO' | 'PIX' | 'CARTAO';
  payment_date: string;
  notes: string | null;
  status: 'ACTIVE' | 'REVERSED';
  debt_description: string;
  sale_id: number | null;
  debt_total_cents: number;
  debt_remaining_cents: number;
  debt_status: 'OPEN' | 'PAID' | 'CANCELLED';
}

interface TransactionRecord {
  id: number;
  direction: 'IN' | 'OUT';
  category: string;
  description: string;
  amount_cents: number;
  payment_method: string;
  transaction_date: string;
  due_date?: string | null;
  reference_type: string | null;
  reference_id: number | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_cpf: string | null;
  sale_id: number | null;
  sale_type: string | null;
  sale_status: string | null;
  items_summary: string | null;
  property_id: number | null;
  property_name: string | null;
  tenant_name: string | null;
}

interface FinanceData {
  period: { from: string; to: string };
  receivedTodayCents: number;
  cashBalanceCents: number;
  fiadosReceivableCents: number;
  rentsReceivableCents: number;
  totalReceivableCents: number;
  paymentMethodTotals: {
    DINHEIRO: { inCents: number; outCents: number };
    PIX: { inCents: number; outCents: number };
    CARTAO: { inCents: number; outCents: number };
  };
  periodStats: {
    totalInCents: number;
    totalOutCents: number;
    netFlowCents: number;
    cashSalesInCents: number;
    debtPaymentsInCents: number;
    rentPaymentsInCents: number;
    otherInCents: number;
    adjustmentsInCents: number;
    otherRevenuesCents: number;
    expensesOutCents: number;
    adjustmentsOutCents: number;
    operatingExpensesCents: number;
    stockPurchasesOutCents: number;
    refundsOutCents: number;
    salesCount: number;
    salesTotalCents: number;
    salesCostCents: number;
    grossProfitCents: number;
    netProfitCents: number;
  };
  transactions: TransactionRecord[];
  sales: SaleRecord[];
  debtPayments: DebtPaymentRecord[];
}

interface UnifiedPaymentItem {
  key: string;
  kind: 'CASH_SALE' | 'DEBT_PAYMENT';
  paymentId?: number;
  isReversed?: boolean;
  title: string;
  subtitle: string | null;
  customerId: number | null;
  customerName: string | null;
  customerCpf: string | null;
  saleId: number | null;
  date: string;
  method: string;
  amountCents: number;
  discountCents?: number;
  statusLabel: string | null;
  statusTone: 'emerald' | 'orange' | 'red' | 'stone';
}

function addDaysLocal(baseIso: string, delta: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function monthEndLocalISO(): string {
  const [y, m] = todayLocalISO().split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function matchesRecordSearch(
  query: string,
  fields: Array<string | null | undefined>,
  cpfOrNumericFields: Array<string | null | undefined> = [],
): boolean {
  return matchesFlexibleSearch(query, fields, cpfOrNumericFields);
}

export function MoneyPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [preset, setPreset] = useState<'today' | 'week' | 'month' | 'custom'>('month');
  const [from, setFrom] = useState(() => monthStartLocalISO());
  const [to, setTo] = useState(() => monthEndLocalISO());
  const [activeTab, setActiveTab] = useState<'payments' | 'sales' | 'cash'>('payments');
  const [salesFilter, setSalesFilter] = useState<'ALL' | 'CASH' | 'CREDIT' | 'OPEN_DEBT'>('ALL');
  const [dirFilter, setDirFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [search, setSearch] = useState('');
  const initialFinancePath = `/finance?${new URLSearchParams({
    from: monthStartLocalISO(),
    to: monthEndLocalISO(),
    direction: 'ALL',
  }).toString()}`;
  const [data, setData] = useState<FinanceData | null>(
    () => getCachedApi<FinanceData>(initialFinancePath) ?? null,
  );
  const [loading, setLoading] = useState(() => !getCachedApi(initialFinancePath));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<SaleDetailData | null>(null);
  const [saleInitialEdit, setSaleInitialEdit] = useState(false);
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);

  // Manual / Movement Entry Modal
  const [txModal, setTxModal] = useState<'EXPENSE' | 'STOCK_PURCHASE' | 'OTHER_IN' | null>(null);
  const [editingTxId, setEditingTxId] = useState<number | null>(null);
  const [editingTxRecord, setEditingTxRecord] = useState<TransactionRecord | null>(null);
  const [txDesc, setTxDesc] = useState('');
  const [txAmountText, setTxAmountText] = useState('');
  const [txMethod, setTxMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [txDate, setTxDate] = useState(() => todayLocalISO());
  const [txDueDate, setTxDueDate] = useState('');
  const [savingTx, setSavingTx] = useState(false);
  const [generatingDre, setGeneratingDre] = useState(false);

  const { showSuccess, showError, confirmAction } = useFeedback();

  const applyPreset = (p: 'today' | 'week' | 'month' | 'custom') => {
    setPreset(p);
    const today = todayLocalISO();
    if (p === 'today') {
      setFrom(today);
      setTo(today);
    } else if (p === 'week') {
      setFrom(addDaysLocal(today, -6));
      setTo(today);
    } else if (p === 'month') {
      setFrom(monthStartLocalISO());
      setTo(monthEndLocalISO());
    }
  };

  const load = useCallback(
    async (
      silent = false,
      override?: { from?: string; to?: string; direction?: 'ALL' | 'IN' | 'OUT' },
    ) => {
      if (!silent) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const qs = new URLSearchParams({
          from: override?.from ?? from,
          to: override?.to ?? to,
          direction: override?.direction ?? dirFilter,
        });
        const res = await api<FinanceData>(`/finance?${qs.toString()}`);
        setData(res);
        setLoadError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar dinheiro.';
        if (!silent) {
          setLoadError(msg);
          showError(msg);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [from, to, dirFilter, showError],
  );

  useEffect(() => {
    const qs = new URLSearchParams({
      from,
      to,
      direction: dirFilter,
    });
    const cached = getCachedApi<FinanceData>(`/finance?${qs.toString()}`);
    if (cached) {
      setData(cached);
      setLoadError(null);
    }
    load(Boolean(cached));
  }, [load, from, to, dirFilter]);

  useLiveRefresh(() => load(true));

  const openSaleDetail = useCallback(
    async (saleId: number, editMode = false) => {
      try {
        const res = await api<{ sale: SaleDetailData }>(`/sales/${saleId}`);
        setSaleInitialEdit(editMode);
        setSelectedSale(res.sale);
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Erro ao abrir venda.');
      }
    },
    [showError],
  );

  const handleQuickDeleteSale = async (sale: FinanceData['sales'][number]) => {
    const confirmed = await confirmAction({
      title: `Excluir Venda #${sale.id}?`,
      message: `Valor de ${formatBRL(sale.total_cents)}. Os produtos voltam para o estoque e o caixa será reajustado automaticamente.`,
      confirmLabel: 'Sim, excluir',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/sales/${sale.id}`, { method: 'DELETE' });
      showSuccess('Venda excluída! Estoque e caixa reajustados.');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao excluir venda.');
    }
  };

  const vendaParam = searchParams.get('venda');
  useEffect(() => {
    const id = Number(vendaParam);
    if (Number.isInteger(id) && id > 0) {
      openSaleDetail(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('venda');
          return next;
        },
        { replace: true },
      );
    }
  }, [vendaParam, openSaleDetail, setSearchParams]);

  const handleSaveTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txModal) return;
    const amountCents = parseMoneyToCents(txAmountText);
    if (amountCents <= 0) {
      showError('Coloque um valor maior que zero.');
      return;
    }

    setSavingTx(true);
    try {
      const isSystemManaged =
        editingTxRecord !== null && editingTxRecord.reference_type !== 'MANUAL';
      const payload = {
        direction: isSystemManaged
          ? editingTxRecord.direction
          : txModal === 'OTHER_IN'
            ? 'IN'
            : 'OUT',
        category: isSystemManaged ? editingTxRecord.category : txModal,
        description: txDesc,
        amountCents,
        paymentMethod: txMethod,
        transactionDate: txDate,
        dueDate: txDueDate || null,
      };
      if (editingTxId) {
        await api(`/finance/transactions/${editingTxId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showSuccess('Lançamento atualizado!');
      } else {
        await api('/finance/transactions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showSuccess('Anotado no dinheiro!');
      }
      const isOtherIn = payload.direction === 'IN';
      const nextFrom = txDate < from ? txDate : from;
      const nextTo = txDate > to ? txDate : to;
      const nextDir: 'ALL' | 'IN' | 'OUT' =
        (isOtherIn && dirFilter === 'OUT') || (!isOtherIn && dirFilter === 'IN')
          ? 'ALL'
          : dirFilter;

      if (nextFrom !== from) {
        setFrom(nextFrom);
        setPreset('custom');
      }
      if (nextTo !== to) {
        setTo(nextTo);
        setPreset('custom');
      }
      if (nextDir !== dirFilter) {
        setDirFilter(nextDir);
      }

      setActiveTab('cash');
      setTxModal(null);
      setEditingTxId(null);
      setEditingTxRecord(null);
      await load(false, { from: nextFrom, to: nextTo, direction: nextDir });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar lançamento.');
    } finally {
      setSavingTx(false);
    }
  };

  const openTxModal = (kind: 'EXPENSE' | 'STOCK_PURCHASE' | 'OTHER_IN') => {
    setEditingTxId(null);
    setEditingTxRecord(null);
    setTxModal(kind);
    setTxDesc('');
    setTxAmountText('');
    setTxMethod('DINHEIRO');
    setTxDate(todayLocalISO());
    setTxDueDate('');
  };

  const openEditTxModal = (tx: TransactionRecord) => {
    if (tx.sale_id && tx.reference_type === 'SALE') {
      setSelectedTx(null);
      void openSaleDetail(tx.sale_id, true);
      return;
    }
    const kind: 'EXPENSE' | 'STOCK_PURCHASE' | 'OTHER_IN' =
      tx.direction === 'IN'
        ? 'OTHER_IN'
        : tx.category === 'STOCK_PURCHASE'
          ? 'STOCK_PURCHASE'
          : 'EXPENSE';
    setSelectedTx(null);
    setEditingTxId(tx.id);
    setEditingTxRecord(tx);
    setTxModal(kind);
    setTxDesc(tx.description);
    setTxAmountText(centsToInputString(tx.amount_cents));
    setTxMethod(
      tx.payment_method === 'PIX' || tx.payment_method === 'CARTAO' ? tx.payment_method : 'DINHEIRO',
    );
    setTxDate(tx.transaction_date || todayLocalISO());
    setTxDueDate(tx.due_date || '');
  };

  const handleDeleteTx = async (tx: TransactionRecord) => {
    const isSale = tx.reference_type === 'SALE' && Boolean(tx.sale_id);
    const detailText = isSale
      ? `Excluir a venda #${tx.sale_id} (${formatBRL(tx.amount_cents)})? Os produtos voltam para o estoque e o caixa será reajustado automaticamente.`
      : tx.reference_type === 'RENT_PAYMENT'
        ? `Excluir "${tx.description}" (${formatBRL(tx.amount_cents)})? O valor sai do caixa e o aluguel volta a ficar pendente.`
        : tx.reference_type === 'DEBT_PAYMENT'
          ? `Excluir "${tx.description}" (${formatBRL(tx.amount_cents)})? O valor sai do caixa e volta para o fiado do cliente.`
          : `Tem certeza que deseja excluir "${tx.description}" (${formatBRL(tx.amount_cents)}) do caixa?`;

    const confirmed = await confirmAction({
      title: isSale ? `Excluir Venda #${tx.sale_id}?` : 'Excluir lançamento?',
      message: detailText,
      confirmLabel: 'Sim, excluir',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      if (isSale) {
        await api(`/sales/${tx.sale_id}`, { method: 'DELETE' });
        showSuccess('Venda excluída! Estoque e caixa reajustados.');
      } else {
        await api(`/finance/transactions/${tx.id}`, { method: 'DELETE' });
        showSuccess('Lançamento excluído e caixa reajustado!');
      }
      setSelectedTx((prev) => (prev?.id === tx.id ? null : prev));
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao excluir lançamento.');
    }
  };

  const handleReverseDebtPayment = async (paymentId: number, amountCents: number) => {
    const confirmed = await confirmAction({
      title: 'Estornar recebimento?',
      message: `Estornar ${formatBRL(amountCents)}? O valor volta a ficar em aberto na conta do cliente e sai do caixa.`,
      confirmLabel: 'Sim, estornar',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/debts/payments/${paymentId}`, { method: 'DELETE' });
      showSuccess('Pagamento estornado com sucesso!');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao estornar pagamento.');
    }
  };

  const handleDownloadDre = async () => {
    setGeneratingDre(true);
    try {
      const qs = new URLSearchParams({ from, to });
      const dre = await api<DreReportData>(`/finance/dre?${qs.toString()}`);
      await downloadDreReportPdf(dre);
      showSuccess('DRE completo gerado em PDF!');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao gerar DRE em PDF.');
    } finally {
      setGeneratingDre(false);
    }
  };

  const categoryLabel = (cat: string) => {
    switch (cat) {
      case 'CASH_SALE':
        return 'Venda à vista';
      case 'DEBT_PAYMENT':
        return 'Recebimento de fiado';
      case 'RENT_PAYMENT':
        return 'Recebimento de aluguel';
      case 'EXPENSE':
        return 'Gasto / Saída';
      case 'STOCK_PURCHASE':
        return 'Compra de mercadoria';
      case 'SALE_REFUND':
        return 'Estorno / Cancelamento';
      case 'OTHER_IN':
        return 'Outra entrada';
      default:
        return 'Acerto';
    }
  };

  const unifiedPayments = useMemo<UnifiedPaymentItem[]>(() => {
    if (!data) return [];
    const items: UnifiedPaymentItem[] = [];

    for (const s of data.sales) {
      if (s.paid_cents > 0) {
        items.push({
          key: `sale-${s.id}`,
          kind: 'CASH_SALE',
          title: s.items_summary || `Venda #${s.id}`,
          subtitle:
            s.sale_type === 'CASH'
              ? `Venda à vista #${s.id}`
              : `Entrada da venda #${s.id} (${saleTypeLabel(s.sale_type)})`,
          customerId: s.customer_id,
          customerName: s.customer_name,
          customerCpf: s.customer_cpf,
          saleId: s.id,
          date: s.sale_date,
          method: s.payment_method,
          amountCents: s.paid_cents,
          discountCents: s.discount_cents ?? 0,
          statusLabel:
            s.status === 'CANCELLED'
              ? 'Venda cancelada'
              : s.debt_remaining_cents && s.debt_remaining_cents > 0
                ? `Falta ${formatBRL(s.debt_remaining_cents)}`
                : 'Pago total',
          statusTone:
            s.status === 'CANCELLED'
              ? 'red'
              : s.debt_remaining_cents && s.debt_remaining_cents > 0
                ? 'orange'
                : 'emerald',
        });
      }
    }

    for (const dp of data.debtPayments) {
      items.push({
        key: `dp-${dp.id}`,
        kind: 'DEBT_PAYMENT',
        paymentId: dp.id,
        isReversed: dp.status === 'REVERSED',
        title: dp.debt_description,
        subtitle: dp.notes ? `Obs: ${dp.notes}` : 'Pagamento de fiado / parcela',
        customerId: dp.customer_id,
        customerName: dp.customer_name,
        customerCpf: dp.customer_cpf,
        saleId: dp.sale_id,
        date: dp.payment_date,
        method: dp.payment_method,
        amountCents: dp.amount_cents,
        statusLabel:
          dp.status === 'REVERSED'
            ? 'Estornado'
            : dp.debt_status === 'PAID'
              ? 'Quitou o fiado'
              : `Falta ${formatBRL(dp.debt_remaining_cents)}`,
        statusTone:
          dp.status === 'REVERSED'
            ? 'red'
            : dp.debt_status === 'PAID'
              ? 'emerald'
              : 'orange',
      });
    }

    items.sort((a, b) => (a.date === b.date ? b.key.localeCompare(a.key) : b.date.localeCompare(a.date)));

    return items.filter((item) =>
      matchesRecordSearch(
        search,
        [item.title, item.subtitle, item.customerName, item.customerCpf, paymentMethodLabel(item.method)],
        [item.customerCpf, item.saleId ? String(item.saleId) : null],
      ),
    );
  }, [data, search]);

  const filteredSales = useMemo(() => {
    if (!data) return [];
    return data.sales.filter((s) => {
      if (salesFilter === 'CASH' && s.sale_type !== 'CASH') return false;
      if (salesFilter === 'CREDIT' && s.sale_type === 'CASH') return false;
      if (salesFilter === 'OPEN_DEBT' && !(s.status === 'COMPLETED' && (s.debt_remaining_cents ?? 0) > 0)) {
        return false;
      }
      return matchesRecordSearch(
        search,
        [
          `#${s.id}`,
          s.items_summary,
          s.customer_name,
          s.customer_cpf,
          saleTypeLabel(s.sale_type),
          paymentMethodLabel(s.payment_method),
        ],
        [s.customer_cpf, s.customer_phone, String(s.id)],
      );
    });
  }, [data, salesFilter, search]);

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    return data.transactions.filter((tx) =>
      matchesRecordSearch(
        search,
        [
          tx.description,
          tx.items_summary,
          tx.customer_name,
          tx.customer_cpf,
          tx.property_name,
          tx.tenant_name,
          categoryLabel(tx.category),
          paymentMethodLabel(tx.payment_method),
        ],
        [tx.customer_cpf, tx.sale_id ? String(tx.sale_id) : null],
      ),
    );
  }, [data, search]);

  const paymentsFilteredTotal = useMemo(
    () =>
      unifiedPayments
        .filter((i) => i.statusTone !== 'red')
        .reduce((sum, i) => sum + i.amountCents, 0),
    [unifiedPayments],
  );

  const salesFilteredTotals = useMemo(() => {
    const active = filteredSales.filter((s) => s.status === 'COMPLETED');
    return {
      count: active.length,
      totalCents: active.reduce((sum, s) => sum + s.total_cents, 0),
      profitCents: active.reduce((sum, s) => sum + s.profit_cents, 0),
    };
  }, [filteredSales]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => openTxModal('OTHER_IN')}
          className="py-3.5 px-3 rounded-2xl bg-emerald-100 hover:bg-emerald-200 border-2 border-emerald-300 text-emerald-950 font-extrabold text-sm flex items-center justify-center gap-2"
        >
          <PlusCircle className="w-5 h-5 text-emerald-700 shrink-0" />
          Anotar Entrada
        </button>
        <button
          type="button"
          onClick={() => openTxModal('EXPENSE')}
          className="py-3.5 px-3 rounded-2xl bg-red-100 hover:bg-red-200 border-2 border-red-300 text-red-950 font-extrabold text-sm flex items-center justify-center gap-2"
        >
          <MinusCircle className="w-5 h-5 text-red-700 shrink-0" />
          Anotar Saída / Gasto
        </button>
      </div>

      {/* Period Filter */}
      <div className="bg-white rounded-2xl border-2 border-stone-200 p-3 space-y-2.5">
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              { key: 'today', label: 'Hoje' },
              { key: 'week', label: '7 dias' },
              { key: 'month', label: 'Este mês' },
              { key: 'custom', label: 'Datas' },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              className={`py-2.5 rounded-xl font-extrabold text-sm border ${
                preset === p.key
                  ? 'bg-[#0B4619] text-white border-[#0B4619]'
                  : 'bg-stone-50 text-stone-700 border-stone-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-stone-600">De</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm font-bold"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Até</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm font-bold"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Financial Cards */}
      {!data && loading ? (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border-2 border-stone-200 p-4 text-center text-sm font-extrabold text-stone-600 animate-pulse">
            Carregando dinheiro e resumo...
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-2xl bg-white border border-stone-200 animate-pulse" />
            <div className="h-24 rounded-2xl bg-white border border-stone-200 animate-pulse" />
          </div>
        </div>
      ) : !data ? (
        <div className="bg-white rounded-2xl border-2 border-red-200 p-5 text-center space-y-3">
          <div className="text-sm font-extrabold text-red-800">
            {loadError || 'Não foi possível carregar o dinheiro agora.'}
          </div>
          <button
            type="button"
            onClick={() => load(false)}
            className="px-5 py-2.5 rounded-xl bg-[#0B4619] hover:bg-[#115E2B] text-white text-sm font-extrabold"
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${loading ? 'opacity-65' : ''}`}>
          {/* Apenas 2 blocos diretos: Caixa Atual e Despesas/Saídas */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setDirFilter('ALL');
                setActiveTab('cash');
              }}
              className={`text-left text-white rounded-2xl p-4 shadow-sm transition active:scale-[0.99] ${
                data.cashBalanceCents >= 0
                  ? 'bg-emerald-700 hover:bg-emerald-800'
                  : 'bg-red-700 hover:bg-red-800'
              }`}
            >
              <div className="text-xs font-extrabold uppercase tracking-wide opacity-90">
                Caixa atual
              </div>
              <div className="text-2xl font-black mt-1">{formatBRL(data.cashBalanceCents)}</div>
              <div className="text-xs font-bold opacity-90 mt-1 leading-snug">
                Entrou: {formatBRL(data.periodStats.totalInCents)}
              </div>
              <div className="text-[11px] font-bold opacity-85 mt-0.5">
                Saldo no período: {formatBRL(data.periodStats.netFlowCents)}
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setDirFilter('OUT');
                setActiveTab('cash');
              }}
              className="text-left bg-red-50 hover:bg-red-100 border-2 border-red-200 rounded-2xl p-4 transition active:scale-[0.99]"
            >
              <div className="text-xs font-extrabold uppercase tracking-wide text-red-900">
                Despesas / Saídas
              </div>
              <div className="text-2xl font-black text-red-700 mt-1">
                {formatBRL(data.periodStats.totalOutCents)}
              </div>
              <div className="text-xs font-bold text-red-900/80 mt-1 leading-snug">
                Gastos {formatBRL(data.periodStats.operatingExpensesCents)} • Mercadoria{' '}
                {formatBRL(data.periodStats.stockPurchasesOutCents)}
              </div>
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownloadDre}
            disabled={generatingDre}
            className="w-full py-3.5 px-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] disabled:opacity-60 border-2 border-[#073311] text-white shadow-xs flex items-center justify-center gap-2.5 transition"
          >
            <FileSpreadsheet className="w-5 h-5 shrink-0" />
            <div className="text-left">
              <div className="text-sm font-extrabold leading-tight">
                {generatingDre ? 'Gerando DRE Completo...' : 'Gerar DRE Completo (PDF)'}
              </div>
              <div className="text-[11px] font-bold text-emerald-100/90 leading-tight mt-0.5">
                {formatDateBR(data.period.from)} até {formatDateBR(data.period.to)} • Lucro, vendas, gastos e a receber
              </div>
            </div>
          </button>

          {/* Records Area: Payments, Product Sales, Full Cash */}
          <section className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('payments')}
                className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
                  activeTab === 'payments'
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                <Banknote className="w-4 h-4 shrink-0" />
                Pagamentos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sales')}
                className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
                  activeTab === 'sales'
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                <ShoppingBag className="w-4 h-4 shrink-0" />
                Vendas ({data.sales.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('cash')}
                className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
                  activeTab === 'cash'
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                <Wallet className="w-4 h-4 shrink-0" />
                Caixa ({data.transactions.length})
              </button>
            </div>

            <div className="flex items-center bg-white border-[3px] border-stone-400 rounded-2xl px-3.5 shadow-xs focus-within:border-[#0B4619]">
              <Search className="w-5 h-5 text-stone-600 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por produto, cliente, CPF ou descrição..."
                className="w-full px-3 py-3 text-base font-bold placeholder:text-stone-500 focus:outline-none"
              />
            </div>

            {/* TAB 1: PAGAMENTOS RECEBIDOS DE PRODUTOS */}
            {activeTab === 'payments' && (
              <div className="space-y-2">
                <div className="px-3.5 py-2 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs sm:text-sm font-extrabold text-emerald-950">
                  <span>
                    {unifiedPayments.length}{' '}
                    {unifiedPayments.length === 1 ? 'pagamento' : 'pagamentos'}
                  </span>
                  <span>Total: {formatBRL(paymentsFilteredTotal)}</span>
                </div>

                {unifiedPayments.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center text-stone-500 font-bold">
                    Nenhum pagamento encontrado nesse período.
                  </div>
                ) : (
                  unifiedPayments.map((item) => (
                    <div
                      key={item.key}
                      className="bg-white rounded-2xl border-2 border-stone-200 p-3 space-y-2 shadow-xs"
                    >
                      {/* Top header: date/method on left, amount on right */}
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-stone-200">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-stone-500 flex items-center gap-1.5 flex-wrap">
                            <span>{formatDateBR(item.date)}</span>
                            <span>•</span>
                            <PaymentMethodInline method={item.method} iconClassName="w-3.5 h-3.5" />
                            {item.subtitle && (
                              <>
                                <span>•</span>
                                <span className="text-stone-700 font-extrabold">{item.subtitle}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div
                          className={`text-lg font-black shrink-0 whitespace-nowrap ${
                            item.statusTone === 'red'
                              ? 'line-through text-stone-400'
                              : 'text-emerald-800'
                          }`}
                        >
                          + {formatBRL(item.amountCents)}
                        </div>
                      </div>

                      {/* Body: full-width item & customer info + status badges */}
                      <div className="space-y-1">
                        <div className="text-sm font-black text-stone-900 leading-snug">
                          {item.title}
                        </div>
                        {item.customerName && (
                          <div className="text-xs font-bold text-stone-600">
                            Cliente: {item.customerName}
                            {item.customerCpf ? ` • CPF ${item.customerCpf}` : ''}
                          </div>
                        )}
                        {(item.statusLabel || (item.discountCents ?? 0) > 0) && (
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            {item.statusLabel && (
                              <span
                                className={`px-2 py-0.5 rounded-lg border text-[11px] font-extrabold ${
                                  item.statusTone === 'emerald'
                                    ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                                    : item.statusTone === 'orange'
                                      ? 'bg-orange-100 border-orange-300 text-orange-900'
                                      : item.statusTone === 'red'
                                        ? 'bg-red-100 border-red-300 text-red-900'
                                        : 'bg-stone-100 border-stone-300 text-stone-700'
                                }`}
                              >
                                {item.statusLabel}
                              </span>
                            )}
                            {(item.discountCents ?? 0) > 0 && (
                              <span className="px-2 py-0.5 rounded-lg border border-red-300 text-[11px] font-extrabold bg-red-100 text-red-700">
                                Desconto -{formatBRL(item.discountCents!)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Bottom action bar */}
                      {(item.customerId || item.saleId || (item.paymentId && !item.isReversed)) && (
                        <div className="flex items-center flex-wrap gap-1.5 pt-1.5 border-t border-stone-200">
                          {item.customerId && (
                            <Link
                              to={`/clientes/${item.customerId}`}
                              className="flex-1 py-1.5 px-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 text-xs font-extrabold text-center"
                            >
                              Ver cliente
                            </Link>
                          )}
                          {item.saleId && (
                            <button
                              type="button"
                              onClick={() => openSaleDetail(item.saleId!)}
                              className="flex-1 py-1.5 px-2.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 text-xs font-extrabold inline-flex items-center justify-center gap-1.5"
                            >
                              <ReceiptText className="w-3.5 h-3.5" /> Ver venda #{item.saleId}
                            </button>
                          )}
                          {item.paymentId && !item.isReversed && (
                            <button
                              type="button"
                              onClick={() => handleReverseDebtPayment(item.paymentId!, item.amountCents)}
                              className="py-1.5 px-2.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 text-xs font-extrabold inline-flex items-center justify-center gap-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Estornar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: VENDAS DE PRODUTOS */}
            {activeTab === 'sales' && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: 'ALL', label: 'Todas' },
                      { key: 'CASH', label: 'À vista' },
                      { key: 'CREDIT', label: 'Fiado / Parcelado' },
                      { key: 'OPEN_DEBT', label: 'Falta receber' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setSalesFilter(f.key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border ${
                        salesFilter === f.key
                          ? 'bg-[#0B4619] text-white border-[#0B4619]'
                          : 'bg-white text-stone-700 border-stone-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="px-3.5 py-2 rounded-2xl bg-stone-100 border border-stone-200 flex items-center justify-between text-xs sm:text-sm font-extrabold text-stone-800 flex-wrap gap-2">
                  <span>
                    {salesFilteredTotals.count}{' '}
                    {salesFilteredTotals.count === 1 ? 'venda concluída' : 'vendas concluídas'}
                  </span>
                  <span>
                    Vendas: {formatBRL(salesFilteredTotals.totalCents)} • Lucro:{' '}
                    {formatBRL(salesFilteredTotals.profitCents)}
                  </span>
                </div>

                {filteredSales.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center text-stone-500 font-bold">
                    Nenhuma venda encontrada nesse período.
                  </div>
                ) : (
                  filteredSales.map((s) => (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openSaleDetail(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openSaleDetail(s.id);
                        }
                      }}
                      className="w-full text-left bg-white rounded-2xl border-2 border-stone-200 hover:border-[#0B4619] p-3 space-y-1.5 transition cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-extrabold text-sm sm:text-base text-stone-900 leading-snug">
                            {s.items_summary || `Venda #${s.id}`}
                          </div>
                          <div className="text-xs font-bold text-stone-600 mt-0.5">
                            #{s.id} • {s.customer_name || 'Cliente sem nome'}
                            {s.customer_cpf ? ` • CPF ${s.customer_cpf}` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div
                            className={`text-lg font-black ${
                              s.status === 'CANCELLED' ? 'line-through text-stone-400' : 'text-[#0B4619]'
                            }`}
                          >
                            {formatBRL(s.total_cents)}
                          </div>
                          <div className="text-[11px] font-bold text-stone-500">
                            {formatDateBR(s.sale_date)}
                          </div>
                        </div>
                      </div>

                      <SalePaymentBadges
                        saleType={s.sale_type}
                        paymentMethod={s.payment_method}
                        status={s.status}
                        profitCents={s.profit_cents}
                        discountCents={s.discount_cents}
                        debtRemainingCents={s.debt_remaining_cents}
                        installmentCount={s.installment_count}
                        installmentAmountCents={s.installment_amount_cents}
                        nextDueDate={s.next_due_date}
                        firstDueDate={s.first_due_date}
                      />

                      <div
                        className="flex items-center justify-end flex-wrap gap-1.5 pt-1.5 border-t border-stone-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {s.status === 'COMPLETED' && (
                          <button
                            type="button"
                            onClick={() => openSaleDetail(s.id, true)}
                            className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-extrabold inline-flex items-center gap-1"
                          >
                            <Edit3 className="w-3.5 h-3.5" /> Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleQuickDeleteSale(s)}
                          className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 text-xs font-extrabold inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 3: CAIXA GERAL (ENTRADAS E SAÍDAS) */}
            {activeTab === 'cash' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-extrabold text-stone-800">Movimento do Dinheiro</h3>
                  <div className="flex gap-1">
                    {(
                      [
                        { key: 'ALL', label: 'Tudo' },
                        { key: 'IN', label: 'Entrou' },
                        { key: 'OUT', label: 'Saiu' },
                      ] as const
                    ).map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => setDirFilter(d.key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border ${
                          dirFilter === d.key
                            ? 'bg-[#0B4619] text-white border-[#0B4619]'
                            : 'bg-white text-stone-700 border-stone-200'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredTransactions.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center text-stone-500 font-bold">
                    Nenhum lançamento nesse período.
                  </div>
                ) : (
                  filteredTransactions.map((tx) => {
                    const detailLine =
                      tx.items_summary ||
                      (tx.property_name && !tx.description.includes(tx.property_name)
                        ? `${tx.property_name}${tx.tenant_name ? ` • ${tx.tenant_name}` : ''}`
                        : null);
                    return (
                      <div
                        key={tx.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedTx(tx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedTx(tx);
                          }
                        }}
                        className="bg-white rounded-2xl border border-stone-200 hover:border-stone-400 px-3 py-2.5 space-y-1.5 transition cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 text-[11px] font-bold text-stone-500">
                            {tx.direction === 'IN' ? (
                              <ArrowUpCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                            ) : (
                              <ArrowDownCircle className="w-4 h-4 text-red-700 shrink-0" />
                            )}
                            <span className="truncate">
                              {formatDateBR(tx.transaction_date)} • {categoryLabel(tx.category)}
                            </span>
                            <span>•</span>
                            <PaymentMethodInline method={tx.payment_method} iconClassName="w-3.5 h-3.5" />
                          </div>
                          <div
                            className={`text-base font-black shrink-0 whitespace-nowrap ${
                              tx.direction === 'IN' ? 'text-emerald-800' : 'text-red-700'
                            }`}
                          >
                            {tx.direction === 'IN' ? '+' : '-'} {formatBRL(tx.amount_cents)}
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="font-extrabold text-sm text-stone-900 leading-snug">
                            {tx.description}
                          </div>
                          {(detailLine || (tx.customer_name && !tx.description.includes(tx.customer_name))) && (
                            <div className="text-[11px] font-bold text-stone-600 leading-snug truncate">
                              {detailLine || ''}
                              {tx.customer_name && !tx.description.includes(tx.customer_name)
                                ? `${detailLine ? ' • ' : ''}${tx.customer_name}`
                                : ''}
                            </div>
                          )}
                          {tx.due_date && (
                            <span className="mt-0.5 inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 text-[10px] font-extrabold">
                              Vencimento: {formatDateBR(tx.due_date)}
                            </span>
                          )}
                        </div>

                        <div
                          className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedTx(tx)}
                            className="text-[11px] font-bold text-stone-400 hover:text-stone-700"
                          >
                            Ver info →
                          </button>
                          <div className="flex items-center flex-wrap gap-1.5">
                            {tx.customer_id && (
                              <Link
                                to={`/clientes/${tx.customer_id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 text-[11px] font-extrabold"
                              >
                                Cliente
                              </Link>
                            )}
                            {tx.sale_id && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openSaleDetail(tx.sale_id!);
                                }}
                                className="px-2 py-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-950 text-[11px] font-extrabold inline-flex items-center gap-1"
                              >
                                <ReceiptText className="w-3 h-3" /> Venda #{tx.sale_id}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditTxModal(tx);
                              }}
                              className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-extrabold inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3 h-3" /> Editar
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTx(tx);
                              }}
                              className="px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 text-[11px] font-extrabold inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> Excluir
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>
        </div>
      )}

      <SaleDetailModal
        sale={selectedSale}
        initialEdit={saleInitialEdit}
        onClose={() => {
          setSelectedSale(null);
          setSaleInitialEdit(false);
        }}
        onCancelled={load}
      />

      {/* Unified Transaction Modal */}
      <Modal
        open={txModal !== null}
        onClose={() => {
          setTxModal(null);
          setEditingTxId(null);
          setEditingTxRecord(null);
        }}
        title={
          editingTxId
            ? 'Editar Lançamento'
            : txModal === 'OTHER_IN'
              ? 'Anotar Entrada de Dinheiro'
              : 'Anotar Saída / Gasto'
        }
      >
        <form onSubmit={handleSaveTx} className="space-y-3">
          {txModal !== 'OTHER_IN' &&
            (!editingTxRecord || editingTxRecord.reference_type === 'MANUAL') && (
            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">Tipo de saída</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTxModal('EXPENSE')}
                  className={`py-2 px-3 rounded-xl font-extrabold text-xs sm:text-sm border-2 ${
                    txModal === 'EXPENSE'
                      ? 'bg-red-50 border-red-600 text-red-900'
                      : 'bg-white border-stone-200 text-stone-700'
                  }`}
                >
                  Gasto / Conta
                </button>
                <button
                  type="button"
                  onClick={() => setTxModal('STOCK_PURCHASE')}
                  className={`py-2 px-3 rounded-xl font-extrabold text-xs sm:text-sm border-2 ${
                    txModal === 'STOCK_PURCHASE'
                      ? 'bg-amber-50 border-amber-600 text-amber-950'
                      : 'bg-white border-stone-200 text-stone-700'
                  }`}
                >
                  Compra Mercadoria
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-bold text-stone-800 mb-1">
              O que é? <span className="text-orange-600">*</span>
            </label>
            <input
              type="text"
              required
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder={
                txModal === 'EXPENSE'
                  ? 'Ex: Gasolina, Lanche, Energia'
                  : txModal === 'STOCK_PURCHASE'
                    ? 'Ex: Mercadoria na feira'
                    : 'Ex: Dinheiro colocado no caixa'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>

          <MoneyInput label="Valor" value={txAmountText} onChange={setTxAmountText} required />

          <div>
            <label className="block text-sm font-bold text-stone-800 mb-1">Forma</label>
            <PaymentMethodSelector value={txMethod} onChange={setTxMethod} />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">Data</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm font-bold"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-stone-700">
                  Vencimento
                </label>
                {txDueDate && (
                  <button
                    type="button"
                    onClick={() => setTxDueDate('')}
                    className="text-[11px] font-extrabold text-red-700 hover:underline"
                  >
                    Limpar
                  </button>
                )}
              </div>
              <input
                type="date"
                value={txDueDate}
                onChange={(e) => setTxDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm font-bold"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={savingTx}
            className="w-full py-3 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-base"
          >
            {savingTx ? 'SALVANDO...' : 'CONFIRMAR'}
          </button>
        </form>
      </Modal>

      {/* Transaction Info Modal */}
      <Modal
        open={selectedTx !== null}
        onClose={() => setSelectedTx(null)}
        title="Detalhes do Movimento"
      >
        {selectedTx && (
          <div className="space-y-3">
            <div
              className={`rounded-2xl border-2 px-3.5 py-2.5 flex items-center justify-between gap-2.5 ${
                selectedTx.direction === 'IN'
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="min-w-0">
                <div
                  className={`text-[11px] font-extrabold uppercase ${
                    selectedTx.direction === 'IN' ? 'text-emerald-900' : 'text-red-900'
                  }`}
                >
                  {selectedTx.direction === 'IN' ? 'Entrada de dinheiro' : 'Saída / Despesa'}
                </div>
                <div className="text-sm font-black text-stone-900 mt-0.5 leading-snug">
                  {selectedTx.description}
                </div>
              </div>
              <div
                className={`text-xl font-black shrink-0 ${
                  selectedTx.direction === 'IN' ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {selectedTx.direction === 'IN' ? '+' : '-'} {formatBRL(selectedTx.amount_cents)}
              </div>
            </div>

            <div className="bg-stone-50 rounded-2xl border border-stone-200 p-3 space-y-1.5 text-xs sm:text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-stone-500">Tipo</span>
                <span className="font-extrabold text-stone-900">
                  {categoryLabel(selectedTx.category)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-stone-500">Forma de pagamento</span>
                <span className="font-extrabold text-stone-900">
                  <PaymentMethodInline method={selectedTx.payment_method} iconClassName="w-4 h-4" />
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-stone-500">Data</span>
                <span className="font-extrabold text-stone-900">
                  {formatDateBR(selectedTx.transaction_date)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-stone-500">Vencimento</span>
                {selectedTx.due_date ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 font-extrabold">
                    {formatDateBR(selectedTx.due_date)}
                  </span>
                ) : (
                  <span className="font-bold text-stone-400">Não informado</span>
                )}
              </div>
              {selectedTx.items_summary && (
                <div className="pt-1.5 border-t border-stone-200">
                  <div className="font-bold text-stone-500 text-[11px] uppercase">
                    Produtos / Referência
                  </div>
                  <div className="font-extrabold text-stone-900">{selectedTx.items_summary}</div>
                </div>
              )}
              {selectedTx.customer_name && (
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-200">
                  <span className="font-bold text-stone-500">Cliente</span>
                  <span className="font-extrabold text-stone-900">{selectedTx.customer_name}</span>
                </div>
              )}
              {selectedTx.property_name && (
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-200">
                  <span className="font-bold text-stone-500">Aluguel</span>
                  <span className="font-extrabold text-stone-900">
                    {selectedTx.property_name}
                    {selectedTx.tenant_name ? ` • ${selectedTx.tenant_name}` : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openEditTxModal(selectedTx)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 text-amber-950 font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5"
              >
                <Edit3 className="w-4 h-4" /> Editar
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTx(selectedTx)}
                className="flex-1 py-2.5 px-3 rounded-xl bg-red-50 hover:bg-red-100 border-2 border-red-300 text-red-800 font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" /> Excluir
              </button>
              {selectedTx.customer_id && (
                <Link
                  to={`/clientes/${selectedTx.customer_id}`}
                  onClick={() => setSelectedTx(null)}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 text-stone-800 font-extrabold text-xs sm:text-sm text-center"
                >
                  Ver cliente
                </Link>
              )}
              {selectedTx.sale_id && (
                <button
                  type="button"
                  onClick={() => {
                    const sid = selectedTx.sale_id!;
                    setSelectedTx(null);
                    openSaleDetail(sid);
                  }}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-100 hover:bg-emerald-200 border-2 border-emerald-300 text-emerald-950 font-extrabold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <ReceiptText className="w-4 h-4" /> Ver venda #{selectedTx.sale_id}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
