import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Edit3, Search, Trash2 } from 'lucide-react';
import { api, getCachedApi } from '../lib/api';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import { matchesFlexibleSearch } from '../lib/search';
import {
  formatBRL,
  formatDateBR,
  monthStartLocalISO,
  paymentMethodLabel,
  todayLocalISO,
} from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import {
  SaleDetailModal,
  type SaleDetailData,
  SalePaymentBadges,
} from '../components/SaleDetailModal';

interface SaleRow {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_cpf?: string | null;
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
  installment_count?: number | null;
  installment_amount_cents?: number | null;
  next_due_date?: string | null;
  first_due_date?: string | null;
}

function salesPathForPeriod(period: 'today' | 'month' | 'all'): string {
  const qs = new URLSearchParams();
  if (period === 'today') {
    const t = todayLocalISO();
    qs.set('from', t);
    qs.set('to', t);
  } else if (period === 'month') {
    qs.set('from', monthStartLocalISO());
    qs.set('to', todayLocalISO());
  }
  const suffix = qs.toString();
  return suffix ? `/sales?${suffix}` : '/sales';
}

export function SalesHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<'today' | 'month' | 'all'>('month');
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<SaleRow[]>(
    () => getCachedApi<{ sales: SaleRow[] }>(salesPathForPeriod('month'))?.sales ?? [],
  );
  const [loading, setLoading] = useState(() => !getCachedApi(salesPathForPeriod('month')));
  const [selectedSale, setSelectedSale] = useState<SaleDetailData | null>(null);
  const [selectedSaleInitialEdit, setSelectedSaleInitialEdit] = useState(false);
  const { showSuccess, showError, confirmAction } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api<{ sales: SaleRow[] }>(salesPathForPeriod(period));
        setSales(res.sales);
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao carregar vendas.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [period, showError],
  );

  useEffect(() => {
    const cached = getCachedApi<{ sales: SaleRow[] }>(salesPathForPeriod(period));
    if (cached) setSales(cached.sales);
    load(Boolean(cached));
  }, [load, period]);

  useLiveRefresh(() => load(true));

  const openDetail = useCallback(
    async (id: number, editMode = false) => {
      try {
        const res = await api<{ sale: SaleDetailData }>(`/sales/${id}`);
        setSelectedSaleInitialEdit(editMode);
        setSelectedSale(res.sale);
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Erro ao abrir venda.');
      }
    },
    [showError],
  );

  const handleDeleteSale = async (sale: SaleRow) => {
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
      openDetail(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('venda');
          return next;
        },
        { replace: true },
      );
    }
  }, [vendaParam, openDetail, setSearchParams]);

  const filteredSales = useMemo(() => {
    return sales.filter((s) =>
      matchesFlexibleSearch(
        search,
        [
          `#${s.id}`,
          s.items_summary,
          s.customer_name,
          s.customer_cpf,
          paymentMethodLabel(s.payment_method),
        ],
        [s.customer_cpf, String(s.id)],
      ),
    );
  }, [sales, search]);

  const completedTotals = useMemo(() => {
    const completed = filteredSales.filter((s) => s.status === 'COMPLETED');
    return {
      count: completed.length,
      totalCents: completed.reduce((acc, s) => acc + s.total_cents, 0),
      profitCents: completed.reduce((acc, s) => acc + s.profit_cents, 0),
    };
  }, [filteredSales]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { key: 'today', label: 'Hoje' },
            { key: 'month', label: 'Este mês' },
            { key: 'all', label: 'Todas' },
          ] as const
        ).map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={`py-3 rounded-2xl font-extrabold text-base border-2 ${
              period === p.key
                ? 'bg-[#0B4619] text-white border-[#0B4619]'
                : 'bg-white text-stone-700 border-stone-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center bg-white border-[3px] border-stone-400 rounded-2xl px-3.5 shadow-xs focus-within:border-[#0B4619]">
        <Search className="w-5 h-5 text-stone-600 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por produto, cliente, CPF ou nº..."
          className="w-full px-3 py-3 text-base font-bold placeholder:text-stone-500 focus:outline-none"
        />
      </div>

      {!loading && filteredSales.length > 0 && (
        <div className="px-4 py-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between text-xs sm:text-sm font-extrabold text-emerald-950 flex-wrap gap-2">
          <span>
            {completedTotals.count}{' '}
            {completedTotals.count === 1 ? 'venda concluída' : 'vendas concluídas'}
          </span>
          <span>
            Total: {formatBRL(completedTotals.totalCents)} • Lucro:{' '}
            {formatBRL(completedTotals.profitCents)}
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2.5">
          <div className="h-24 rounded-2xl bg-white animate-pulse" />
          <div className="h-24 rounded-2xl bg-white animate-pulse" />
        </div>
      ) : filteredSales.length === 0 ? (
        <div className="bg-white rounded-3xl border-2 border-stone-200 p-8 text-center text-stone-500 font-bold">
          Nenhuma venda encontrada.
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredSales.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => openDetail(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openDetail(s.id);
                }
              }}
              className="w-full text-left bg-white rounded-2xl border-2 border-stone-200 hover:border-[#0B4619] p-4 space-y-2 transition cursor-pointer"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-base text-stone-900">
                    #{s.id} • {s.customer_name || 'Cliente sem nome'}
                  </div>
                  <div className="text-sm font-semibold text-stone-600 line-clamp-1">
                    {s.items_summary}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-xl font-black ${
                      s.status === 'CANCELLED' ? 'line-through text-stone-400' : 'text-[#0B4619]'
                    }`}
                  >
                    {formatBRL(s.total_cents)}
                  </div>
                  <div className="text-xs font-bold text-stone-500">{formatDateBR(s.sale_date)}</div>
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
                className="flex items-center justify-end gap-2 pt-1.5 border-t border-stone-100"
                onClick={(e) => e.stopPropagation()}
              >
                {s.status === 'COMPLETED' && (
                  <button
                    type="button"
                    onClick={() => openDetail(s.id, true)}
                    className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-extrabold inline-flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Editar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteSale(s)}
                  className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 text-xs font-extrabold inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SaleDetailModal
        sale={selectedSale}
        initialEdit={selectedSaleInitialEdit}
        onClose={() => setSelectedSale(null)}
        onCancelled={load}
      />
    </div>
  );
}
