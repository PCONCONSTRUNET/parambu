import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Home,
  Phone,
  Plus,
  Receipt,
  User,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, getCachedApi } from '../lib/api';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import {
  centsToInputString,
  formatBRL,
  formatDateBR,
  formatMonthBR,
  formatPhoneInput,
  newIdempotencyKey,
  parseMoneyToCents,
  todayLocalISO,
} from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { ImageUpload } from '../components/ImageUpload';
import {
  PaymentMethodInline,
  PaymentMethodSelector,
} from '../components/PaymentMethodIcon';

interface PropertySummary {
  id: number;
  name: string;
  address: string | null;
  photo_url: string | null;
  monthly_rent_cents: number;
  due_day: number;
  status: 'AVAILABLE' | 'OCCUPIED';
  active_lease: {
    id: number;
    tenant_name: string;
    tenant_phone: string | null;
  } | null;
  total_debt_cents: number;
  open_charges_count: number;
  current_status: 'LIVRE' | 'PAGO' | 'PENDENTE' | 'ATRASADO';
}

interface RentReceivable {
  id: number;
  lease_id: number;
  property_id: number;
  property_name: string;
  tenant_name: string;
  reference_month: string;
  due_date: string;
  amount_cents: number;
  paid_cents: number;
  remaining_cents: number;
  display_status: 'PAGO' | 'PENDENTE' | 'ATRASADO';
}

interface LeaseRow {
  id: number;
  property_id: number;
  property_name: string;
  property_address: string | null;
  tenant_name: string;
  tenant_phone: string | null;
  monthly_rent_cents: number;
  due_day: number;
  start_date: string;
  end_date: string | null;
  status: 'ACTIVE' | 'ENDED';
  open_debt_cents: number;
  total_paid_cents: number;
}

interface RentPaymentRow {
  id: number;
  lease_id: number;
  property_id: number;
  property_name: string;
  tenant_name: string;
  reference_month: string;
  amount_cents: number;
  payment_method: string;
  payment_date: string;
}

interface RentalsOverviewResponse {
  summary: {
    receivedThisMonthCents: number;
    toReceiveCents: number;
    propertiesCount: number;
    occupiedCount: number;
    availableCount: number;
  };
  properties: PropertySummary[];
  receivables: RentReceivable[];
  leases: LeaseRow[];
  payments: RentPaymentRow[];
}

export function RentalsPage() {
  const [overview, setOverview] = useState<RentalsOverviewResponse | null>(
    () => getCachedApi<RentalsOverviewResponse>('/rentals/overview') ?? null,
  );
  const [tab, setTab] = useState<'properties' | 'tenants' | 'receivables' | 'payments'>('properties');
  const [loading, setLoading] = useState(() => !getCachedApi('/rentals/overview'));

  // Create Property Modal
  const [newHouseOpen, setNewHouseOpen] = useState(false);
  const [houseName, setHouseName] = useState('');
  const [houseAddress, setHouseAddress] = useState('');
  const [houseRentText, setHouseRentText] = useState('');
  const [houseDueDay, setHouseDueDay] = useState('10');
  const [housePhotoUrl, setHousePhotoUrl] = useState<string | null>(null);
  const [savingHouse, setSavingHouse] = useState(false);

  // Create Tenant (Lease) Modal directly inside Aluguéis
  const [newTenantOpen, setNewTenantOpen] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [createNewHouseInline, setCreateNewHouseInline] = useState(false);
  const [inlineHouseName, setInlineHouseName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  const [tenantRentText, setTenantRentText] = useState('');
  const [tenantDueDay, setTenantDueDay] = useState('10');
  const [tenantStartDate, setTenantStartDate] = useState(() => todayLocalISO());
  const [savingTenant, setSavingTenant] = useState(false);

  // Direct Pay Rent Modal right from "A Receber"
  const [payCharge, setPayCharge] = useState<RentReceivable | null>(null);
  const [payAmountText, setPayAmountText] = useState('');
  const [payMethod, setPayMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [payKey, setPayKey] = useState('');
  const [paying, setPaying] = useState(false);

  // Register Rent Payment Modal (choose client/tenant first)
  const [regPayOpen, setRegPayOpen] = useState(false);
  const [regLeaseId, setRegLeaseId] = useState<string>('');
  const [regChargeChoice, setRegChargeChoice] = useState<string>('CUSTOM_MONTH');
  const [regCustomMonth, setRegCustomMonth] = useState(() => todayLocalISO().slice(0, 7));
  const [regAmountText, setRegAmountText] = useState('');
  const [regMethod, setRegMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [regDate, setRegDate] = useState(() => todayLocalISO());
  const [regNotes, setRegNotes] = useState('');
  const [regKey, setRegKey] = useState('');
  const [regPaying, setRegPaying] = useState(false);
  const [housePickerOpen, setHousePickerOpen] = useState(false);
  const [tenantPickerOpen, setTenantPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  const { showSuccess, showError } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api<RentalsOverviewResponse>('/rentals/overview');
        setOverview(res);
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao carregar aluguéis.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [showError],
  );

  useEffect(() => {
    const cached = getCachedApi<RentalsOverviewResponse>('/rentals/overview');
    if (cached) setOverview(cached);
    load(Boolean(cached));
  }, [load]);

  useLiveRefresh(() => load(true));

  const properties = overview?.properties ?? [];
  const availableProperties = properties.filter((p) => p.status === 'AVAILABLE');
  const receivables = overview?.receivables ?? [];
  const leases = overview?.leases ?? [];
  const payments = overview?.payments ?? [];
  const payableLeases = leases.filter((l) => l.status === 'ACTIVE' || l.open_debt_cents > 0);
  const selectedRegLease =
    payableLeases.find((l) => String(l.id) === regLeaseId) ?? payableLeases[0] ?? null;
  const selectedLeaseReceivables = selectedRegLease
    ? receivables.filter((r) => r.lease_id === selectedRegLease.id)
    : [];
  const selectedRegCharge =
    regChargeChoice !== 'CUSTOM_MONTH'
      ? selectedLeaseReceivables.find((r) => String(r.id) === regChargeChoice) ?? null
      : null;

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    const monthlyRentCents = parseMoneyToCents(houseRentText);
    if (monthlyRentCents <= 0) {
      showError('Informe o valor do aluguel mensal.');
      return;
    }
    const day = Number.parseInt(houseDueDay, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      showError('Dia do vencimento deve ser entre 1 e 31.');
      return;
    }

    setSavingHouse(true);
    try {
      await api('/rentals/properties', {
        method: 'POST',
        body: JSON.stringify({
          name: houseName,
          address: houseAddress || null,
          photoUrl: housePhotoUrl,
          monthlyRentCents,
          dueDay: day,
        }),
      });
      showSuccess('Casa cadastrada!');
      setHouseName('');
      setHouseAddress('');
      setHouseRentText('');
      setHouseDueDay('10');
      setHousePhotoUrl(null);
      setNewHouseOpen(false);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar casa.');
    } finally {
      setSavingHouse(false);
    }
  };

  const openNewTenantModal = () => {
    setTenantName('');
    setTenantPhone('');
    setTenantStartDate(todayLocalISO());
    setHousePickerOpen(false);
    if (availableProperties.length > 0) {
      const first = availableProperties[0];
      setCreateNewHouseInline(false);
      setSelectedPropertyId(String(first.id));
      setTenantRentText(centsToInputString(first.monthly_rent_cents));
      setTenantDueDay(String(first.due_day));
    } else {
      setCreateNewHouseInline(true);
      setSelectedPropertyId('');
      setInlineHouseName('');
      setTenantRentText('');
      setTenantDueDay('10');
    }
    setNewTenantOpen(true);
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    const rentCents = parseMoneyToCents(tenantRentText);
    if (rentCents <= 0) {
      showError('Informe o valor do aluguel mensal.');
      return;
    }
    const day = Number.parseInt(tenantDueDay, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      showError('Dia do vencimento deve ser entre 1 e 31.');
      return;
    }

    setSavingTenant(true);
    try {
      let targetPropertyId = Number(selectedPropertyId);
      if (createNewHouseInline) {
        if (!inlineHouseName.trim()) {
          showError('Informe o nome ou número da casa.');
          setSavingTenant(false);
          return;
        }
        const created = await api<{ property: { id: number } }>('/rentals/properties', {
          method: 'POST',
          body: JSON.stringify({
            name: inlineHouseName,
            monthlyRentCents: rentCents,
            dueDay: day,
          }),
        });
        targetPropertyId = created.property.id;
      }

      if (!targetPropertyId) {
        showError('Escolha uma casa livre ou cadastre uma nova.');
        setSavingTenant(false);
        return;
      }

      await api(`/rentals/properties/${targetPropertyId}/lease`, {
        method: 'POST',
        body: JSON.stringify({
          tenantName,
          tenantPhone: tenantPhone || null,
          monthlyRentCents: rentCents,
          dueDay: day,
          startDate: tenantStartDate,
        }),
      });

      showSuccess('Inquilino cadastrado e cobrança gerada!');
      setNewTenantOpen(false);
      setTab('tenants');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao cadastrar inquilino.');
    } finally {
      setSavingTenant(false);
    }
  };

  const suggestCustomMonthForLease = (leaseId: number) => {
    const currentYm = todayLocalISO().slice(0, 7);
    const currentAlreadyPaid = payments.some(
      (p) => p.lease_id === leaseId && p.reference_month === currentYm,
    );
    if (!currentAlreadyPaid) return currentYm;
    const [y, m] = currentYm.split('-').map(Number);
    const nextYear = m === 12 ? y + 1 : y;
    const nextMonth = m === 12 ? 1 : m + 1;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  };

  const applyLeaseSelection = (lease: LeaseRow) => {
    setRegLeaseId(String(lease.id));
    setTenantPickerOpen(false);
    setMonthPickerOpen(false);
    const openForLease = receivables.filter((r) => r.lease_id === lease.id);
    if (openForLease.length > 0) {
      setRegChargeChoice(String(openForLease[0].id));
      setRegAmountText(centsToInputString(openForLease[0].remaining_cents));
    } else {
      setRegChargeChoice('CUSTOM_MONTH');
      setRegCustomMonth(suggestCustomMonthForLease(lease.id));
      setRegAmountText(centsToInputString(lease.monthly_rent_cents));
    }
  };

  const openRegisterPaymentModal = () => {
    const defaultLease =
      payableLeases.find((l) => l.open_debt_cents > 0) ?? payableLeases[0] ?? null;
    if (defaultLease) {
      applyLeaseSelection(defaultLease);
    } else {
      setRegLeaseId('');
      setRegChargeChoice('CUSTOM_MONTH');
      setRegCustomMonth(todayLocalISO().slice(0, 7));
      setRegAmountText('');
    }
    setRegMethod('DINHEIRO');
    setRegDate(todayLocalISO());
    setRegNotes('');
    setRegKey(newIdempotencyKey());
    setTenantPickerOpen(false);
    setMonthPickerOpen(false);
    setRegPayOpen(true);
  };

  const openPayModal = (charge: RentReceivable) => {
    setPayCharge(charge);
    setPayAmountText(centsToInputString(charge.remaining_cents));
    setPayMethod('DINHEIRO');
    setPayKey(newIdempotencyKey());
  };

  const submitRentPayment = async (
    url: string,
    payload: Record<string, unknown>,
    onSuccessClose: () => void,
  ) => {
    const res = await api<{ settled: boolean; paidCents: number; remainingCents: number }>(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    onSuccessClose();
    showSuccess(
      res.settled
        ? `Aluguel pago! ${formatBRL(res.paidCents)}`
        : `Recebido ${formatBRL(res.paidCents)}! Ainda falta ${formatBRL(res.remainingCents)}.`,
    );
    await load();
  };

  const handleConfirmPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payCharge) return;
    const amountCents = parseMoneyToCents(payAmountText);
    if (amountCents <= 0) {
      showError('Informe um valor maior que zero.');
      return;
    }
    if (amountCents > payCharge.remaining_cents) {
      showError(`O valor máximo é ${formatBRL(payCharge.remaining_cents)}.`);
      return;
    }

    setPaying(true);
    try {
      await submitRentPayment(
        `/rentals/charges/${payCharge.id}/pay`,
        {
          amountCents,
          paymentMethod: payMethod,
          idempotencyKey: payKey,
        },
        () => setPayCharge(null),
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao receber aluguel.');
    } finally {
      setPaying(false);
    }
  };

  const handleConfirmRegisterPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRegLease) {
      showError('Selecione um cliente / inquilino.');
      return;
    }

    const amountCents = parseMoneyToCents(regAmountText);
    if (amountCents <= 0) {
      showError('Informe um valor maior que zero.');
      return;
    }

    if (selectedRegCharge && amountCents > selectedRegCharge.remaining_cents) {
      showError(`O valor máximo para este mês é ${formatBRL(selectedRegCharge.remaining_cents)}.`);
      return;
    }

    if (!selectedRegCharge && !/^\d{4}-(0[1-9]|1[0-2])$/.test(regCustomMonth)) {
      showError('Informe o mês de referência do aluguel.');
      return;
    }

    setRegPaying(true);
    try {
      if (selectedRegCharge) {
        await submitRentPayment(
          `/rentals/charges/${selectedRegCharge.id}/pay`,
          {
            amountCents,
            paymentMethod: regMethod,
            paymentDate: regDate || todayLocalISO(),
            notes: regNotes.trim() || null,
            idempotencyKey: regKey,
          },
          () => setRegPayOpen(false),
        );
      } else {
        await submitRentPayment(
          `/rentals/leases/${selectedRegLease.id}/pay`,
          {
            referenceMonth: regCustomMonth,
            amountCents,
            paymentMethod: regMethod,
            paymentDate: regDate || todayLocalISO(),
            notes: regNotes.trim() || null,
            idempotencyKey: regKey,
          },
          () => setRegPayOpen(false),
        );
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao registrar pagamento.');
    } finally {
      setRegPaying(false);
    }
  };

  const statusBadge = (st: PropertySummary['current_status']) => {
    switch (st) {
      case 'PAGO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-extrabold">
            <CheckCircle2 className="w-3.5 h-3.5" /> Em dia
          </span>
        );
      case 'ATRASADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-red-100 text-red-900 border border-red-300 text-xs font-extrabold">
            <AlertTriangle className="w-3.5 h-3.5" /> Atrasado
          </span>
        );
      case 'PENDENTE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-100 text-amber-950 border border-amber-300 text-xs font-extrabold">
            <Clock className="w-3.5 h-3.5" /> A pagar
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-100 text-stone-700 border border-stone-300 text-xs font-extrabold">
            Livre
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Isolated Rentals Summary */}
      <section className="bg-white rounded-3xl border-2 border-amber-300 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-[#7C2D12]">
            Área de Aluguéis (Casas e Inquilinos)
          </h2>
          {overview && (
            <span className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950">
              {overview.summary.occupiedCount} alugada(s) • {overview.summary.availableCount} livre(s)
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3">
            <div className="text-xs font-bold text-emerald-900">Recebido neste mês</div>
            <div className="text-xl font-black text-emerald-800 mt-0.5">
              {formatBRL(overview?.summary.receivedThisMonthCents ?? 0)}
            </div>
          </div>
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
            <div className="text-xs font-bold text-amber-950">Falta receber</div>
            <div className="text-xl font-black text-amber-900 mt-0.5">
              {formatBRL(overview?.summary.toReceiveCents ?? 0)}
            </div>
          </div>
        </div>
      </section>

      {/* Direct Action Buttons */}
      <div className="space-y-2.5">
        <button
          type="button"
          onClick={openRegisterPaymentModal}
          className="w-full py-4 px-4 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-base flex items-center justify-center gap-2 shadow-sm"
        >
          <Banknote className="w-5 h-5" /> Registrar Pagamento do Aluguel
        </button>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setNewHouseOpen(true)}
            className="py-4 px-3 rounded-2xl bg-[#7C2D12] hover:bg-[#66240E] text-white font-extrabold text-base flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Plus className="w-5 h-5" /> Cadastrar Casa
          </button>
          <button
            type="button"
            onClick={openNewTenantModal}
            className="py-4 px-3 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-base flex items-center justify-center gap-1.5 shadow-sm"
          >
            <UserPlus className="w-5 h-5" /> Cadastrar Inquilino
          </button>
        </div>
      </div>

      {/* 4 Clear Tabs inside Rentals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => setTab('properties')}
          className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
            tab === 'properties'
              ? 'bg-[#0B4619] text-white border-[#0B4619]'
              : 'bg-white text-stone-700 border-stone-200'
          }`}
        >
          <Home className="w-4 h-4" /> Casas ({properties.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('tenants')}
          className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
            tab === 'tenants'
              ? 'bg-[#0B4619] text-white border-[#0B4619]'
              : 'bg-white text-stone-700 border-stone-200'
          }`}
        >
          <Users className="w-4 h-4" /> Inquilinos ({leases.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('receivables')}
          className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
            tab === 'receivables'
              ? 'bg-[#0B4619] text-white border-[#0B4619]'
              : 'bg-white text-stone-700 border-stone-200'
          }`}
        >
          <Banknote className="w-4 h-4" /> A Receber ({receivables.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('payments')}
          className={`py-3 px-2 rounded-2xl font-extrabold text-sm border-2 flex items-center justify-center gap-1.5 ${
            tab === 'payments'
              ? 'bg-[#0B4619] text-white border-[#0B4619]'
              : 'bg-white text-stone-700 border-stone-200'
          }`}
        >
          <Receipt className="w-4 h-4" /> Pagamentos ({payments.length})
        </button>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="space-y-3">
          <div className="h-28 rounded-2xl bg-white animate-pulse" />
          <div className="h-28 rounded-2xl bg-white animate-pulse" />
        </div>
      ) : tab === 'properties' ? (
        properties.length === 0 ? (
          <div className="bg-white rounded-3xl border-2 border-stone-200 p-7 text-center space-y-3">
            <Building2 className="w-12 h-12 text-stone-300 mx-auto" />
            <p className="text-lg font-extrabold text-stone-700">Nenhuma casa cadastrada</p>
            <p className="text-sm text-stone-500">
              Toque em <strong>Cadastrar Casa</strong> acima para registrar suas casas ou casinhas.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {properties.map((p) => (
              <Link
                key={p.id}
                to={`/alugueis/${p.id}`}
                className="block bg-white rounded-2xl border-2 border-stone-300 hover:border-[#0B4619] p-3.5 transition"
              >
                <div className="flex items-center gap-3">
                  {p.photo_url ? (
                    <div className="w-20 h-20 rounded-xl bg-stone-50 border border-stone-200 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                      <img
                        src={p.photo_url}
                        alt={p.name}
                        className="w-full h-full object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center shrink-0">
                      <Home className="w-8 h-8 text-[#7C2D12]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-lg font-extrabold text-stone-900 truncate">{p.name}</h3>
                      {statusBadge(p.current_status)}
                    </div>
                    <div className="text-sm font-bold text-stone-600 flex items-center gap-1 mt-1">
                      <User className="w-4 h-4 shrink-0" />
                      {p.active_lease ? p.active_lease.tenant_name : 'Sem inquilino no momento'}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2 text-sm font-extrabold">
                      <span className="text-[#0B4619] whitespace-nowrap">
                        {formatBRL(p.monthly_rent_cents)} / mês (dia {p.due_day})
                      </span>
                      {p.total_debt_cents > 0 ? (
                        <span className="text-red-700 whitespace-nowrap">
                          Receber {formatBRL(p.total_debt_cents)} →
                        </span>
                      ) : (
                        <span className="text-stone-500 whitespace-nowrap">
                          {p.active_lease ? 'Abrir →' : 'Colocar inquilino →'}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-stone-400 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )
      ) : tab === 'tenants' ? (
        leases.length === 0 ? (
          <div className="bg-white rounded-3xl border-2 border-stone-200 p-7 text-center space-y-3">
            <Users className="w-12 h-12 text-stone-300 mx-auto" />
            <p className="text-lg font-extrabold text-stone-700">Nenhum inquilino cadastrado</p>
            <p className="text-sm text-stone-500">
              Toque em <strong>Cadastrar Inquilino</strong> acima para registrar quem mora na casa.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {leases.map((l) => (
              <Link
                key={l.id}
                to={`/alugueis/${l.property_id}`}
                className="block bg-white rounded-2xl border-2 border-stone-200 hover:border-[#0B4619] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-black text-stone-900">{l.tenant_name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-xs font-extrabold ${
                          l.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-stone-100 text-stone-600'
                        }`}
                      >
                        {l.status === 'ACTIVE' ? 'Morando agora' : 'Saiu'}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-[#7C2D12] mt-0.5">
                      {l.property_name} • {formatBRL(l.monthly_rent_cents)}/mês (dia {l.due_day})
                    </div>
                    {l.tenant_phone && (
                      <div className="text-xs font-bold text-stone-500 flex items-center gap-1 mt-1">
                        <Phone className="w-3.5 h-3.5" /> {l.tenant_phone}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    {l.open_debt_cents > 0 ? (
                      <>
                        <div className="text-xs font-bold text-red-700">Falta pagar</div>
                        <div className="text-lg font-black text-red-700">
                          {formatBRL(l.open_debt_cents)}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs font-extrabold text-emerald-800">Em dia</div>
                    )}
                    <div className="text-xs font-bold text-stone-500 mt-1">Abrir →</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : tab === 'receivables' ? (
        receivables.length === 0 ? (
          <div className="bg-white rounded-3xl border-2 border-stone-200 p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
            <p className="text-lg font-extrabold text-stone-700">Todos os aluguéis estão em dia!</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {receivables.map((c) => (
              <div
                key={c.id}
                className="bg-white rounded-2xl border-2 border-stone-200 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-extrabold text-lg text-stone-900">
                      {c.property_name} • {formatMonthBR(c.reference_month)}
                    </div>
                    <div className="text-sm font-bold text-stone-600">{c.tenant_name}</div>
                    <div className="text-xs font-bold text-stone-500 mt-0.5">
                      Vence em {formatDateBR(c.due_date)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-xl font-black ${
                        c.display_status === 'ATRASADO' ? 'text-red-700' : 'text-amber-800'
                      }`}
                    >
                      {formatBRL(c.remaining_cents)}
                    </div>
                    <span
                      className={`inline-block px-2 py-0.5 rounded-lg text-xs font-extrabold ${
                        c.display_status === 'ATRASADO'
                          ? 'bg-red-100 text-red-900'
                          : 'bg-amber-100 text-amber-950'
                      }`}
                    >
                      {c.display_status === 'ATRASADO' ? 'Atrasado' : 'Pendente'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openPayModal(c)}
                    className="py-3 rounded-xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-sm flex items-center justify-center gap-1.5"
                  >
                    <Banknote className="w-4 h-4" /> Receber Agora
                  </button>
                  <Link
                    to={`/alugueis/${c.property_id}`}
                    className="py-3 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 text-stone-800 font-extrabold text-sm text-center"
                  >
                    Ver Casa
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )
      ) : payments.length === 0 ? (
        <div className="bg-white rounded-3xl border-2 border-stone-200 p-8 text-center">
          <Receipt className="w-12 h-12 text-stone-300 mx-auto mb-2" />
          <p className="text-lg font-extrabold text-stone-700">
            Nenhum pagamento de aluguel anotado ainda
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {payments.map((p) => (
            <Link
              key={p.id}
              to={`/alugueis/${p.property_id}`}
              className="block bg-white rounded-2xl border border-stone-200 p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-extrabold text-stone-900">
                    {p.property_name} • {p.tenant_name}
                  </div>
                  <div className="text-xs font-bold text-stone-500 mt-0.5 flex items-center gap-1 flex-wrap">
                    <span>
                      Pago em {formatDateBR(p.payment_date)} • Mês {formatMonthBR(p.reference_month)} •
                    </span>
                    <PaymentMethodInline method={p.payment_method} iconClassName="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="text-lg font-black text-emerald-800 shrink-0">
                  + {formatBRL(p.amount_cents)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* New House Modal */}
      <Modal open={newHouseOpen} onClose={() => setNewHouseOpen(false)} title="Cadastrar Casa / Imóvel">
        <form onSubmit={handleCreateProperty} className="space-y-4">
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Nome ou número da casa <span className="text-orange-600">*</span>
            </label>
            <input
              type="text"
              required
              value={houseName}
              onChange={(e) => setHouseName(e.target.value)}
              placeholder="Ex: Casa 01, Casinha Azul"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,0.9fr)] gap-3 items-start">
            <MoneyInput
              label="Aluguel por mês"
              value={houseRentText}
              onChange={setHouseRentText}
              required
            />
            <div className="min-w-0">
              <label className="block text-sm sm:text-base font-bold text-stone-800 mb-1.5">
                Dia venc.
              </label>
              <input
                type="number"
                min={1}
                max={31}
                required
                value={houseDueDay}
                onChange={(e) => setHouseDueDay(e.target.value)}
                className="w-full px-3 sm:px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base sm:text-xl font-bold tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Endereço (opcional)
            </label>
            <input
              type="text"
              value={houseAddress}
              onChange={(e) => setHouseAddress(e.target.value)}
              placeholder="Ex: Rua São José, 12"
              className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>

          <ImageUpload value={housePhotoUrl} onChange={setHousePhotoUrl} />

          <button
            type="submit"
            disabled={savingHouse}
            className="w-full py-4 rounded-2xl bg-[#7C2D12] hover:bg-[#66240E] text-white font-extrabold text-lg"
          >
            {savingHouse ? 'SALVANDO...' : 'SALVAR CASA'}
          </button>
        </form>
      </Modal>

      {/* New Tenant Modal directly inside Aluguéis */}
      <Modal
        open={newTenantOpen}
        onClose={() => setNewTenantOpen(false)}
        title="Cadastrar Inquilino"
      >
        <form onSubmit={handleCreateTenant} className="space-y-4">
          {availableProperties.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCreateNewHouseInline(false)}
                className={`flex-1 py-2.5 rounded-xl font-extrabold text-sm border-2 ${
                  !createNewHouseInline
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                Casa já cadastrada
              </button>
              <button
                type="button"
                onClick={() => setCreateNewHouseInline(true)}
                className={`flex-1 py-2.5 rounded-xl font-extrabold text-sm border-2 ${
                  createNewHouseInline
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                + Casa nova junto
              </button>
            </div>
          )}

          {createNewHouseInline ? (
            <div>
              <label className="block text-base font-bold text-stone-800 mb-1.5">
                Nome ou número da casa <span className="text-orange-600">*</span>
              </label>
              <input
                type="text"
                required
                value={inlineHouseName}
                onChange={(e) => setInlineHouseName(e.target.value)}
                placeholder="Ex: Casa 01"
                className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
              />
            </div>
          ) : (
            <div>
              <label className="block text-base font-bold text-stone-800 mb-1.5">
                Qual casa vai alugar? <span className="text-orange-600">*</span>
              </label>
              {(() => {
                const chosenProp = availableProperties.find(
                  (p) => String(p.id) === selectedPropertyId,
                );
                return (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setHousePickerOpen((prev) => !prev)}
                      className={`w-full text-left px-4 py-3 rounded-2xl border-2 bg-white flex items-center justify-between gap-2 transition ${
                        housePickerOpen ? 'border-[#0B4619]' : 'border-stone-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-base font-extrabold text-stone-900 break-words leading-snug">
                          {chosenProp ? chosenProp.name : 'Escolher casa...'}
                        </div>
                        {chosenProp && (
                          <div className="text-xs font-bold text-stone-500 mt-0.5">
                            {formatBRL(chosenProp.monthly_rent_cents)}/mês
                          </div>
                        )}
                      </div>
                      <ChevronDown
                        className={`w-5 h-5 text-stone-500 shrink-0 transition-transform ${
                          housePickerOpen ? 'rotate-180 text-[#0B4619]' : ''
                        }`}
                      />
                    </button>

                    {housePickerOpen && (
                      <div className="mt-1.5 max-h-52 overflow-y-auto rounded-2xl border-2 border-[#0B4619] bg-white p-1.5 space-y-1 shadow-sm">
                        {availableProperties.map((p) => {
                          const active = String(p.id) === selectedPropertyId;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setSelectedPropertyId(String(p.id));
                                setTenantRentText(centsToInputString(p.monthly_rent_cents));
                                setTenantDueDay(String(p.due_day));
                                setHousePickerOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition ${
                                active
                                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
                                  : 'hover:bg-stone-50 text-stone-900'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-extrabold text-sm break-words leading-snug">
                                  {p.name}
                                </div>
                                <div className="text-xs font-bold text-stone-500">
                                  {formatBRL(p.monthly_rent_cents)}/mês
                                </div>
                              </div>
                              {active && <CheckCircle2 className="w-4 h-4 text-[#0B4619] shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Nome do inquilino <span className="text-orange-600">*</span>
            </label>
            <input
              type="text"
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="Ex: Seu Antônio"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>

          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Telefone (opcional)
            </label>
            <input
              type="tel"
              value={tenantPhone}
              onChange={(e) => setTenantPhone(formatPhoneInput(e.target.value))}
              placeholder="(88) 99999-9999"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>

          <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,0.9fr)] gap-3 items-start">
            <MoneyInput
              label="Aluguel por mês"
              value={tenantRentText}
              onChange={setTenantRentText}
              required
            />
            <div className="min-w-0">
              <label className="block text-sm sm:text-base font-bold text-stone-800 mb-1.5">
                Dia venc.
              </label>
              <input
                type="number"
                min={1}
                max={31}
                required
                value={tenantDueDay}
                onChange={(e) => setTenantDueDay(e.target.value)}
                className="w-full px-3 sm:px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base sm:text-xl font-bold tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-stone-700 mb-1">Data que entrou</label>
            <input
              type="date"
              value={tenantStartDate}
              onChange={(e) => setTenantStartDate(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>

          <button
            type="submit"
            disabled={savingTenant}
            className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-lg"
          >
            {savingTenant ? 'SALVANDO...' : 'SALVAR INQUILINO'}
          </button>
        </form>
      </Modal>

      {/* Pay Rent Modal */}
      <Modal
        open={Boolean(payCharge)}
        onClose={() => setPayCharge(null)}
        title={payCharge ? `Receber: ${payCharge.property_name}` : ''}
      >
        {payCharge && (
          <form onSubmit={handleConfirmPay} className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
              <div className="text-sm font-bold text-stone-700">
                Inquilino: <strong>{payCharge.tenant_name}</strong> ({formatMonthBR(payCharge.reference_month)})
              </div>
              <div className="flex justify-between items-center">
                <span className="font-bold text-amber-950">Falta pagar:</span>
                <span className="text-xl font-black text-amber-900">
                  {formatBRL(payCharge.remaining_cents)}
                </span>
              </div>
            </div>

            <MoneyInput
              label="Quanto pagou?"
              value={payAmountText}
              onChange={setPayAmountText}
              required
            />

            <PaymentMethodSelector value={payMethod} onChange={setPayMethod} />

            <button
              type="submit"
              disabled={paying}
              className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-black text-lg"
            >
              {paying ? 'ANOTANDO...' : 'CONFIRMAR PAGAMENTO'}
            </button>
          </form>
        )}
      </Modal>

      {/* Register Rent Payment Modal (Select Tenant/Client) */}
      <Modal
        open={regPayOpen}
        onClose={() => setRegPayOpen(false)}
        title="Registrar Pagamento do Aluguel"
      >
        {payableLeases.length === 0 ? (
          <div className="text-center py-4 space-y-4">
            <Users className="w-12 h-12 text-stone-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-lg font-extrabold text-stone-800">
                Nenhum inquilino cadastrado ainda
              </p>
              <p className="text-sm font-semibold text-stone-500">
                Cadastre primeiro a casa e o inquilino para poder anotar pagamentos de aluguel.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setRegPayOpen(false);
                openNewTenantModal();
              }}
              className="w-full py-3.5 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-base flex items-center justify-center gap-2"
            >
              <UserPlus className="w-5 h-5" /> Cadastrar Inquilino
            </button>
          </div>
        ) : (
          <form onSubmit={handleConfirmRegisterPayment} className="space-y-4">
            <div>
              <label className="block text-base font-bold text-stone-800 mb-1.5">
                Qual cliente / inquilino pagou? <span className="text-orange-600">*</span>
              </label>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setTenantPickerOpen((prev) => !prev);
                    setMonthPickerOpen(false);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-2xl border-2 bg-white flex items-center justify-between gap-2 transition ${
                    tenantPickerOpen ? 'border-[#0B4619]' : 'border-stone-300'
                  }`}
                >
                  {selectedRegLease ? (
                    <div className="min-w-0 flex-1">
                      <div className="text-sm sm:text-base font-extrabold text-stone-900 break-words leading-snug">
                        {selectedRegLease.tenant_name}
                      </div>
                      <div className="text-xs font-bold text-stone-600 mt-0.5 break-words">
                        {selectedRegLease.property_name} •{' '}
                        <span
                          className={
                            selectedRegLease.open_debt_cents > 0
                              ? 'text-amber-800 font-extrabold'
                              : 'text-emerald-700 font-extrabold'
                          }
                        >
                          {selectedRegLease.open_debt_cents > 0
                            ? `Falta ${formatBRL(selectedRegLease.open_debt_cents)}`
                            : 'Em dia'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm font-bold text-stone-500">Escolher inquilino...</span>
                  )}
                  <ChevronDown
                    className={`w-5 h-5 text-stone-500 shrink-0 transition-transform ${
                      tenantPickerOpen ? 'rotate-180 text-[#0B4619]' : ''
                    }`}
                  />
                </button>

                {tenantPickerOpen && (
                  <div className="mt-1.5 max-h-56 overflow-y-auto rounded-2xl border-2 border-[#0B4619] bg-white p-1.5 space-y-1 shadow-sm">
                    {payableLeases.map((l) => {
                      const active = selectedRegLease?.id === l.id;
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => applyLeaseSelection(l)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition ${
                            active
                              ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
                              : 'hover:bg-stone-50 text-stone-900'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-extrabold text-sm break-words leading-snug">
                              {l.tenant_name}
                            </div>
                            <div className="text-xs font-bold text-stone-600 mt-0.5 break-words">
                              {l.property_name} •{' '}
                              <span
                                className={
                                  l.open_debt_cents > 0
                                    ? 'text-amber-800 font-extrabold'
                                    : 'text-emerald-700 font-extrabold'
                                }
                              >
                                {l.open_debt_cents > 0
                                  ? `Falta ${formatBRL(l.open_debt_cents)}`
                                  : 'Em dia'}
                              </span>
                            </div>
                          </div>
                          {active && <CheckCircle2 className="w-4 h-4 text-[#0B4619] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {selectedRegLease && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm font-bold text-stone-700">
                  <span>{selectedRegLease.property_name}</span>
                  <span>Aluguel: {formatBRL(selectedRegLease.monthly_rent_cents)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-amber-950">
                    {selectedRegLease.open_debt_cents > 0 ? 'Total em aberto:' : 'Situação:'}
                  </span>
                  <span
                    className={`text-lg font-black ${
                      selectedRegLease.open_debt_cents > 0 ? 'text-amber-900' : 'text-emerald-800'
                    }`}
                  >
                    {selectedRegLease.open_debt_cents > 0
                      ? formatBRL(selectedRegLease.open_debt_cents)
                      : 'Em dia'}
                  </span>
                </div>
              </div>
            )}

            {selectedRegLease && (
              <div>
                <label className="block text-base font-bold text-stone-800 mb-1.5">
                  Qual mês está pagando? <span className="text-orange-600">*</span>
                </label>
                {selectedLeaseReceivables.length > 0 && (() => {
                  const selectedCharge = selectedLeaseReceivables.find(
                    (c) => String(c.id) === regChargeChoice,
                  );
                  const selectChargeChoice = (val: string) => {
                    setRegChargeChoice(val);
                    setMonthPickerOpen(false);
                    if (val === 'CUSTOM_MONTH') {
                      setRegCustomMonth(suggestCustomMonthForLease(selectedRegLease.id));
                      setRegAmountText(centsToInputString(selectedRegLease.monthly_rent_cents));
                    } else {
                      const found = selectedLeaseReceivables.find((c) => String(c.id) === val);
                      if (found) setRegAmountText(centsToInputString(found.remaining_cents));
                    }
                  };
                  return (
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          setMonthPickerOpen((prev) => !prev);
                          setTenantPickerOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-2xl border-2 bg-white flex items-center justify-between gap-2 transition ${
                          monthPickerOpen ? 'border-[#0B4619]' : 'border-stone-300'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          {selectedCharge ? (
                            <>
                              <div className="text-sm sm:text-base font-extrabold text-stone-900 break-words leading-snug">
                                {formatMonthBR(selectedCharge.reference_month)}
                              </div>
                              <div className="text-xs font-bold text-stone-600 mt-0.5 break-words">
                                Falta {formatBRL(selectedCharge.remaining_cents)} •{' '}
                                <span
                                  className={
                                    selectedCharge.display_status === 'ATRASADO'
                                      ? 'text-red-700 font-extrabold'
                                      : 'text-amber-800 font-extrabold'
                                  }
                                >
                                  {selectedCharge.display_status === 'ATRASADO'
                                    ? 'Atrasado'
                                    : 'Pendente'}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="text-sm sm:text-base font-extrabold text-stone-900 break-words leading-snug">
                              Outro mês (adiantar aluguel)
                            </div>
                          )}
                        </div>
                        <ChevronDown
                          className={`w-5 h-5 text-stone-500 shrink-0 transition-transform ${
                            monthPickerOpen ? 'rotate-180 text-[#0B4619]' : ''
                          }`}
                        />
                      </button>

                      {monthPickerOpen && (
                        <div className="mt-1.5 max-h-52 overflow-y-auto rounded-2xl border-2 border-[#0B4619] bg-white p-1.5 space-y-1 shadow-sm">
                          {selectedLeaseReceivables.map((c) => {
                            const active = regChargeChoice === String(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => selectChargeChoice(String(c.id))}
                                className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition ${
                                  active
                                    ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
                                    : 'hover:bg-stone-50 text-stone-900'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="font-extrabold text-sm break-words leading-snug">
                                    {formatMonthBR(c.reference_month)}
                                  </div>
                                  <div className="text-xs font-bold text-stone-600 mt-0.5 break-words">
                                    Falta {formatBRL(c.remaining_cents)} •{' '}
                                    <span
                                      className={
                                        c.display_status === 'ATRASADO'
                                          ? 'text-red-700 font-extrabold'
                                          : 'text-amber-800 font-extrabold'
                                      }
                                    >
                                      {c.display_status === 'ATRASADO' ? 'Atrasado' : 'Pendente'}
                                    </span>
                                  </div>
                                </div>
                                {active && <CheckCircle2 className="w-4 h-4 text-[#0B4619] shrink-0" />}
                              </button>
                            );
                          })}
                          {selectedRegLease.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => selectChargeChoice('CUSTOM_MONTH')}
                              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 transition ${
                                regChargeChoice === 'CUSTOM_MONTH'
                                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
                                  : 'hover:bg-stone-50 text-stone-900'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-extrabold text-sm break-words">
                                  Outro mês (adiantar aluguel)
                                </div>
                              </div>
                              {regChargeChoice === 'CUSTOM_MONTH' && (
                                <CheckCircle2 className="w-4 h-4 text-[#0B4619] shrink-0" />
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {(selectedLeaseReceivables.length === 0 || regChargeChoice === 'CUSTOM_MONTH') && (
                  <div className={selectedLeaseReceivables.length > 0 ? 'mt-2.5' : ''}>
                    <div className="flex items-center gap-2">
                      <input
                        type="month"
                        required
                        value={regCustomMonth}
                        onChange={(e) => setRegCustomMonth(e.target.value)}
                        className="flex-1 px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
                      />
                      {/^\d{4}-(0[1-9]|1[0-2])$/.test(regCustomMonth) && (
                        <span className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-extrabold text-emerald-900 shrink-0">
                          {formatMonthBR(regCustomMonth)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-stone-500 mt-1">
                      {selectedLeaseReceivables.length === 0
                        ? 'Sem cobrança pendente — escolha o mês que deseja adiantar ou quitar.'
                        : 'Escolha o mês para registrar pagamento adiantado.'}
                    </p>
                  </div>
                )}
              </div>
            )}

            <MoneyInput
              label="Quanto pagou?"
              value={regAmountText}
              onChange={setRegAmountText}
              required
            />

            <PaymentMethodSelector value={regMethod} onChange={setRegMethod} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Data do pagamento
                </label>
                <input
                  type="date"
                  required
                  value={regDate}
                  onChange={(e) => setRegDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Observação (opcional)
                </label>
                <input
                  type="text"
                  value={regNotes}
                  onChange={(e) => setRegNotes(e.target.value)}
                  placeholder="Ex: Pix enviado"
                  className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={regPaying}
              className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-black text-lg"
            >
              {regPaying ? 'ANOTANDO...' : 'CONFIRMAR PAGAMENTO'}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
