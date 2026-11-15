import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Edit3,
  Home,
  Phone,
  RotateCcw,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { api, getCachedApi } from '../lib/api';
import type { RentalsOverviewResponse } from './RentalsPage';
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

interface PropertyDetailData {
  property: {
    id: number;
    name: string;
    address: string | null;
    photo_url: string | null;
    monthly_rent_cents: number;
    due_day: number;
    status: 'AVAILABLE' | 'OCCUPIED';
  };
  activeLease: {
    id: number;
    tenant_name: string;
    tenant_phone: string | null;
    monthly_rent_cents: number;
    due_day: number;
    start_date: string;
  } | null;
  leases: Array<{
    id: number;
    tenant_name: string;
    start_date: string;
    end_date: string | null;
    status: 'ACTIVE' | 'ENDED';
  }>;
  charges: Array<{
    id: number;
    reference_month: string;
    due_date: string;
    amount_cents: number;
    paid_cents: number;
    remaining_cents: number;
    tenant_name: string;
    display_status: 'PAGO' | 'PENDENTE' | 'ATRASADO';
  }>;
  payments: Array<{
    id: number;
    amount_cents: number;
    payment_method: string;
    payment_date: string;
    tenant_name: string;
    reference_month: string;
  }>;
  totalDebtCents: number;
}

function buildInitialPropertyDetail(propertyId: number): PropertyDetailData | null {
  const exact = getCachedApi<PropertyDetailData>(`/rentals/properties/${propertyId}`);
  if (exact) return exact;
  const overview = getCachedApi<RentalsOverviewResponse>('/rentals/overview');
  if (!overview) return null;
  const prop = overview.properties.find((p) => p.id === propertyId);
  if (!prop) return null;
  const propLeases = overview.leases.filter((l) => l.property_id === propertyId);
  const activeLease = propLeases.find((l) => l.status === 'ACTIVE') ?? null;
  const openCharges = overview.receivables
    .filter((r) => r.property_id === propertyId)
    .map((r) => ({
      id: r.id,
      reference_month: r.reference_month,
      due_date: r.due_date,
      amount_cents: r.amount_cents,
      paid_cents: r.paid_cents,
      remaining_cents: r.remaining_cents,
      tenant_name: r.tenant_name,
      display_status: r.display_status,
    }));
  const propPayments = overview.payments
    .filter((p) => p.property_id === propertyId)
    .map((p) => ({
      id: p.id,
      amount_cents: p.amount_cents,
      payment_method: p.payment_method,
      payment_date: p.payment_date,
      tenant_name: p.tenant_name,
      reference_month: p.reference_month,
    }));
  return {
    property: {
      id: prop.id,
      name: prop.name,
      address: prop.address,
      photo_url: prop.photo_url,
      monthly_rent_cents: prop.monthly_rent_cents,
      due_day: prop.due_day,
      status: prop.status,
    },
    activeLease: activeLease
      ? {
          id: activeLease.id,
          tenant_name: activeLease.tenant_name,
          tenant_phone: activeLease.tenant_phone,
          monthly_rent_cents: activeLease.monthly_rent_cents,
          due_day: activeLease.due_day,
          start_date: activeLease.start_date,
        }
      : null,
    leases: propLeases.map((l) => ({
      id: l.id,
      tenant_name: l.tenant_name,
      start_date: l.start_date,
      end_date: l.end_date,
      status: l.status,
    })),
    charges: openCharges,
    payments: propPayments,
    totalDebtCents: prop.total_debt_cents,
  };
}

export function PropertyDetailPage() {
  const { id } = useParams();
  const propertyId = Number(id);

  const [data, setData] = useState<PropertyDetailData | null>(() =>
    buildInitialPropertyDetail(propertyId),
  );
  const [loading, setLoading] = useState(() => !buildInitialPropertyDetail(propertyId));
  const loadedPropertyIdRef = useRef<number | null>(data ? propertyId : null);

  // Lease Modal (create or edit active lease)
  const [leaseOpen, setLeaseOpen] = useState(false);
  const [editingLeaseId, setEditingLeaseId] = useState<number | null>(null);
  const [tenantName, setTenantName] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  const [leaseRentText, setLeaseRentText] = useState('');
  const [leaseDueDay, setLeaseDueDay] = useState('10');
  const [startDate, setStartDate] = useState(() => todayLocalISO());
  const [savingLease, setSavingLease] = useState(false);

  // Pay Rent Modal
  const [payCharge, setPayCharge] = useState<PropertyDetailData['charges'][0] | null>(null);
  const [payAmountText, setPayAmountText] = useState('');
  const [payMethod, setPayMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [payKey, setPayKey] = useState('');
  const [paying, setPaying] = useState(false);

  // Edit Property Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editRentText, setEditRentText] = useState('');
  const [editDueDay, setEditDueDay] = useState('10');
  const [editPhoto, setEditPhoto] = useState<string | null>(null);

  const { showSuccess, showError, confirmAction } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      const hasCurrentData = loadedPropertyIdRef.current === propertyId;
      const shouldShowLoading = !silent && !hasCurrentData;
      if (shouldShowLoading) setLoading(true);
      try {
        const res = await api<PropertyDetailData>(`/rentals/properties/${propertyId}`);
        loadedPropertyIdRef.current = propertyId;
        setData(res);
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao abrir imóvel.');
        }
      } finally {
        setLoading(false);
      }
    },
    [propertyId, showError],
  );

  useEffect(() => {
    const initial = buildInitialPropertyDetail(propertyId);
    if (initial) {
      loadedPropertyIdRef.current = propertyId;
      setData(initial);
      setLoading(false);
    } else if (loadedPropertyIdRef.current !== propertyId) {
      loadedPropertyIdRef.current = null;
      setData(null);
      setLoading(true);
    }
    load(Boolean(initial));
  }, [load, propertyId]);

  useLiveRefresh(() => load(true));

  const navigate = useNavigate();

  const openLeaseModal = () => {
    if (!data) return;
    setEditingLeaseId(null);
    setTenantName('');
    setTenantPhone('');
    setLeaseRentText(centsToInputString(data.property.monthly_rent_cents));
    setLeaseDueDay(String(data.property.due_day));
    setStartDate(todayLocalISO());
    setLeaseOpen(true);
  };

  const openEditLeaseModal = () => {
    if (!data?.activeLease) return;
    setEditingLeaseId(data.activeLease.id);
    setTenantName(data.activeLease.tenant_name);
    setTenantPhone(data.activeLease.tenant_phone || '');
    setLeaseRentText(centsToInputString(data.activeLease.monthly_rent_cents));
    setLeaseDueDay(String(data.activeLease.due_day));
    setStartDate(data.activeLease.start_date);
    setLeaseOpen(true);
  };

  const handleStartLease = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLease(true);
    try {
      if (editingLeaseId) {
        await api(`/rentals/leases/${editingLeaseId}`, {
          method: 'PUT',
          body: JSON.stringify({
            tenantName,
            tenantPhone: tenantPhone || null,
            monthlyRentCents: parseMoneyToCents(leaseRentText),
            dueDay: Number.parseInt(leaseDueDay, 10),
          }),
        });
        showSuccess('Dados do inquilino atualizados!');
      } else {
        await api(`/rentals/properties/${propertyId}/lease`, {
          method: 'POST',
          body: JSON.stringify({
            tenantName,
            tenantPhone: tenantPhone || null,
            monthlyRentCents: parseMoneyToCents(leaseRentText),
            dueDay: Number.parseInt(leaseDueDay, 10),
            startDate,
          }),
        });
        showSuccess('Inquilino colocado no imóvel!');
      }
      setLeaseOpen(false);
      setEditingLeaseId(null);
      await load(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar locação.');
    } finally {
      setSavingLease(false);
    }
  };

  const handleDeleteProperty = async () => {
    if (!data) return;
    const confirmed = await confirmAction({
      title: 'Excluir imóvel?',
      message: `Tem certeza que deseja excluir o imóvel "${data.property.name}"?`,
      confirmLabel: 'Sim, excluir',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/rentals/properties/${propertyId}`, { method: 'DELETE' });
      showSuccess('Imóvel excluído!');
      navigate('/alugueis');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao excluir imóvel.');
    }
  };

  const handleReverseRentPayment = async (paymentId: number, amountCents: number) => {
    const confirmed = await confirmAction({
      title: 'Estornar recebimento?',
      message: `Estornar ${formatBRL(amountCents)} de aluguel? A cobrança volta a ficar pendente e o valor sai do caixa.`,
      confirmLabel: 'Sim, estornar',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/rentals/payments/${paymentId}`, { method: 'DELETE' });
      showSuccess('Recebimento de aluguel estornado!');
      await load(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao estornar recebimento.');
    }
  };

  const handleEndLease = async () => {
    if (!data?.activeLease) return;
    const confirmed = await confirmAction({
      title: 'Encerrar locação?',
      message: `Encerrar a locação de ${data.activeLease.tenant_name}? Todo o histórico de pagamentos fica guardado.`,
      confirmLabel: 'Sim, encerrar',
      tone: 'warning',
    });
    if (!confirmed) return;
    try {
      await api(`/rentals/leases/${data.activeLease.id}/end`, { method: 'POST' });
      showSuccess('Locação encerrada! Imóvel está livre novamente.');
      await load(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao encerrar locação.');
    }
  };

  const openPayModal = (charge: PropertyDetailData['charges'][0]) => {
    setPayCharge(charge);
    setPayAmountText(centsToInputString(charge.remaining_cents));
    setPayMethod('DINHEIRO');
    setPayKey(newIdempotencyKey());
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
      showError(`O valor máximo desta parcela é ${formatBRL(payCharge.remaining_cents)}.`);
      return;
    }

    setPaying(true);
    try {
      const res = await api<{ settled: boolean; paidCents: number; remainingCents: number }>(
        `/rentals/charges/${payCharge.id}/pay`,
        {
          method: 'POST',
          body: JSON.stringify({
            amountCents,
            paymentMethod: payMethod,
            idempotencyKey: payKey,
          }),
        },
      );
      setPayCharge(null);
      showSuccess(
        res.settled
          ? `Aluguel pago! ${formatBRL(res.paidCents)}`
          : `Recebido ${formatBRL(res.paidCents)}! Ainda falta ${formatBRL(res.remainingCents)}.`,
      );
      await load(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao receber aluguel.');
    } finally {
      setPaying(false);
    }
  };

  const openEdit = () => {
    if (!data) return;
    setEditName(data.property.name);
    setEditAddress(data.property.address || '');
    setEditRentText(centsToInputString(data.property.monthly_rent_cents));
    setEditDueDay(String(data.property.due_day));
    setEditPhoto(data.property.photo_url);
    setEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/rentals/properties/${propertyId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName,
          address: editAddress || null,
          photoUrl: editPhoto,
          monthlyRentCents: parseMoneyToCents(editRentText),
          dueDay: Number.parseInt(editDueDay, 10),
        }),
      });
      showSuccess('Imóvel atualizado!');
      setEditOpen(false);
      await load(true);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao editar imóvel.');
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-36 rounded-3xl bg-white animate-pulse" />
        <div className="h-44 rounded-3xl bg-white animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Property Header */}
      <section className="bg-white rounded-3xl border-2 border-stone-200 p-4 space-y-3">
        <div className="flex items-start gap-3">
          {data.property.photo_url ? (
            <img
              src={data.property.photo_url}
              alt={data.property.name}
              className="w-20 h-20 rounded-2xl object-cover border border-stone-200 shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center shrink-0">
              <Home className="w-10 h-10 text-[#7C2D12]" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-black text-stone-900">{data.property.name}</h2>
              <button
                type="button"
                onClick={openEdit}
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 text-stone-700 font-bold text-xs flex items-center gap-1 shrink-0"
              >
                <Edit3 className="w-4 h-4" /> Editar
              </button>
            </div>
            {data.property.address && (
              <p className="text-sm font-semibold text-stone-600">{data.property.address}</p>
            )}
            <p className="text-base font-black text-[#0B4619] mt-1">
              {formatBRL(data.property.monthly_rent_cents)} / mês • Vence dia{' '}
              {data.property.due_day}
            </p>
          </div>
        </div>

        {/* Active Tenant Box */}
        {data.activeLease ? (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-extrabold uppercase text-emerald-800 flex items-center gap-1">
                  <UserCheck className="w-4 h-4" /> Inquilino Atual
                </div>
                <div className="text-lg font-black text-stone-900">
                  {data.activeLease.tenant_name}
                </div>
                {data.activeLease.tenant_phone && (
                  <a
                    href={`tel:${data.activeLease.tenant_phone}`}
                    className="inline-flex items-center gap-1 text-sm font-bold text-[#0B4619]"
                  >
                    <Phone className="w-3.5 h-3.5" /> {data.activeLease.tenant_phone}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={openEditLeaseModal}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 font-extrabold text-xs flex items-center gap-1"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Editar
                </button>
                <button
                  type="button"
                  onClick={handleEndLease}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-red-50 text-red-800 border border-red-200 font-extrabold text-xs flex items-center gap-1"
                >
                  <UserMinus className="w-4 h-4" /> Encerrar
                </button>
              </div>
            </div>
            <div className="text-xs font-bold text-stone-600">
              Entrou em {formatDateBR(data.activeLease.start_date)}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openLeaseModal}
            className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-lg flex items-center justify-center gap-2 shadow-sm"
          >
            <UserPlus className="w-6 h-6" /> Colocar Inquilino (Alugar)
          </button>
        )}

        {data.totalDebtCents > 0 && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 p-3 flex justify-between items-center">
            <span className="font-extrabold text-orange-950">Saldo devedor do imóvel:</span>
            <span className="text-xl font-black text-orange-800">
              {formatBRL(data.totalDebtCents)}
            </span>
          </div>
        )}
      </section>

      {/* Monthly Charges */}
      <section className="space-y-2.5">
        <h3 className="text-lg font-extrabold text-stone-800 px-1">Meses de Aluguel</h3>
        {data.charges.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center text-stone-500 font-bold">
            Nenhuma cobrança gerada ainda.
          </div>
        ) : (
          data.charges.map((c) => (
            <div
              key={c.id}
              className="bg-white rounded-2xl border-2 border-stone-200 p-4 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-black text-stone-900">
                    {formatMonthBR(c.reference_month)}
                  </div>
                  <div className="text-sm font-bold text-stone-600">
                    {c.tenant_name} • Vence {formatDateBR(c.due_date)}
                  </div>
                  {c.paid_cents > 0 && c.remaining_cents > 0 && (
                    <div className="text-xs font-bold text-emerald-800 mt-0.5">
                      Já pagou {formatBRL(c.paid_cents)} • Falta {formatBRL(c.remaining_cents)}
                    </div>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xl font-black text-stone-900">
                    {formatBRL(c.amount_cents)}
                  </div>
                  {c.display_status === 'PAGO' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-extrabold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Pago
                    </span>
                  ) : c.display_status === 'ATRASADO' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-red-100 border border-red-300 text-red-900 text-xs font-extrabold">
                      <AlertTriangle className="w-3.5 h-3.5" /> Atrasado
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-100 border border-amber-300 text-amber-950 text-xs font-extrabold">
                      <Clock className="w-3.5 h-3.5" /> Pendente
                    </span>
                  )}
                </div>
              </div>

              {c.remaining_cents > 0 && (
                <button
                  type="button"
                  onClick={() => openPayModal(c)}
                  className="w-full py-3.5 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-base flex items-center justify-center gap-2"
                >
                  <Banknote className="w-5 h-5" /> Receber aluguel ({formatBRL(c.remaining_cents)})
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {/* Payments History */}
      {data.payments.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-lg font-extrabold text-stone-800 px-1">Pagamentos Recebidos</h3>
          {data.payments.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-2xl border border-stone-200 p-3.5 flex items-center justify-between gap-2"
            >
              <div>
                <div className="font-extrabold text-emerald-800 text-lg">
                  + {formatBRL(p.amount_cents)}
                </div>
                <div className="text-xs font-bold text-stone-500 flex items-center gap-1 flex-wrap">
                  <span>{formatDateBR(p.payment_date)} •</span>
                  <PaymentMethodInline method={p.payment_method} iconClassName="w-3.5 h-3.5" />
                  <span>• {p.tenant_name}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className="text-xs font-extrabold text-stone-600 bg-stone-100 border border-stone-300 px-2.5 py-1 rounded-lg">
                  {formatMonthBR(p.reference_month)}
                </span>
                <button
                  type="button"
                  onClick={() => handleReverseRentPayment(p.id, p.amount_cents)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-extrabold"
                >
                  <RotateCcw className="w-3 h-3" /> Estornar
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Past Leases */}
      {data.leases.filter((l) => l.status === 'ENDED').length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-extrabold text-stone-700 px-1">Inquilinos Anteriores</h3>
          {data.leases
            .filter((l) => l.status === 'ENDED')
            .map((l) => (
              <div
                key={l.id}
                className="bg-white rounded-2xl border border-stone-200 p-3 text-sm font-bold text-stone-600 flex justify-between"
              >
                <span>{l.tenant_name}</span>
                <span>
                  {formatDateBR(l.start_date)} até {formatDateBR(l.end_date)}
                </span>
              </div>
            ))}
        </section>
      )}

      {/* Start / Edit Lease Modal */}
      <Modal
        open={leaseOpen}
        onClose={() => {
          setLeaseOpen(false);
          setEditingLeaseId(null);
        }}
        title={editingLeaseId ? 'Editar Inquilino Atual' : 'Colocar Inquilino'}
      >
        <form onSubmit={handleStartLease} className="space-y-4">
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
            <MoneyInput label="Valor mensal" value={leaseRentText} onChange={setLeaseRentText} required />
            <div className="min-w-0">
              <label className="block text-sm sm:text-base font-bold text-stone-800 mb-1.5">
                Dia venc.
              </label>
              <input
                type="number"
                min={1}
                max={31}
                required
                value={leaseDueDay}
                onChange={(e) => setLeaseDueDay(e.target.value)}
                className="w-full px-3 sm:px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base sm:text-xl font-bold tabular-nums"
              />
            </div>
          </div>
          {!editingLeaseId && (
            <div>
              <label className="block text-sm font-bold text-stone-700 mb-1">Data de início</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={savingLease}
            className="w-full py-4 rounded-2xl bg-[#0B4619] text-white font-extrabold text-lg"
          >
            {savingLease
              ? 'SALVANDO...'
              : editingLeaseId
                ? 'SALVAR INQUILINO'
                : 'CONFIRMAR INQUILINO'}
          </button>
        </form>
      </Modal>

      {/* Pay Rent Modal */}
      <Modal
        open={Boolean(payCharge)}
        onClose={() => setPayCharge(null)}
        title={payCharge ? `Aluguel ${formatMonthBR(payCharge.reference_month)}` : ''}
      >
        {payCharge && (
          <form onSubmit={handleConfirmPay} className="space-y-4">
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex justify-between items-center">
              <span className="font-bold text-amber-950">Falta pagar:</span>
              <span className="text-xl font-black text-amber-900">
                {formatBRL(payCharge.remaining_cents)}
              </span>
            </div>

            <MoneyInput
              label="Quanto recebeu?"
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
              {paying ? 'ANOTANDO...' : 'CONFIRMAR RECEBIMENTO'}
            </button>
          </form>
        )}
      </Modal>

      {/* Edit Property Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Editar Imóvel">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">Nome / Número</label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,0.9fr)] gap-3 items-start">
            <MoneyInput label="Valor mensal" value={editRentText} onChange={setEditRentText} required />
            <div className="min-w-0">
              <label className="block text-sm sm:text-base font-bold text-stone-800 mb-1.5">
                Dia venc.
              </label>
              <input
                type="number"
                min={1}
                max={31}
                required
                value={editDueDay}
                onChange={(e) => setEditDueDay(e.target.value)}
                className="w-full px-3 sm:px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base sm:text-xl font-bold tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">Endereço</label>
            <input
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>
          <ImageUpload value={editPhoto} onChange={setEditPhoto} />
          <button
            type="submit"
            className="w-full py-4 rounded-2xl bg-[#0B4619] text-white font-extrabold text-lg"
          >
            SALVAR ALTERAÇÕES
          </button>
          <button
            type="button"
            onClick={() => {
              setEditOpen(false);
              void handleDeleteProperty();
            }}
            className="w-full py-3 rounded-2xl bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-700 font-extrabold text-base flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> EXCLUIR IMÓVEL
          </button>
        </form>
      </Modal>
    </div>
  );
}
