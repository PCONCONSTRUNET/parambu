import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Package,
  ShoppingBag,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api, getCachedApi } from '../lib/api';
import { formatBRL } from '../lib/format';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import { useFeedback } from '../components/FeedbackContext';

interface HomeDashboardData {
  today: string;
  receivedTodayCents: number;
  salesTodayCount: number;
  salesTodayCents: number;
  profitTodayCents: number;
  monthSalesCents: number;
  fiadosReceivableCents: number;
  customersOverdueCount: number;
  rentsReceivableCents: number;
  rentsOverdueCount: number;
  totalReceivableCents: number;
  lowStockCount: number;
  cashBalanceCents: number;
}

export function HomePage() {
  const [data, setData] = useState<HomeDashboardData | null>(
    () => getCachedApi<HomeDashboardData>('/dashboard') ?? null,
  );
  const [loading, setLoading] = useState(() => !getCachedApi('/dashboard'));
  const { showError } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api<HomeDashboardData>('/dashboard');
        setData(res);
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao carregar resumo.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [showError],
  );

  useEffect(() => {
    const cached = getCachedApi<HomeDashboardData>('/dashboard');
    if (cached) setData(cached);
    load(Boolean(cached));
  }, [load]);

  useLiveRefresh(() => load(true));

  const mainButtons = [
    {
      to: '/vender',
      title: 'Vender',
      subtitle: 'Fazer nova venda',
      icon: ShoppingBag,
      colors: 'bg-[#0B4619] hover:bg-[#115E2B] text-white border-[#073311]',
      iconBg: 'bg-white/20',
    },
    {
      to: '/produtos',
      title: 'Produtos',
      subtitle: 'Cadastrar e ver estoque',
      icon: Package,
      colors: 'bg-[#EA580C] hover:bg-[#D94E06] text-white border-[#B93F04]',
      iconBg: 'bg-white/20',
    },
    {
      to: '/dinheiro',
      title: 'Dinheiro',
      subtitle: 'Pagamentos, vendas e gastos',
      icon: Wallet,
      colors: 'bg-[#B45309] hover:bg-[#92400E] text-white border-[#78350F]',
      iconBg: 'bg-white/20',
    },
    {
      to: '/alugueis',
      title: 'Aluguéis',
      subtitle: 'Casinhas e inquilinos',
      icon: Building2,
      colors: 'bg-[#7C2D12] hover:bg-[#66240E] text-white border-[#4D1B09]',
      iconBg: 'bg-white/20',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Resumo simples de hoje */}
      <section className="bg-white rounded-3xl border-2 border-stone-200 p-4 shadow-xs">
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-stone-500 mb-2.5">
          Resumo de Hoje
        </h2>
        {loading || !data ? (
          <div className="grid grid-cols-2 gap-3 animate-pulse">
            <div className="h-20 rounded-2xl bg-stone-100" />
            <div className="h-20 rounded-2xl bg-stone-100" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5">
              <div className="text-sm font-bold text-emerald-900">Entrou hoje</div>
              <div className="text-2xl font-black text-emerald-800 mt-0.5">
                {formatBRL(data.receivedTodayCents)}
              </div>
              <div className="text-xs font-bold text-emerald-700 mt-0.5">
                {data.salesTodayCount} {data.salesTodayCount === 1 ? 'venda hoje' : 'vendas hoje'}
              </div>
            </div>

            <div className="rounded-2xl bg-orange-50 border border-orange-200 p-3.5">
              <div className="text-sm font-bold text-orange-900">Tem para receber</div>
              <div className="text-2xl font-black text-orange-800 mt-0.5">
                {formatBRL(data.totalReceivableCents)}
              </div>
              <div className="text-xs font-bold text-orange-700 mt-0.5">
                Fiados: {formatBRL(data.fiadosReceivableCents)}
              </div>
            </div>
          </div>
        )}

        {/* Helpful Alerts */}
        {data && (data.lowStockCount > 0 || data.customersOverdueCount > 0 || data.rentsOverdueCount > 0) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.lowStockCount > 0 && (
              <Link
                to="/produtos?low=1"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-100 text-amber-950 border border-amber-300 text-sm font-extrabold"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700" />
                {data.lowStockCount} {data.lowStockCount === 1 ? 'produto acabando' : 'produtos acabando'}
              </Link>
            )}
            {data.customersOverdueCount > 0 && (
              <Link
                to="/clientes?filter=overdue"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-100 text-red-900 border border-red-300 text-sm font-extrabold"
              >
                <Users className="w-4 h-4 text-red-700" />
                {data.customersOverdueCount}{' '}
                {data.customersOverdueCount === 1 ? 'fiado atrasado' : 'fiados atrasados'}
              </Link>
            )}
            {data.rentsOverdueCount > 0 && (
              <Link
                to="/alugueis"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-100 text-red-900 border border-red-300 text-sm font-extrabold"
              >
                <Building2 className="w-4 h-4 text-red-700" />
                {data.rentsOverdueCount}{' '}
                {data.rentsOverdueCount === 1 ? 'aluguel atrasado' : 'aluguéis atrasados'}
              </Link>
            )}
          </div>
        )}
      </section>

      {/* THE 4 MAIN BUTTONS */}
      <section>
        <h2 className="text-base font-extrabold text-stone-700 mb-2.5 px-1">
          Toque no que você quer fazer:
        </h2>
        <div className="grid grid-cols-2 gap-3.5">
          {mainButtons.map((btn) => {
            const Icon = btn.icon;
            return (
              <Link
                key={btn.to}
                to={btn.to}
                className={`flex flex-col justify-between min-h-[146px] sm:min-h-[164px] p-5 rounded-3xl border-b-4 shadow-md active:scale-[0.98] transition ${btn.colors}`}
              >
                <div className={`w-13 h-13 rounded-2xl flex items-center justify-center ${btn.iconBg}`}>
                  <Icon className="w-8 h-8" />
                </div>
                <div className="mt-3">
                  <div className="text-2xl font-black leading-tight">{btn.title}</div>
                  <div className="text-sm font-semibold opacity-95 mt-0.5 leading-snug">
                    {btn.subtitle}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Direct obvious access to Clientes e Fiados right on Home */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <Link
          to="/clientes"
          className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white hover:bg-orange-50 border-2 border-orange-300 shadow-xs active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-800 flex items-center justify-center shrink-0">
              <Users className="w-7 h-7" />
            </div>
            <div>
              <div className="text-lg font-black text-stone-900 leading-tight">
                Clientes e Fiados
              </div>
              <div className="text-xs font-bold text-stone-600 mt-0.5">
                Ver quem deve e receber dinheiro
              </div>
            </div>
          </div>
          <ChevronRight className="w-6 h-6 text-orange-700 shrink-0" />
        </Link>

        <Link
          to="/clientes?novo=1"
          className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-white hover:bg-emerald-50 border-2 border-emerald-300 shadow-xs active:scale-[0.99]"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#0B4619] flex items-center justify-center shrink-0">
              <UserPlus className="w-7 h-7" />
            </div>
            <div>
              <div className="text-lg font-black text-stone-900 leading-tight">
                Cadastrar Cliente
              </div>
              <div className="text-xs font-bold text-stone-600 mt-0.5">
                Anotar nome e telefone novo
              </div>
            </div>
          </div>
          <ChevronRight className="w-6 h-6 text-[#0B4619] shrink-0" />
        </Link>
      </section>
    </div>
  );
}
