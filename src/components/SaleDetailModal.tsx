import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  Download,
  Edit3,
  Minus,
  PackagePlus,
  Plus,
  RotateCcw,
  Trash2,
  User,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadSaleReceiptPdf } from '../lib/pdfReceipt';
import {
  centsToInputString,
  formatBRL,
  formatDateBR,
  parseMoneyToCents,
  todayLocalISO,
} from '../lib/format';
import { useFeedback } from './FeedbackContext';
import { Modal } from './Modal';
import { MoneyInput } from './MoneyInput';
import { PaymentMethodInline, PaymentMethodSelector } from './PaymentMethodIcon';

export interface SaleDetailData {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_cpf?: string | null;
  customer_address?: string | null;
  customer_notes?: string | null;
  sale_type: 'CASH' | 'FIADO' | 'INSTALLMENT';
  payment_method: string;
  discount_cents?: number;
  total_cents: number;
  profit_cents: number;
  paid_cents: number;
  status: 'COMPLETED' | 'CANCELLED';
  cancel_reason: string | null;
  sale_date: string;
  notes: string | null;
  items: Array<{
    id: number;
    product_id: number;
    product_name_snapshot: string;
    quantity: number;
    unit_cost_cents?: number;
    unit_price_cents: number;
    subtotal_cents: number;
  }>;
  debt?: {
    id: number;
    total_cents: number;
    paid_cents: number;
    remaining_cents: number;
    status: 'OPEN' | 'PAID' | 'CANCELLED';
    installments: Array<{
      id: number;
      installment_number: number;
      due_date: string;
      amount_cents: number;
      paid_cents: number;
      status: string;
    }>;
  } | null;
}

export function saleTypeLabel(t: string): string {
  if (t === 'CASH') return 'À vista';
  if (t === 'FIADO') return 'Fiado';
  return 'Parcelado';
}

export function SalePaymentBadges({
  saleType,
  paymentMethod,
  status,
  profitCents,
  discountCents,
  debtRemainingCents,
  installmentCount,
  installmentAmountCents,
  nextDueDate,
  firstDueDate,
}: {
  saleType: 'CASH' | 'FIADO' | 'INSTALLMENT';
  paymentMethod: string;
  status: 'COMPLETED' | 'CANCELLED';
  profitCents: number;
  discountCents?: number | null;
  debtRemainingCents: number | null;
  installmentCount?: number | null;
  installmentAmountCents?: number | null;
  nextDueDate?: string | null;
  firstDueDate?: string | null;
}) {
  const today = todayLocalISO();
  const hasInstallmentInfo =
    saleType === 'INSTALLMENT' && (installmentCount ?? 0) > 1 && (installmentAmountCents ?? 0) > 0;
  const dueToShow = (debtRemainingCents ?? 0) > 0 ? nextDueDate || firstDueDate : firstDueDate;
  const isOverdue = Boolean(
    status === 'COMPLETED' && (debtRemainingCents ?? 0) > 0 && nextDueDate && nextDueDate < today,
  );

  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 border border-stone-300 text-stone-800 text-xs font-extrabold">
          {hasInstallmentInfo ? (
            `${installmentCount}x de ${formatBRL(installmentAmountCents!)}`
          ) : (
            <>
              <span>{saleTypeLabel(saleType)}</span>
              {(saleType === 'CASH' || paymentMethod !== 'FIADO') && (
                <>
                  <span>•</span>
                  <PaymentMethodInline method={paymentMethod} iconClassName="w-3.5 h-3.5" />
                </>
              )}
            </>
          )}
        </span>
        {(discountCents ?? 0) > 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-red-100 border border-red-300 text-red-700 text-xs font-extrabold">
            Desconto -{formatBRL(discountCents!)}
          </span>
        )}
        {status === 'COMPLETED' ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-extrabold">
            <CheckCircle2 className="w-3.5 h-3.5" /> Lucro {formatBRL(profitCents)}
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-lg bg-red-100 border border-red-300 text-red-900 text-xs font-extrabold">
            Cancelada
          </span>
        )}
        {status === 'COMPLETED' && saleType !== 'CASH' && (debtRemainingCents ?? 0) === 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-extrabold">
            Quitado
          </span>
        )}
      </div>

      {status === 'COMPLETED' && (debtRemainingCents ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {dueToShow && (
            <span
              className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${
                isOverdue
                  ? 'bg-red-100 text-red-900 border border-red-300'
                  : 'bg-amber-100 text-amber-950 border border-amber-300'
              }`}
            >
              {isOverdue ? `Vencida (${formatDateBR(dueToShow)})` : `Vence ${formatDateBR(dueToShow)}`}
            </span>
          )}
          <span className="text-xs font-extrabold text-orange-800 bg-orange-100 border border-orange-300 px-2.5 py-1 rounded-lg">
            Falta: {formatBRL(debtRemainingCents!)}
          </span>
        </div>
      )}
    </div>
  );
}

function addDaysLocal(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function addMonthsLocal(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const targetM = m - 1 + months;
  const ny = y + Math.floor(targetM / 12);
  const nm = ((targetM % 12) + 12) % 12;
  const maxDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, maxDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

interface CatalogProduct {
  id: number;
  name: string;
  stock_qty: number;
  price_cents: number;
  cost_cents: number;
}

interface CatalogCustomer {
  id: number;
  name: string;
  phone: string | null;
  cpf: string | null;
}

interface EditableSaleItem {
  productId: number;
  name: string;
  quantity: number;
  origQuantity: number;
  unitPriceText: string;
  unitCostCents: number;
}

export function SaleDetailModal({
  sale,
  initialEdit = false,
  onClose,
  onCancelled,
}: {
  sale: SaleDetailData | null;
  initialEdit?: boolean;
  onClose: () => void;
  onCancelled: () => Promise<void> | void;
}) {
  const [overrideSale, setOverrideSale] = useState<SaleDetailData | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogCustomers, setCatalogCustomers] = useState<CatalogCustomer[]>([]);
  const [addProductId, setAddProductId] = useState<number | ''>('');

  const [editItems, setEditItems] = useState<EditableSaleItem[]>([]);
  const [editQtyDrafts, setEditQtyDrafts] = useState<Record<number, string>>({});
  const [editCustomerId, setEditCustomerId] = useState<number | ''>('');
  const [editSaleDate, setEditSaleDate] = useState(todayLocalISO());
  const [editSaleType, setEditSaleType] = useState<'CASH' | 'FIADO' | 'INSTALLMENT'>('CASH');
  const [editPaymentMethod, setEditPaymentMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [editDiscountText, setEditDiscountText] = useState('');
  const [editDownPaymentText, setEditDownPaymentText] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editInstallmentCount, setEditInstallmentCount] = useState(2);
  const [editFirstDueDate, setEditFirstDueDate] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const { showSuccess, showError, confirmAction } = useFeedback();

  const activeSale = overrideSale ?? sale;

  const initEditFromSale = useCallback(async (target: SaleDetailData) => {
    setEditing(true);
    setLoadingCatalog(true);
    try {
      const [prodRes, custRes] = await Promise.all([
        api<{ products: CatalogProduct[] }>('/products'),
        api<{ customers: CatalogCustomer[] }>('/customers'),
      ]);
      setCatalogProducts(prodRes.products);
      setCatalogCustomers(custRes.customers);
    } catch {
      // Even if catalog fetch fails, existing items remain editable
    } finally {
      setLoadingCatalog(false);
    }

    const groupedOrig = new Map<number, EditableSaleItem>();
    for (const item of target.items) {
      const prev = groupedOrig.get(item.product_id);
      if (prev) {
        prev.quantity += item.quantity;
        prev.origQuantity += item.quantity;
      } else {
        groupedOrig.set(item.product_id, {
          productId: item.product_id,
          name: item.product_name_snapshot,
          quantity: item.quantity,
          origQuantity: item.quantity,
          unitPriceText: centsToInputString(item.unit_price_cents),
          unitCostCents: item.unit_cost_cents ?? 0,
        });
      }
    }

    setEditItems(Array.from(groupedOrig.values()));
    setEditQtyDrafts({});
    setEditCustomerId(target.customer_id ?? '');
    setEditSaleDate(target.sale_date || todayLocalISO());
    setEditSaleType(target.sale_type);
    setEditPaymentMethod(
      target.payment_method === 'PIX' || target.payment_method === 'CARTAO'
        ? target.payment_method
        : 'DINHEIRO',
    );
    setEditDiscountText(
      (target.discount_cents ?? 0) > 0 ? centsToInputString(target.discount_cents!) : '',
    );
    setEditDownPaymentText(
      target.sale_type !== 'CASH' && target.paid_cents > 0
        ? centsToInputString(target.paid_cents)
        : '',
    );
    const firstDue =
      target.debt?.installments?.[0]?.due_date || addDaysLocal(target.sale_date, 30);
    setEditDueDate(firstDue);
    setEditInstallmentCount(Math.max(2, target.debt?.installments?.length || 2));
    setEditFirstDueDate(
      target.debt?.installments?.[0]?.due_date || addMonthsLocal(target.sale_date, 1),
    );
    setEditNotes(target.notes || '');
    setAddProductId('');
  }, []);

  useEffect(() => {
    setOverrideSale(null);
    if (sale && initialEdit && sale.status === 'COMPLETED') {
      void initEditFromSale(sale);
    } else {
      setEditing(false);
    }
  }, [sale, initialEdit, initEditFromSale]);

  const startEditing = async () => {
    if (!activeSale) return;
    await initEditFromSale(activeSale);
  };

  const stockInfoByProductId = useMemo(() => {
    const map = new Map<number, CatalogProduct>();
    for (const p of catalogProducts) map.set(p.id, p);
    return map;
  }, [catalogProducts]);

  const origQtyByProductId = useMemo(() => {
    const map = new Map<number, number>();
    if (!activeSale) return map;
    for (const i of activeSale.items) {
      map.set(i.product_id, (map.get(i.product_id) ?? 0) + i.quantity);
    }
    return map;
  }, [activeSale]);

  const maxEditableQty = (productId: number): number | null => {
    const cat = stockInfoByProductId.get(productId);
    if (!cat) return null;
    return cat.stock_qty + (origQtyByProductId.get(productId) ?? 0);
  };

  const updateEditItemQty = (productId: number, delta: number) => {
    setEditQtyDrafts((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setEditItems((prev) =>
      prev.map((item) => {
        if (item.productId !== productId) return item;
        const nextQty = item.quantity + delta;
        if (nextQty <= 0) return item;
        const maxQty = maxEditableQty(productId);
        if (maxQty !== null && nextQty > maxQty) {
          showError(`Estoque máximo disponível: ${maxQty} un.`);
          return item;
        }
        return { ...item, quantity: nextQty };
      }),
    );
  };

  const handleEditQtyChange = (productId: number, rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '');
    if (digits === '') {
      setEditQtyDrafts((prev) => ({ ...prev, [productId]: '' }));
      return;
    }
    const parsed = parseInt(digits, 10);
    if (parsed === 0) {
      setEditQtyDrafts((prev) => ({ ...prev, [productId]: '' }));
      return;
    }
    const maxQty = maxEditableQty(productId);
    const clamped = maxQty !== null && parsed > maxQty ? maxQty : parsed;
    if (maxQty !== null && parsed > maxQty) {
      showError(`Estoque máximo disponível: ${maxQty} un.`);
    }
    setEditQtyDrafts((prev) => ({ ...prev, [productId]: String(clamped) }));
    setEditItems((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, quantity: clamped } : item)),
    );
  };

  const handleEditQtyBlur = (productId: number) => {
    setEditQtyDrafts((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const removeEditItem = (productId: number) => {
    setEditItems((prev) => prev.filter((item) => item.productId !== productId));
  };

  const handleAddProductToSale = () => {
    if (!addProductId) return;
    const prod = stockInfoByProductId.get(Number(addProductId));
    if (!prod) return;
    const origQty = origQtyByProductId.get(prod.id) ?? 0;
    const maxQty = prod.stock_qty + origQty;
    const existing = editItems.find((i) => i.productId === prod.id);
    if (existing) {
      if (existing.quantity + 1 > maxQty) {
        showError(`Estoque insuficiente de "${prod.name}".`);
        return;
      }
      updateEditItemQty(prod.id, 1);
    } else {
      if (maxQty < 1) {
        showError(`"${prod.name}" está sem estoque disponível.`);
        return;
      }
      setEditItems((prev) => [
        ...prev,
        {
          productId: prod.id,
          name: prod.name,
          quantity: 1,
          origQuantity: origQty,
          unitPriceText: centsToInputString(prod.price_cents),
          unitCostCents: prod.cost_cents,
        },
      ]);
    }
    setAddProductId('');
  };

  const editItemsSubtotalCents = editItems.reduce(
    (sum, item) => sum + parseMoneyToCents(item.unitPriceText) * item.quantity,
    0,
  );
  const editDiscountCents = parseMoneyToCents(editDiscountText);
  const editTotalCents = Math.max(0, editItemsSubtotalCents - editDiscountCents);
  const editDownPaymentCents =
    editSaleType === 'CASH' ? 0 : parseMoneyToCents(editDownPaymentText);
  const editPaidNowCents = editSaleType === 'CASH' ? editTotalCents : editDownPaymentCents;
  const cashDeltaCents = activeSale ? editPaidNowCents - activeSale.paid_cents : 0;

  const returnedToStockList = useMemo(() => {
    if (!activeSale) return [];
    const currentQtyMap = new Map<number, number>();
    for (const item of editItems) currentQtyMap.set(item.productId, item.quantity);

    const groupedNames = new Map<number, string>();
    for (const item of activeSale.items) groupedNames.set(item.product_id, item.product_name_snapshot);

    const list: Array<{ productId: number; name: string; returnedQty: number }> = [];
    for (const [pid, origQty] of origQtyByProductId.entries()) {
      const curQty = currentQtyMap.get(pid) ?? 0;
      if (origQty > curQty) {
        list.push({
          productId: pid,
          name: groupedNames.get(pid) || `#${pid}`,
          returnedQty: origQty - curQty,
        });
      }
    }
    return list;
  }, [activeSale, editItems, origQtyByProductId]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSale) return;

    if (editItems.length === 0) {
      showError('A venda precisa ter pelo menos 1 produto (ou use Cancelar Venda para estornar tudo).');
      return;
    }

    for (const item of editItems) {
      const priceCents = parseMoneyToCents(item.unitPriceText);
      if (priceCents <= 0) {
        showError(`Informe um preço válido para "${item.name}".`);
        return;
      }
    }

    if (editDiscountCents >= editItemsSubtotalCents) {
      showError('O desconto não pode ser igual ou maior que o total dos produtos.');
      return;
    }

    if ((editSaleType === 'FIADO' || editSaleType === 'INSTALLMENT') && !editCustomerId) {
      showError('Selecione um cliente para venda fiada ou parcelada.');
      return;
    }

    if (editSaleType !== 'CASH' && editDownPaymentCents >= editTotalCents) {
      showError('A entrada é maior ou igual ao total. Altere a condição para "À vista".');
      return;
    }

    setSavingEdit(true);
    try {
      const payload = {
        customerId: editCustomerId ? Number(editCustomerId) : null,
        saleType: editSaleType,
        paymentMethod: editSaleType === 'CASH' ? editPaymentMethod : 'FIADO',
        items: editItems.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPriceCents: parseMoneyToCents(i.unitPriceText),
        })),
        discountCents: editDiscountCents,
        downPaymentCents: editSaleType !== 'CASH' ? editDownPaymentCents : undefined,
        downPaymentMethod:
          editSaleType !== 'CASH' && editDownPaymentCents > 0 ? editPaymentMethod : undefined,
        dueDate: editSaleType === 'FIADO' ? editDueDate : undefined,
        installmentCount: editSaleType === 'INSTALLMENT' ? editInstallmentCount : undefined,
        firstDueDate: editSaleType === 'INSTALLMENT' ? editFirstDueDate : undefined,
        saleDate: editSaleDate,
        notes: editNotes || null,
      };

      const res = await api<{ sale: SaleDetailData }>(`/sales/${activeSale.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setOverrideSale(res.sale);
      setEditing(false);
      showSuccess(`Venda #${activeSale.id} atualizada! Caixa e estoque ajustados.`);
      await onCancelled();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar alterações da venda.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelSale = async (saleId: number) => {
    const confirmed = await confirmAction({
      title: `Cancelar Venda #${saleId}?`,
      message: 'Isso devolve os produtos para o estoque e tira o valor do caixa, mantendo no histórico.',
      confirmLabel: 'Sim, cancelar',
      tone: 'warning',
    });
    if (!confirmed) return;
    setCancelling(true);
    try {
      await api(`/sales/${saleId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Cancelada pelo usuário' }),
      });
      showSuccess('Venda cancelada! Estoque e dinheiro foram acertados.');
      onClose();
      await onCancelled();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao cancelar venda.');
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteSale = async (saleId: number) => {
    const confirmed = await confirmAction({
      title: `Excluir Venda #${saleId}?`,
      message: 'Os produtos voltam para o estoque e o caixa será reajustado automaticamente.',
      confirmLabel: 'Sim, excluir',
      tone: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api(`/sales/${saleId}`, { method: 'DELETE' });
      showSuccess('Venda excluída! Estoque e caixa reajustados.');
      onClose();
      await onCancelled();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao excluir venda.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={Boolean(activeSale)}
      onClose={() => {
        setEditing(false);
        onClose();
      }}
      title={activeSale ? (editing ? `Editar Venda #${activeSale.id}` : `Venda #${activeSale.id}`) : ''}
    >
      {activeSale && editing && (
        <form onSubmit={handleSaveEdit} className="space-y-4">
          {/* Products Editor */}
          <div className="bg-white rounded-2xl border-2 border-stone-200 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase text-stone-500">
                Produtos da venda ({editItems.length})
              </span>
              {loadingCatalog && (
                <span className="text-xs font-bold text-stone-400">Carregando estoque...</span>
              )}
            </div>

            {editItems.length === 0 ? (
              <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-xs font-extrabold text-red-800 text-center">
                Nenhum produto restante. Adicione outro produto abaixo ou use &quot;Cancelar Venda&quot;.
              </div>
            ) : (
              <div className="space-y-2.5">
                {editItems.map((item) => {
                  const unitCents = parseMoneyToCents(item.unitPriceText);
                  const rowSubtotal = unitCents * item.quantity;
                  const maxQty = maxEditableQty(item.productId);
                  return (
                    <div
                      key={item.productId}
                      className="rounded-xl border-2 border-stone-200 bg-stone-50 p-3 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-extrabold text-stone-900 text-sm leading-snug">
                            {item.name}
                          </div>
                          {maxQty !== null && (
                            <div className="text-[11px] font-bold text-stone-500">
                              Disponível no estoque: {maxQty} un.
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeEditItem(item.productId)}
                          title="Excluir produto desta venda"
                          className="px-2.5 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 border border-red-300 text-red-800 text-xs font-extrabold inline-flex items-center gap-1 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                        <div>
                          <span className="block text-[11px] font-extrabold text-stone-600 mb-1">
                            Quantidade
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateEditItemQty(item.productId, -1)}
                              disabled={item.quantity <= 1}
                              className="w-10 h-10 rounded-xl bg-white hover:bg-stone-100 border-2 border-stone-300 flex items-center justify-center font-black disabled:opacity-40"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label={`Quantidade de ${item.name}`}
                              value={
                                editQtyDrafts[item.productId] !== undefined
                                  ? editQtyDrafts[item.productId]
                                  : String(item.quantity)
                              }
                              onFocus={(e) => {
                                setEditQtyDrafts((prev) => ({
                                  ...prev,
                                  [item.productId]: String(item.quantity),
                                }));
                                e.currentTarget.select();
                              }}
                              onChange={(e) => handleEditQtyChange(item.productId, e.target.value)}
                              onBlur={() => handleEditQtyBlur(item.productId)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                              className="w-12 h-10 text-center font-black text-base text-stone-900 bg-white rounded-xl border-2 border-stone-300 focus:border-[#0B4619] focus:outline-none tabular-nums"
                            />
                            <button
                              type="button"
                              onClick={() => updateEditItemQty(item.productId, 1)}
                              className="w-10 h-10 rounded-xl bg-white hover:bg-stone-100 border-2 border-stone-300 flex items-center justify-center font-black"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <MoneyInput
                          label="Valor unitário"
                          value={item.unitPriceText}
                          onChange={(val) =>
                            setEditItems((prev) =>
                              prev.map((row) =>
                                row.productId === item.productId
                                  ? { ...row, unitPriceText: val }
                                  : row,
                              ),
                            )
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs font-extrabold pt-1 border-t border-stone-200">
                        <span className="text-stone-500">Subtotal do item</span>
                        <span className="text-stone-900 text-sm">{formatBRL(rowSubtotal)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add another product */}
            {catalogProducts.length > 0 && (
              <div className="pt-2 border-t border-stone-200 space-y-1.5">
                <label className="block text-xs font-extrabold text-stone-600">
                  Adicionar outro produto à venda
                </label>
                <div className="flex gap-2">
                  <select
                    value={addProductId}
                    onChange={(e) => setAddProductId(e.target.value ? Number(e.target.value) : '')}
                    className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
                  >
                    <option value="">Escolher produto...</option>
                    {catalogProducts.map((p) => {
                      const avail = p.stock_qty + (origQtyByProductId.get(p.id) ?? 0);
                      return (
                        <option key={p.id} value={p.id} disabled={avail <= 0}>
                          {p.name} — {formatBRL(p.price_cents)} ({avail} est.)
                        </option>
                      );
                    })}
                  </select>
                  <button
                    type="button"
                    disabled={!addProductId}
                    onClick={handleAddProductToSale}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 border-2 border-emerald-300 text-emerald-950 font-extrabold text-xs inline-flex items-center gap-1 shrink-0 disabled:opacity-40"
                  >
                    <PackagePlus className="w-4 h-4" /> Adicionar
                  </button>
                </div>
              </div>
            )}

            {returnedToStockList.length > 0 && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-300 text-xs font-extrabold text-amber-950">
                Vai voltar para o estoque ao salvar:{' '}
                {returnedToStockList.map((r) => `+${r.returnedQty}x ${r.name}`).join(', ')}
              </div>
            )}
          </div>

          {/* Discount & Totals */}
          <div className="bg-white rounded-2xl border-2 border-stone-200 p-3.5 space-y-3">
            <MoneyInput
              label="Desconto na venda (opcional)"
              value={editDiscountText}
              onChange={setEditDiscountText}
              placeholder="0,00"
            />
            <div className="space-y-1 text-sm pt-1 border-t border-stone-200">
              <div className="flex justify-between font-bold text-stone-600">
                <span>Subtotal dos produtos</span>
                <span>{formatBRL(editItemsSubtotalCents)}</span>
              </div>
              {editDiscountCents > 0 && (
                <div className="flex justify-between font-extrabold text-red-600">
                  <span>Desconto</span>
                  <span>- {formatBRL(editDiscountCents)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-black pt-0.5">
                <span>Novo total da venda</span>
                <span className="text-[#0B4619]">{formatBRL(editTotalCents)}</span>
              </div>
            </div>
          </div>

          {/* Customer, Date & Payment */}
          <div className="bg-white rounded-2xl border-2 border-stone-200 p-3.5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-extrabold text-stone-700 mb-1">Cliente</label>
                <select
                  value={editCustomerId}
                  onChange={(e) => setEditCustomerId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
                >
                  <option value="">Sem nome (venda rápida)</option>
                  {catalogCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.cpf ? ` (${c.cpf})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-extrabold text-stone-700 mb-1">
                  Data da venda
                </label>
                <input
                  type="date"
                  value={editSaleDate}
                  onChange={(e) => setEditSaleDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-extrabold text-stone-700 mb-1.5">
                Condição de pagamento
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { key: 'CASH', label: 'À Vista' },
                    { key: 'FIADO', label: 'Fiado' },
                    { key: 'INSTALLMENT', label: 'Parcelado' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setEditSaleType(t.key)}
                    className={`py-2.5 rounded-xl text-xs font-extrabold border-2 ${
                      editSaleType === t.key
                        ? 'bg-[#0B4619] text-white border-[#073311]'
                        : 'bg-stone-50 text-stone-800 border-stone-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {editSaleType !== 'CASH' && (
              <div className="space-y-2.5 pt-1">
                <MoneyInput
                  label="Entrada recebida na hora (opcional)"
                  value={editDownPaymentText}
                  onChange={setEditDownPaymentText}
                />
                {editSaleType === 'FIADO' ? (
                  <div>
                    <label className="block text-xs font-extrabold text-stone-700 mb-1">
                      Vencimento do fiado
                    </label>
                    <input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-extrabold text-stone-700 mb-1">
                        Parcelas
                      </label>
                      <select
                        value={editInstallmentCount}
                        onChange={(e) => setEditInstallmentCount(Number(e.target.value))}
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
                      >
                        {Array.from({ length: 12 }, (_, idx) => idx + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}x
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-extrabold text-stone-700 mb-1">
                        1º vencimento
                      </label>
                      <input
                        type="date"
                        value={editFirstDueDate}
                        onChange={(e) => setEditFirstDueDate(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {(editSaleType === 'CASH' || editDownPaymentCents > 0) && (
              <div>
                <label className="block text-xs font-extrabold text-stone-700 mb-1.5">
                  Forma de pagamento no caixa
                </label>
                <PaymentMethodSelector value={editPaymentMethod} onChange={setEditPaymentMethod} />
              </div>
            )}

            <div>
              <label className="block text-xs font-extrabold text-stone-700 mb-1">
                Observação (opcional)
              </label>
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Ex: Entregar na feira"
                className="w-full px-3 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-sm font-bold"
              />
            </div>
          </div>

          {/* Cash Impact Box */}
          <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-3.5 text-xs font-extrabold text-emerald-950 space-y-1">
            <div className="flex justify-between">
              <span>Valor atualizado no Caixa:</span>
              <span className="text-sm font-black">{formatBRL(editPaidNowCents)}</span>
            </div>
            {cashDeltaCents !== 0 && (
              <div className="flex justify-between text-stone-700">
                <span>Diferença no caixa em relação ao anterior:</span>
                <span className={cashDeltaCents > 0 ? 'text-emerald-800' : 'text-red-700'}>
                  {cashDeltaCents > 0 ? `+ ${formatBRL(cashDeltaCents)}` : `- ${formatBRL(Math.abs(cashDeltaCents))}`}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={savingEdit}
              className="py-3.5 px-4 rounded-2xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 text-stone-800 font-extrabold text-base"
            >
              Cancelar edição
            </button>
            <button
              type="submit"
              disabled={savingEdit || editItems.length === 0}
              className="py-3.5 px-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] border-2 border-[#073311] text-white font-black text-base flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
            >
              <Check className="w-5 h-5" />
              {savingEdit ? 'SALVANDO...' : 'SALVAR E APLICAR'}
            </button>
          </div>
        </form>
      )}

      {activeSale && !editing && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2.5">
            <div className="flex justify-between items-center text-sm font-bold text-stone-600">
              <span>Data: {formatDateBR(activeSale.sale_date)}</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-stone-100 border border-stone-300 text-stone-800 font-extrabold">
                <span>{saleTypeLabel(activeSale.sale_type)}</span>
                {activeSale.sale_type === 'CASH' && (
                  <>
                    <span>•</span>
                    <PaymentMethodInline method={activeSale.payment_method} iconClassName="w-3.5 h-3.5" />
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-extrabold text-stone-900">
                Cliente: {activeSale.customer_name || 'Sem nome'}
              </div>
              {activeSale.customer_id && (
                <Link
                  to={`/clientes/${activeSale.customer_id}`}
                  onClick={onClose}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#0B4619] border border-emerald-200 text-xs font-extrabold shrink-0"
                >
                  <User className="w-3.5 h-3.5" /> Abrir cliente
                </Link>
              )}
            </div>

            {(activeSale.customer_phone || activeSale.customer_address || activeSale.customer_notes) && (
              <div className="text-xs font-semibold text-stone-600 space-y-0.5">
                {activeSale.customer_phone && <div>Tel: {activeSale.customer_phone}</div>}
                {activeSale.customer_address && <div>Endereço: {activeSale.customer_address}</div>}
                {activeSale.customer_notes && <div>Detalhamento: {activeSale.customer_notes}</div>}
              </div>
            )}

            <div className="border-t border-stone-100 pt-2.5 space-y-1.5">
              <div className="text-xs font-extrabold uppercase text-stone-400">
                Produtos vendidos
              </div>
              {activeSale.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-2 text-sm font-bold">
                  <span>
                    {item.quantity}x {item.product_name_snapshot}{' '}
                    <span className="text-xs text-stone-500">
                      ({formatBRL(item.unit_price_cents)} cada)
                    </span>
                  </span>
                  <span className="shrink-0">{formatBRL(item.subtotal_cents)}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-stone-200 pt-2 space-y-1">
              {(activeSale.discount_cents ?? 0) > 0 && (
                <>
                  <div className="flex justify-between text-sm font-bold text-stone-600">
                    <span>Subtotal dos produtos</span>
                    <span>{formatBRL(activeSale.total_cents + activeSale.discount_cents!)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-extrabold text-red-600">
                    <span>Desconto aplicado</span>
                    <span>- {formatBRL(activeSale.discount_cents!)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-lg font-black">
                <span>Total da venda</span>
                <span className="text-[#0B4619]">{formatBRL(activeSale.total_cents)}</span>
              </div>
              {activeSale.paid_cents > 0 && activeSale.sale_type !== 'CASH' && (
                <div className="flex justify-between text-sm font-bold text-stone-700">
                  <span className="inline-flex items-center gap-1">
                    <span>Entrada na hora •</span>
                    <PaymentMethodInline method={activeSale.payment_method} iconClassName="w-3.5 h-3.5" />
                  </span>
                  <span>{formatBRL(activeSale.paid_cents)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-emerald-800">
                <span>Lucro bruto</span>
                <span>{formatBRL(activeSale.profit_cents)}</span>
              </div>
            </div>

            {activeSale.notes && (
              <div className="text-xs font-semibold text-stone-600 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
                Obs: {activeSale.notes}
              </div>
            )}
          </div>

          {activeSale.debt && (
            <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold text-stone-800">
                  {activeSale.debt.installments.length > 1
                    ? `Parcelamento (${activeSale.debt.installments.length}x de ${formatBRL(
                        activeSale.debt.installments[0].amount_cents,
                      )})`
                    : 'Vencimento do Fiado'}
                </span>
                {activeSale.debt.status === 'PAID' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-extrabold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Quitado
                  </span>
                ) : activeSale.debt.status === 'CANCELLED' ? (
                  <span className="px-2.5 py-0.5 rounded-lg bg-red-100 border border-red-300 text-red-900 text-xs font-extrabold">
                    Cancelado
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-lg bg-orange-100 border border-orange-300 text-orange-900 text-xs font-extrabold">
                    Falta {formatBRL(activeSale.debt.remaining_cents)}
                  </span>
                )}
              </div>

              <div className="text-xs font-bold text-stone-600">
                Total já pago: {formatBRL(activeSale.paid_cents + activeSale.debt.paid_cents)} de {formatBRL(activeSale.total_cents)}
              </div>

              {activeSale.debt.installments.length > 0 && (
                <div className="space-y-1 pt-1">
                  {activeSale.debt.installments.map((inst) => (
                    <div
                      key={inst.id}
                      className="flex items-center justify-between text-xs font-bold px-2.5 py-1.5 rounded-lg bg-stone-50 border border-stone-200"
                    >
                      <span>
                        {activeSale.debt!.installments.length > 1 ? `${inst.installment_number}ª parcela • ` : ''}
                        Vence {formatDateBR(inst.due_date)}
                      </span>
                      <span
                        className={
                          inst.status === 'PAID'
                            ? 'text-emerald-700'
                            : inst.status === 'CANCELLED'
                              ? 'text-stone-400'
                              : 'text-orange-800'
                        }
                      >
                        {inst.status === 'PAID'
                          ? `Pago (${formatBRL(inst.amount_cents)})`
                          : formatBRL(inst.amount_cents - inst.paid_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {activeSale.status === 'COMPLETED' && activeSale.debt.remaining_cents > 0 && activeSale.customer_id && (
                <Link
                  to={`/clientes/${activeSale.customer_id}`}
                  onClick={onClose}
                  className="block w-full text-center py-2.5 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-950 font-extrabold text-sm border border-orange-300"
                >
                  Receber pagamento deste fiado →
                </Link>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              void downloadSaleReceiptPdf(activeSale).catch(() =>
                showError('Não foi possível gerar o PDF do comprovante.'),
              );
            }}
            className="w-full py-3.5 rounded-2xl bg-emerald-800 hover:bg-emerald-900 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.98]"
          >
            <Download className="w-4 h-4" /> Baixar Comprovante em PDF
          </button>

          {activeSale.status === 'COMPLETED' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={startEditing}
                  className="py-3.5 px-4 rounded-2xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-extrabold text-base flex items-center justify-center gap-2 border border-amber-300"
                >
                  <Edit3 className="w-5 h-5" /> Editar Venda
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => handleDeleteSale(activeSale.id)}
                  className="py-3.5 px-4 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-extrabold text-base flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-5 h-5" /> {deleting ? 'Excluindo...' : 'Excluir Venda'}
                </button>
              </div>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => handleCancelSale(activeSale.id)}
                className="w-full py-2.5 px-4 rounded-xl bg-red-50 hover:bg-red-100 text-red-900 font-bold text-sm flex items-center justify-center gap-1.5 border border-red-200"
              >
                <RotateCcw className="w-4 h-4" /> Cancelar Venda (manter no histórico)
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-900 font-bold text-sm text-center">
                Esta venda foi cancelada em {formatDateBR(activeSale.sale_date)}.
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => handleDeleteSale(activeSale.id)}
                className="w-full py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> {deleting ? 'Excluindo...' : 'Excluir Venda do Histórico'}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
