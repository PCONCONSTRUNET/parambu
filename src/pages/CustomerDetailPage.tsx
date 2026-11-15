import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  MapPin,
  Phone,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadPaymentReceiptPdf } from '../lib/pdfReceipt';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import {
  centsToInputString,
  formatBRL,
  formatCpfInput,
  formatDateBR,
  formatPhoneInput,
  newIdempotencyKey,
  parseMoneyToCents,
} from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import {
  PaymentMethodInline,
  PaymentMethodSelector,
} from '../components/PaymentMethodIcon';
import { SaleDetailModal, type SaleDetailData } from '../components/SaleDetailModal';

interface CustomerDetailData {
  customer: {
    id: number;
    name: string;
    phone: string | null;
    cpf: string | null;
    address: string | null;
    notes: string | null;
  };
  totalRemainingCents: number;
  debts: Array<{
    id: number;
    sale_id: number | null;
    description: string;
    total_cents: number;
    paid_cents: number;
    remaining_cents: number;
    status: 'OPEN' | 'PAID';
    sale_date: string | null;
    installments: Array<{
      id: number;
      installment_number: number;
      due_date: string;
      amount_cents: number;
      paid_cents: number;
      status: string;
      is_overdue: boolean;
    }>;
  }>;
  payments: Array<{
    id: number;
    debt_id: number;
    amount_cents: number;
    payment_method: string;
    payment_date: string;
    debt_description: string;
    notes: string | null;
  }>;
  sales: Array<{
    id: number;
    sale_date: string;
    total_cents: number;
    sale_type: string;
    status: string;
    items_summary: string | null;
  }>;
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const customerId = Number(id);

  const [data, setData] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  // Payment Modal
  const [payOpen, setPayOpen] = useState(false);
  const [targetDebtId, setTargetDebtId] = useState<number | undefined>(undefined);
  const [maxPayableCents, setMaxPayableCents] = useState(0);
  const [payAmountText, setPayAmountText] = useState('');
  const [payMethod, setPayMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [payNotes, setPayNotes] = useState('');
  const [payKey, setPayKey] = useState('');
  const [paying, setPaying] = useState(false);

  // Edit Customer Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCpf, setEditCpf] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Sale Detail Modal
  const [selectedSale, setSelectedSale] = useState<SaleDetailData | null>(null);
  const [loadingSaleId, setLoadingSaleId] = useState<number | null>(null);

  const { showSuccess, showError, confirmAction } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await api<CustomerDetailData>(`/customers/${customerId}`);
        setData(res);
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao abrir cliente.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [customerId, showError],
  );

  const openSaleDetail = async (saleId: number) => {
    setLoadingSaleId(saleId);
    try {
      const sale = await api<SaleDetailData>(`/sales/${saleId}`);
      setSelectedSale(sale);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao abrir detalhes da venda.');
    } finally {
      setLoadingSaleId(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  useLiveRefresh(() => load(true));

  const openReceiveModal = (debtId?: number, maxCents?: number) => {
    if (!data) return;
    const cap = maxCents ?? data.totalRemainingCents;
    setTargetDebtId(debtId);
    setMaxPayableCents(cap);
    setPayAmountText(centsToInputString(cap));
    setPayMethod('DINHEIRO');
    setPayNotes('');
    setPayKey(newIdempotencyKey());
    setPayOpen(true);
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = parseMoneyToCents(payAmountText);
    if (amountCents <= 0) {
      showError('Informe o valor recebido.');
      return;
    }
    if (amountCents > maxPayableCents) {
      showError(`O valor máximo para receber aqui é ${formatBRL(maxPayableCents)}.`);
      return;
    }

    setPaying(true);
    try {
      const res = await api<{
        duplicated: boolean;
        paidCents: number;
        remainingCents?: number;
        settled?: boolean;
      }>('/debts/pay', {
        method: 'POST',
        body: JSON.stringify({
          customerId,
          debtId: targetDebtId,
          amountCents,
          paymentMethod: payMethod,
          notes: payNotes || null,
          idempotencyKey: payKey,
        }),
      });

      setPayOpen(false);
      if (res.settled) {
        showSuccess(`Pago ${formatBRL(res.paidCents)}! Dívida quitada!`);
      } else {
        showSuccess(
          `Recebido ${formatBRL(res.paidCents)}! Ainda falta ${formatBRL(res.remainingCents ?? 0)}.`,
        );
      }
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao receber pagamento.');
    } finally {
      setPaying(false);
    }
  };

  const openEditCustomer = () => {
    if (!data) return;
    setEditName(data.customer.name);
    setEditPhone(data.customer.phone || '');
    setEditCpf(data.customer.cpf || '');
    setEditAddress(data.customer.address || '');
    setEditNotes(data.customer.notes || '');
    setEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/customers/${customerId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editName,
          phone: editPhone || null,
          cpf: editCpf || null,
          address: editAddress || null,
          notes: editNotes || null,
        }),
      });
      showSuccess('Dados do cliente salvos!');
      setEditOpen(false);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar.');
    }
  };

  const navigate = useNavigate();

  const handleDeleteCustomer = async () => {
    if (!data) return;
    const confirmed = await confirmAction({
      title: 'Excluir cliente?',
      message: `Excluir "${data.customer.name}"? Esta ação remove o cliente das listas ativas.`,
      confirmLabel: 'Sim, excluir',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/customers/${customerId}`, { method: 'DELETE' });
      showSuccess('Cliente excluído!');
      navigate('/clientes');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao excluir cliente.');
    }
  };

  const handleReversePayment = async (paymentId: number, amountCents: number) => {
    const confirmed = await confirmAction({
      title: 'Estornar pagamento?',
      message: `Estornar ${formatBRL(amountCents)}? A parcela volta a ficar em aberto e o valor sai do caixa.`,
      confirmLabel: 'Sim, estornar',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await api(`/debts/payments/${paymentId}`, { method: 'DELETE' });
      showSuccess('Pagamento estornado!');
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao estornar pagamento.');
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-3">
        <div className="h-32 rounded-3xl bg-white animate-pulse" />
        <div className="h-44 rounded-3xl bg-white animate-pulse" />
      </div>
    );
  }

  const enteredCents = parseMoneyToCents(payAmountText);
  const afterPayCents = Math.max(0, maxPayableCents - enteredCents);

  return (
    <div className="space-y-5">
      {/* Customer Header */}
      <section className="bg-white rounded-3xl border-2 border-stone-200 p-5 shadow-xs space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-2xl font-black text-stone-900">{data.customer.name}</h2>
            {data.customer.phone && (
              <a
                href={`tel:${data.customer.phone}`}
                className="inline-flex items-center gap-1.5 text-base font-bold text-[#0B4619] mt-1"
              >
                <Phone className="w-4 h-4" /> {data.customer.phone}
              </a>
            )}
            {data.customer.cpf && (
              <div className="text-sm font-bold text-stone-600 mt-1">
                CPF: {data.customer.cpf}
              </div>
            )}
            {data.customer.address && (
              <div className="flex items-center gap-1.5 text-sm font-semibold text-stone-600 mt-1">
                <MapPin className="w-4 h-4 shrink-0" /> {data.customer.address}
              </div>
            )}
            {data.customer.notes && (
              <div className="text-sm font-semibold text-stone-500 mt-0.5">
                Detalhamento: {data.customer.notes}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={openEditCustomer}
              className="px-3.5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 font-bold text-stone-700 text-sm flex items-center gap-1"
            >
              <Edit3 className="w-4 h-4" /> Editar
            </button>
            <button
              type="button"
              onClick={handleDeleteCustomer}
              title="Excluir cliente"
              aria-label="Excluir cliente"
              className="p-2.5 rounded-xl bg-red-50 hover:bg-red-100 border-2 border-red-200 text-red-700"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Debt Balance + Huge Receive Button */}
        <div
          className={`rounded-2xl p-4 border-2 ${
            data.totalRemainingCents > 0
              ? 'bg-orange-50 border-orange-300'
              : 'bg-emerald-50 border-emerald-300'
          }`}
        >
          <div className="text-sm font-extrabold text-stone-700">
            {data.totalRemainingCents > 0 ? 'Total que está devendo' : 'Situação da conta'}
          </div>
          <div
            className={`text-3xl font-black mt-0.5 ${
              data.totalRemainingCents > 0 ? 'text-orange-800' : 'text-emerald-800'
            }`}
          >
            {data.totalRemainingCents > 0 ? formatBRL(data.totalRemainingCents) : 'Tudo Pago!'}
          </div>
        </div>

        {data.totalRemainingCents > 0 && (
          <button
            type="button"
            onClick={() => openReceiveModal(undefined, data.totalRemainingCents)}
            className="w-full py-5 px-5 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] active:scale-[0.99] text-white font-black text-xl shadow-lg flex items-center justify-center gap-2.5"
          >
            <Banknote className="w-7 h-7" />
            Receber pagamento
          </button>
        )}
      </section>

      {/* Debts & Installments */}
      <section className="space-y-3">
        <h3 className="text-lg font-extrabold text-stone-800 px-1">Dívidas e Parcelas</h3>
        {data.debts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center text-stone-500 font-bold">
            Este cliente não tem fiados anotados.
          </div>
        ) : (
          data.debts.map((debt) => (
            <div
              key={debt.id}
              className="bg-white rounded-2xl border-2 border-stone-200 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-extrabold text-stone-900">{debt.description}</div>
                  <div className="text-xs font-bold text-stone-500 mt-0.5">
                    Total: {formatBRL(debt.total_cents)} • Já pagou: {formatBRL(debt.paid_cents)}
                  </div>
                </div>
                {debt.status === 'PAID' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-extrabold shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Quitado
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-xl bg-orange-100 border border-orange-300 text-orange-900 text-sm font-black shrink-0">
                    Falta {formatBRL(debt.remaining_cents)}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {debt.installments.map((inst) => {
                  const instRem = inst.amount_cents - inst.paid_cents;
                  return (
                    <div
                      key={inst.id}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-bold ${
                        inst.status === 'PAID'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : inst.is_overdue
                            ? 'bg-red-50 border-red-200 text-red-900'
                            : 'bg-stone-50 border-stone-200 text-stone-800'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {inst.status === 'PAID' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                        ) : inst.is_overdue ? (
                          <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
                        ) : (
                          <Clock className="w-4 h-4 text-amber-700 shrink-0" />
                        )}
                        <span>
                          Parcela {inst.installment_number} • {formatDateBR(inst.due_date)}
                        </span>
                      </div>
                      <span>
                        {inst.status === 'PAID'
                          ? 'Paga'
                          : inst.paid_cents > 0
                            ? `Falta ${formatBRL(instRem)}`
                            : formatBRL(inst.amount_cents)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {debt.status === 'OPEN' && (
                <button
                  type="button"
                  onClick={() => openReceiveModal(debt.id, debt.remaining_cents)}
                  className="w-full py-3 rounded-xl bg-emerald-100 hover:bg-emerald-200 border-2 border-emerald-300 text-emerald-950 font-extrabold text-sm"
                >
                  Pagar só esta dívida ({formatBRL(debt.remaining_cents)})
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {/* Payments Received History */}
      <section className="space-y-2.5">
        <h3 className="text-lg font-extrabold text-stone-800 px-1">Pagamentos Recebidos</h3>
        {data.payments.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 text-center text-stone-500 font-bold">
            Nenhum pagamento recebido ainda.
          </div>
        ) : (
          data.payments.map((p) => {
            const linkedDebt = data.debts.find((d) => d.id === p.debt_id);
            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-stone-200 p-3.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-extrabold text-emerald-800 text-lg">
                    + {formatBRL(p.amount_cents)}
                  </div>
                  <div className="text-xs font-bold text-stone-500 flex items-center gap-1 flex-wrap">
                    <span>{formatDateBR(p.payment_date)} •</span>
                    <PaymentMethodInline method={p.payment_method} iconClassName="w-3.5 h-3.5" />
                  </div>
                  {p.notes && <div className="text-xs text-stone-600 mt-0.5">{p.notes}</div>}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-xs font-bold text-stone-500 text-right max-w-[160px] truncate">
                    {p.debt_description}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleReversePayment(p.id, p.amount_cents)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-extrabold"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Estornar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void downloadPaymentReceiptPdf({
                          paymentId: p.id,
                          customerName: data.customer.name,
                          customerPhone: data.customer.phone,
                          customerAddress: data.customer.address,
                          customerNotes: data.customer.notes,
                          amountCents: p.amount_cents,
                          paymentMethod: p.payment_method,
                          paymentDate: p.payment_date,
                          debtDescription: p.debt_description,
                          debtTotalCents: linkedDebt?.total_cents,
                          debtPaidCents: linkedDebt?.paid_cents,
                          debtRemainingCents: linkedDebt?.remaining_cents,
                          notes: p.notes,
                        }).catch(() =>
                          showError('Não foi possível gerar o PDF do recibo.'),
                        );
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-extrabold"
                    >
                      <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* Purchase History */}
      {data.sales.length > 0 && (
        <section className="space-y-2.5">
          <h3 className="text-lg font-extrabold text-stone-800 px-1">Compras do Cliente</h3>
          {data.sales.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openSaleDetail(s.id)}
              disabled={loadingSaleId === s.id}
              className="w-full text-left bg-white hover:bg-stone-50 rounded-2xl border border-stone-200 p-3.5 flex items-center justify-between gap-2 transition-colors disabled:opacity-60"
            >
              <div className="min-w-0">
                <div className="font-extrabold text-stone-900 truncate">
                  {s.items_summary || `Venda #${s.id}`}
                </div>
                <div className="text-xs font-bold text-stone-500">
                  {formatDateBR(s.sale_date)} •{' '}
                  {s.status === 'CANCELLED' ? 'Cancelada' : s.sale_type === 'CASH' ? 'À vista' : 'Fiado/Parcelado'}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="font-black text-stone-800">
                  {formatBRL(s.total_cents)}
                </div>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 border border-stone-300 text-stone-700 text-[11px] font-extrabold">
                  <Download className="w-3 h-3" /> {loadingSaleId === s.id ? 'Abrindo...' : 'Ver / PDF'}
                </span>
              </div>
            </button>
          ))}
        </section>
      )}

      {/* Receive Payment Modal */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Receber Pagamento"
      >
        <form onSubmit={handleConfirmPayment} className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-orange-50 border border-orange-200 flex justify-between items-center">
            <span className="font-bold text-orange-950">Deve agora:</span>
            <span className="text-xl font-black text-orange-800">{formatBRL(maxPayableCents)}</span>
          </div>

          <MoneyInput
            label="Quanto o cliente pagou agora?"
            value={payAmountText}
            onChange={setPayAmountText}
            required
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPayAmountText(centsToInputString(maxPayableCents))}
              className="flex-1 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 font-extrabold text-sm text-stone-800"
            >
              Tudo ({formatBRL(maxPayableCents)})
            </button>
            {maxPayableCents >= 200 && (
              <button
                type="button"
                onClick={() => setPayAmountText(centsToInputString(Math.floor(maxPayableCents / 2)))}
                className="flex-1 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 font-extrabold text-sm text-stone-800"
              >
                Metade ({formatBRL(Math.floor(maxPayableCents / 2))})
              </button>
            )}
          </div>

          {enteredCents > 0 && enteredCents <= maxPayableCents && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm font-extrabold text-emerald-950">
              {afterPayCents === 0
                ? '✅ Vai quitar toda essa dívida!'
                : `Vai ficar faltando: ${formatBRL(afterPayCents)}`}
            </div>
          )}

          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Como pagou?
            </label>
            <PaymentMethodSelector value={payMethod} onChange={setPayMethod} />
          </div>

          <div>
            <label className="block text-sm font-bold text-stone-700 mb-1">
              Observação (opcional)
            </label>
            <input
              type="text"
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder="Ex: Pagou na feira"
              className="w-full px-3.5 py-3 rounded-xl border border-stone-300 bg-white text-base font-bold"
            />
          </div>

          <button
            type="submit"
            disabled={paying}
            className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-black text-xl shadow-lg disabled:opacity-60"
          >
            {paying ? 'ANOTANDO...' : 'CONFIRMAR RECEBIMENTO'}
          </button>
        </form>
      </Modal>

      {/* Edit Customer Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Editar Cliente">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">Nome</label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">Telefone</label>
            <input
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(formatPhoneInput(e.target.value))}
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">CPF</label>
            <input
              type="text"
              inputMode="numeric"
              value={editCpf}
              onChange={(e) => setEditCpf(formatCpfInput(e.target.value))}
              placeholder="000.000.000-00"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">Endereço</label>
            <input
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              placeholder="Ex: Rua da Matriz, 40"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1">
              Detalhamento do endereço
            </label>
            <input
              type="text"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Ex: Casa verde perto da igreja, portão branco"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>
          <button
            type="submit"
            className="w-full py-4 rounded-2xl bg-[#0B4619] text-white font-extrabold text-lg"
          >
            SALVAR ALTERAÇÕES
          </button>
        </form>
      </Modal>

      <SaleDetailModal
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
        onCancelled={load}
      />
    </div>
  );
}
