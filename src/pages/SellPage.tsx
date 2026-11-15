import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  ClipboardList,
  Download,
  Minus,
  Package,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api, getCachedApi, preloadImageUrls } from '../lib/api';
import { downloadSaleReceiptPdf } from '../lib/pdfReceipt';
import { matchesFlexibleSearch } from '../lib/search';
import {
  centsToInputString,
  formatBRL,
  formatCpfInput,
  formatDateBR,
  formatMoneyMask,
  formatPhoneInput,
  newIdempotencyKey,
  parseMoneyToCents,
  todayLocalISO,
} from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import {
  PaymentMethodInline,
  PaymentMethodSelector,
} from '../components/PaymentMethodIcon';
import type { Product } from './ProductsPage';

interface CustomerOption {
  id: number;
  name: string;
  phone: string | null;
  cpf: string | null;
  address?: string | null;
  notes?: string | null;
  total_debt_cents: number;
}

interface CartItem {
  product: Product;
  quantity: number;
  unitPriceCents: number;
}

function addDaysISO(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function addMonthISO(baseIso: string, months: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const targetM = m - 1 + months;
  const targetY = y + Math.floor(targetM / 12);
  const modM = ((targetM % 12) + 12) % 12;
  const maxD = new Date(Date.UTC(targetY, modM + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetY, modM, Math.min(d, maxD))).toISOString().slice(0, 10);
}

function buildInstallmentDates(firstDate: string, count: number): string[] {
  return Array.from({ length: count }, (_, idx) => addMonthISO(firstDate, idx));
}

export function SellPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const correctSaleId = searchParams.get('correctSaleId')
    ? Number(searchParams.get('correctSaleId'))
    : null;

  const [products, setProducts] = useState<Product[]>(
    () => getCachedApi<{ products: Product[] }>('/products')?.products ?? [],
  );
  const [customers, setCustomers] = useState<CustomerOption[]>(
    () => getCachedApi<{ customers: CustomerOption[] }>('/customers')?.customers ?? [],
  );
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(
    () =>
      !(!correctSaleId && getCachedApi('/products') && getCachedApi('/customers')),
  );

  // Checkout modal
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [saleType, setSaleType] = useState<'CASH' | 'FIADO' | 'INSTALLMENT'>('CASH');
  const [paymentMethod, setPaymentMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [discountText, setDiscountText] = useState('');
  const [downPaymentText, setDownPaymentText] = useState('');
  const [dueDate, setDueDate] = useState(() => addDaysISO(todayLocalISO(), 30));
  const [installmentCount, setInstallmentCount] = useState(2);
  const [firstDueDate, setFirstDueDate] = useState(() => addMonthISO(todayLocalISO(), 1));
  const [installmentDates, setInstallmentDates] = useState<string[]>(() =>
    buildInstallmentDates(addMonthISO(todayLocalISO(), 1), 2),
  );
  const [notes, setNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);

  // Quick New Customer modal
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustCpf, setNewCustCpf] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustNotes, setNewCustNotes] = useState('');

  // Price edit modal
  const [editingCartProdId, setEditingCartProdId] = useState<number | null>(null);
  const [editPriceText, setEditPriceText] = useState('');

  // Completed banner
  interface CompletedSaleReceipt {
    id: number;
    customer_id?: number | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_cpf?: string | null;
    customer_address?: string | null;
    customer_notes?: string | null;
    discount_cents?: number;
    total_cents: number;
    sale_type: string;
    payment_method: string;
    paid_cents: number;
    sale_date?: string;
    notes?: string | null;
    items?: Array<{
      id: number;
      product_name_snapshot: string;
      quantity: number;
      unit_price_cents: number;
      subtotal_cents: number;
    }>;
    debt?: {
      remaining_cents: number;
      installments: Array<{
        id: number;
        installment_number: number;
        due_date: string;
        amount_cents: number;
      }>;
    } | null;
  }
  const [completedSale, setCompletedSale] = useState<CompletedSaleReceipt | null>(null);

  const updateInstallmentsPlan = (nextCount: number, nextFirstDate: string) => {
    const safeCount = Math.max(2, Math.min(24, nextCount));
    setInstallmentCount(safeCount);
    setFirstDueDate(nextFirstDate);
    setInstallmentDates(buildInstallmentDates(nextFirstDate, safeCount));
  };

  const { showSuccess, showError } = useFeedback();

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [prodRes, custRes] = await Promise.all([
          api<{ products: Product[] }>('/products'),
          api<{ customers: CustomerOption[] }>('/customers'),
        ]);
        setProducts(prodRes.products);
        setCustomers(custRes.customers);
        preloadImageUrls(prodRes.products.map((p) => p.photo_url));

      if (correctSaleId) {
        const saleRes = await api<{
          sale: {
            id: number;
            customer_id: number | null;
            sale_type: 'CASH' | 'FIADO' | 'INSTALLMENT';
            payment_method: 'DINHEIRO' | 'PIX' | 'CARTAO' | 'FIADO';
            discount_cents?: number;
            paid_cents: number;
            notes: string | null;
            items: Array<{
              product_id: number;
              quantity: number;
              unit_price_cents: number;
            }>;
            debt?: {
              installments: Array<{
                installment_number: number;
                due_date: string;
                amount_cents: number;
              }>;
            } | null;
          };
        }>(`/sales/${correctSaleId}`);

        const s = saleRes.sale;
        const nextCart: CartItem[] = [];
        for (const item of s.items) {
          const p = prodRes.products.find((pr) => pr.id === item.product_id);
          if (p) {
            nextCart.push({
              product: { ...p, stock_qty: p.stock_qty + item.quantity },
              quantity: item.quantity,
              unitPriceCents: item.unit_price_cents,
            });
          }
        }
        setProducts(
          prodRes.products.map((p) => {
            const orig = s.items.find((i) => i.product_id === p.id);
            return orig ? { ...p, stock_qty: p.stock_qty + orig.quantity } : p;
          }),
        );
        setCart(nextCart);
        setSaleType(s.sale_type);
        if (s.payment_method !== 'FIADO') setPaymentMethod(s.payment_method);
        setCustomerId(s.customer_id || '');
        if ((s.discount_cents ?? 0) > 0) {
          setDiscountText(centsToInputString(s.discount_cents!));
        }
        if (s.sale_type !== 'CASH' && s.paid_cents > 0) {
          setDownPaymentText(centsToInputString(s.paid_cents));
        }
        if (s.debt && s.debt.installments.length > 0) {
          if (s.sale_type === 'FIADO') {
            setDueDate(s.debt.installments[0].due_date);
          } else if (s.sale_type === 'INSTALLMENT') {
            const cnt = Math.max(2, s.debt.installments.length);
            setInstallmentCount(cnt);
            setFirstDueDate(s.debt.installments[0].due_date);
            setInstallmentDates(s.debt.installments.map((inst) => inst.due_date));
          }
        }
        setNotes(s.notes || '');
      }
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao carregar dados de venda.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [correctSaleId, showError],
  );

  useEffect(() => {
    const cachedProds = getCachedApi<{ products: Product[] }>('/products');
    const cachedCusts = getCachedApi<{ customers: CustomerOption[] }>('/customers');
    if (cachedProds && !correctSaleId) {
      setProducts(cachedProds.products);
      preloadImageUrls(cachedProds.products.map((p) => p.photo_url));
    }
    if (cachedCusts && !correctSaleId) {
      setCustomers(cachedCusts.customers);
    }
    loadData(Boolean(!correctSaleId && cachedProds && cachedCusts));
  }, [loadData, correctSaleId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      return matchesFlexibleSearch(search, [p.name, p.category]);
    });
  }, [products, selectedCategory, search]);

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) =>
      matchesFlexibleSearch(
        customerSearch,
        [c.name, c.phone, c.cpf, c.address, c.notes],
        [c.phone, c.cpf],
      ),
    );
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId],
  );

  const subtotalCents = useMemo(
    () => cart.reduce((acc, item) => acc + item.unitPriceCents * item.quantity, 0),
    [cart],
  );
  const discountCents = parseMoneyToCents(discountText);
  const discountTooHigh = subtotalCents > 0 && discountCents >= subtotalCents;
  const totalCents = Math.max(0, subtotalCents - discountCents);
  const totalQty = useMemo(() => cart.reduce((acc, item) => acc + item.quantity, 0), [cart]);

  const addToCart = (product: Product) => {
    if (product.stock_qty <= 0) {
      showError(`"${product.name}" está zerado no estoque!`);
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id);
      if (idx >= 0) {
        const cur = prev[idx];
        if (cur.quantity >= product.stock_qty) {
          showError(`Só tem ${product.stock_qty} de "${product.name}" no estoque.`);
          return prev;
        }
        return prev.map((item, i) => (i === idx ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { product, quantity: 1, unitPriceCents: product.price_cents }];
    });
  };

  const changeQty = (productId: number, delta: number) => {
    setQtyDrafts((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const nextQty = item.quantity + delta;
          if (nextQty > item.product.stock_qty) {
            showError(`Só tem ${item.product.stock_qty} no estoque.`);
            return item;
          }
          return { ...item, quantity: nextQty };
        })
        .filter((item) => item.quantity > 0),
    );
  };

  const handleQtyInputChange = (product: Product, rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '');
    if (digits === '') {
      setQtyDrafts((prev) => ({ ...prev, [product.id]: '' }));
      return;
    }

    const parsed = parseInt(digits, 10);
    if (parsed === 0) {
      setQtyDrafts((prev) => ({ ...prev, [product.id]: '0' }));
      return;
    }

    const clamped = parsed > product.stock_qty ? product.stock_qty : parsed;
    if (parsed > product.stock_qty) {
      showError(`Só tem ${product.stock_qty} de "${product.name}" no estoque.`);
    }

    setQtyDrafts((prev) => ({ ...prev, [product.id]: String(clamped) }));
    setCart((prev) =>
      prev.map((item) => (item.product.id === product.id ? { ...item, quantity: clamped } : item)),
    );
  };

  const handleQtyInputBlur = (productId: number) => {
    const draft = qtyDrafts[productId];
    if (draft === '0') {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
    }
    setQtyDrafts((prev) => {
      if (!(productId in prev)) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const openCheckout = () => {
    if (cart.length === 0) {
      showError('Escolha pelo menos 1 produto primeiro.');
      return;
    }
    setIdempotencyKey(newIdempotencyKey());
    setCheckoutOpen(true);
  };

  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    try {
      const res = await api<{ customer: CustomerOption }>('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: newCustName,
          phone: newCustPhone || null,
          cpf: newCustCpf || null,
          address: newCustAddress || null,
          notes: newCustNotes || null,
        }),
      });
      setCustomers((prev) => [{ ...res.customer, total_debt_cents: 0 }, ...prev]);
      setCustomerId(res.customer.id);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustCpf('');
      setNewCustAddress('');
      setNewCustNotes('');
      setNewCustOpen(false);
      showSuccess('Cliente cadastrado!');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    }
  };

  const downCentsPreview = saleType === 'CASH' ? 0 : parseMoneyToCents(downPaymentText);
  const remainingDebtPreview = Math.max(0, totalCents - downCentsPreview);
  const installmentValuePreview =
    installmentCount > 0 ? Math.floor(remainingDebtPreview / installmentCount) : 0;

  const installmentSchedule = useMemo(() => {
    if (remainingDebtPreview <= 0 || installmentCount < 1) return [];
    const baseAmount = Math.floor(remainingDebtPreview / installmentCount);
    const remainder = remainingDebtPreview - baseAmount * installmentCount;
    return Array.from({ length: installmentCount }, (_, i) => ({
      number: i + 1,
      dueDate: installmentDates[i] || addMonthISO(firstDueDate, i),
      amountCents: i === 0 ? baseAmount + remainder : baseAmount,
    }));
  }, [remainingDebtPreview, installmentCount, installmentDates, firstDueDate]);

  const handleFinishSale = async () => {
    if ((saleType === 'FIADO' || saleType === 'INSTALLMENT') && !customerId) {
      showError('Escolha o cliente para vender fiado ou parcelado.');
      return;
    }

    if (discountTooHigh) {
      showError('O desconto não pode ser igual ou maior que o valor dos produtos.');
      return;
    }

    const downPaymentCents = saleType === 'CASH' ? 0 : parseMoneyToCents(downPaymentText);

    if (saleType !== 'CASH' && downPaymentCents >= totalCents) {
      showError('A entrada é igual ao total. Escolha "À Vista"!');
      return;
    }

    const canSendCustomInstallments =
      saleType === 'INSTALLMENT' &&
      installmentSchedule.length === installmentCount &&
      installmentSchedule.every((inst) => inst.amountCents > 0 && Boolean(inst.dueDate));

    setSubmitting(true);
    try {
      const payload = {
        customerId: customerId || null,
        saleType,
        paymentMethod:
          saleType === 'CASH' ? paymentMethod : downPaymentCents > 0 ? paymentMethod : 'FIADO',
        items: cart.map((c) => ({
          productId: c.product.id,
          quantity: c.quantity,
          unitPriceCents: c.unitPriceCents,
        })),
        discountCents,
        downPaymentCents,
        downPaymentMethod: paymentMethod,
        dueDate: saleType === 'FIADO' ? dueDate : undefined,
        installmentCount: saleType === 'INSTALLMENT' ? installmentCount : undefined,
        firstDueDate: saleType === 'INSTALLMENT' ? firstDueDate : undefined,
        installments: canSendCustomInstallments
          ? installmentSchedule.map((inst) => ({
              dueDate: inst.dueDate,
              amountCents: inst.amountCents,
            }))
          : undefined,
        notes: notes || null,
        idempotencyKey,
      };

      const url = correctSaleId ? `/sales/${correctSaleId}` : '/sales';
      const res = await api<{ sale: CompletedSaleReceipt }>(url, {
        method: correctSaleId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });

      setCheckoutOpen(false);
      setCart([]);
      setQtyDrafts({});
      setDiscountText('');
      setDownPaymentText('');
      setNotes('');
      setCompletedSale(res.sale);
      showSuccess(
        correctSaleId
          ? `Venda corrigida! ${formatBRL(res.sale.total_cents)}`
          : `Venda anotada! ${formatBRL(res.sale.total_cents)}`,
      );
      if (correctSaleId) {
        navigate('/vendas', { replace: true });
      } else {
        await loadData();
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao fechar venda.');
    } finally {
      setSubmitting(false);
    }
  };

  if (completedSale) {
    const insts = completedSale.debt?.installments || [];
    const hasDiscount = (completedSale.discount_cents ?? 0) > 0;
    const subtotalCompletedCents =
      completedSale.total_cents + (completedSale.discount_cents ?? 0);
    const receiptItems = completedSale.items || [];
    const saleTypeName =
      completedSale.sale_type === 'CASH'
        ? 'À vista'
        : completedSale.sale_type === 'FIADO'
          ? 'Fiado'
          : 'Parcelado';

    return (
      <div className="bg-white rounded-3xl border-2 border-emerald-300 p-5 sm:p-6 space-y-4 shadow-md mt-3">
        {/* Store Logo & Confirmation Header */}
        <div className="text-center space-y-2 pb-3 border-b border-stone-200">
          <img
            src="/logo.png"
            alt="Cris Parambu"
            className="h-14 w-auto object-contain mx-auto"
          />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 font-black text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>
              Venda Anotada! • #{completedSale.id}
              {completedSale.sale_date ? ` • ${formatDateBR(completedSale.sale_date)}` : ''}
            </span>
          </div>
          <p className="text-3xl font-black text-[#0B4619]">
            {formatBRL(completedSale.total_cents)}
          </p>
        </div>

        {/* Detailed Sale Specification */}
        <div className="bg-stone-50 rounded-2xl border border-stone-200 p-4 space-y-3 text-left">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-bold text-stone-500">Cliente:</span>
            <span className="font-extrabold text-stone-900 text-right">
              {completedSale.customer_name || 'Sem nome (venda rápida)'}
              {completedSale.customer_phone ? ` • ${completedSale.customer_phone}` : ''}
            </span>
          </div>

          {completedSale.customer_address && (
            <div className="flex items-start justify-between gap-2 text-xs">
              <span className="font-bold text-stone-500 shrink-0">Endereço:</span>
              <span className="font-bold text-stone-700 text-right">{completedSale.customer_address}</span>
            </div>
          )}

          {completedSale.customer_notes && (
            <div className="flex items-start justify-between gap-2 text-xs">
              <span className="font-bold text-stone-500 shrink-0">Detalhamento:</span>
              <span className="font-bold text-stone-700 text-right">{completedSale.customer_notes}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-bold text-stone-500">Condição:</span>
            <span className="inline-flex items-center gap-1.5 font-extrabold text-stone-900">
              <span>{saleTypeName}</span>
              {(completedSale.sale_type === 'CASH' || completedSale.payment_method !== 'FIADO') && (
                <>
                  <span>•</span>
                  <PaymentMethodInline method={completedSale.payment_method} iconClassName="w-4 h-4" />
                </>
              )}
            </span>
          </div>

          {receiptItems.length > 0 && (
            <div className="border-t border-stone-200 pt-2.5 space-y-1.5">
              <div className="text-xs font-extrabold uppercase text-stone-400">
                Produtos vendidos
              </div>
              {receiptItems.map((item) => (
                <div key={item.id} className="flex justify-between gap-2 text-sm font-bold text-stone-800">
                  <span>
                    {item.quantity}x {item.product_name_snapshot}{' '}
                    <span className="text-xs text-stone-500">
                      ({formatBRL(item.unit_price_cents)} un.)
                    </span>
                  </span>
                  <span className="shrink-0 font-extrabold">
                    {formatBRL(item.subtotal_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-stone-200 pt-2.5 space-y-1">
            {hasDiscount && (
              <>
                <div className="flex justify-between text-sm font-bold text-stone-600">
                  <span>Subtotal dos produtos</span>
                  <span>{formatBRL(subtotalCompletedCents)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-red-600">
                  <span>Desconto aplicado</span>
                  <span>- {formatBRL(completedSale.discount_cents!)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-base font-black text-stone-900">
              <span>Total da venda</span>
              <span className="text-[#0B4619]">{formatBRL(completedSale.total_cents)}</span>
            </div>
            {completedSale.sale_type === 'CASH' ? (
              <div className="flex justify-between text-xs font-extrabold text-emerald-800">
                <span>Pago na hora</span>
                <span>{formatBRL(completedSale.paid_cents)} • Estoque atualizado</span>
              </div>
            ) : (
              <>
                {completedSale.paid_cents > 0 && (
                  <div className="flex justify-between text-xs font-extrabold text-emerald-800">
                    <span>Entrada paga na hora</span>
                    <span>{formatBRL(completedSale.paid_cents)}</span>
                  </div>
                )}
                {completedSale.debt && (
                  <div className="flex justify-between text-xs font-extrabold text-orange-800">
                    <span>Restante a pagar</span>
                    <span>{formatBRL(completedSale.debt.remaining_cents)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {insts.length > 0 && (
            <div className="border-t border-stone-200 pt-2.5 space-y-1">
              <div className="text-xs font-extrabold uppercase text-stone-400">
                {insts.length > 1 ? `Parcelas (${insts.length}x)` : 'Vencimento do Fiado'}
              </div>
              {insts.map((inst) => (
                <div key={inst.id} className="flex justify-between text-xs font-bold text-stone-800">
                  <span>
                    {insts.length > 1 ? `${inst.installment_number}ª parcela` : 'Vencimento'} •{' '}
                    {formatDateBR(inst.due_date)}
                  </span>
                  <span className="font-black text-[#0B4619]">{formatBRL(inst.amount_cents)}</span>
                </div>
              ))}
            </div>
          )}

          {completedSale.notes && (
            <div className="text-xs font-semibold text-stone-600 bg-white rounded-xl px-3 py-2 border border-stone-200">
              Obs: {completedSale.notes}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="space-y-2.5 pt-1">
          <button
            type="button"
            onClick={async () => {
              try {
                await downloadSaleReceiptPdf(completedSale);
                showSuccess('Comprovante em PDF baixado!');
              } catch {
                showError('Erro ao gerar o PDF do comprovante.');
              }
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-[#0B4619] border-2 border-[#0B4619] font-extrabold text-base flex items-center justify-center gap-2 shadow-xs"
          >
            <Download className="w-5 h-5" />
            BAIXAR COMPROVANTE EM PDF
          </button>
          {completedSale.sale_type !== 'CASH' && completedSale.customer_id ? (
            <>
              <Link
                to={`/clientes/${completedSale.customer_id}`}
                className="w-full py-3.5 px-4 rounded-2xl bg-[#EA580C] hover:bg-[#D94E06] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-sm"
              >
                <Wallet className="w-5 h-5" />
                IR PARA PAGAMENTO / FATURA DO CLIENTE
              </Link>
              <Link
                to={`/vendas?venda=${completedSale.id}`}
                className="w-full py-3.5 px-4 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-950 border-2 border-amber-300 font-extrabold text-sm flex items-center justify-center gap-2"
              >
                <ReceiptText className="w-4 h-4" />
                Abrir Comprovante / Fatura #{completedSale.id}
              </Link>
            </>
          ) : (
            <Link
              to={`/dinheiro?venda=${completedSale.id}`}
              className="w-full py-3.5 px-4 rounded-2xl bg-[#EA580C] hover:bg-[#D94E06] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-sm"
            >
              <ReceiptText className="w-5 h-5" />
              VER PAGAMENTO / FATURA DESTA VENDA
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCompletedSale(null)}
            className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-lg shadow-md"
          >
            FAZER OUTRA VENDA
          </button>
          <Link
            to="/"
            className="block w-full py-3.5 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-extrabold text-base text-center"
          >
            Voltar para o Início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32">
      {correctSaleId && (
        <div className="rounded-2xl bg-amber-100 border-2 border-amber-400 p-3.5 text-amber-950 font-extrabold text-sm">
          ✏️ Corrigindo a venda #{correctSaleId}. Ajuste os produtos ou pagamento e finalize.
        </div>
      )}

      {/* Super clear direct buttons at top of Vender */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => setNewCustOpen(true)}
          className="py-3 px-2 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-300 text-emerald-950 font-extrabold text-xs sm:text-sm flex flex-col items-center justify-center gap-1 text-center"
        >
          <UserPlus className="w-5 h-5 text-[#0B4619]" />
          + Novo Cliente
        </button>
        <Link
          to="/clientes"
          className="py-3 px-2 rounded-2xl bg-orange-100 hover:bg-orange-200 border-2 border-orange-300 text-orange-950 font-extrabold text-xs sm:text-sm flex flex-col items-center justify-center gap-1 text-center"
        >
          <Users className="w-5 h-5 text-orange-700" />
          Ver Fiados
        </Link>
        <Link
          to="/vendas"
          className="py-3 px-2 rounded-2xl bg-white hover:bg-stone-100 border-2 border-stone-200 text-stone-800 font-extrabold text-xs sm:text-sm flex flex-col items-center justify-center gap-1 text-center"
        >
          <ClipboardList className="w-5 h-5 text-stone-600" />
          Vendas Feitas
        </Link>
      </div>

      {/* Step indicator */}
      <div className="px-1 flex items-center justify-between gap-2">
        <h2 className="text-base font-black text-stone-800 leading-tight">
          Escolha o que está vendendo:
        </h2>
        <Link
          to="/produtos?novo=1"
          className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-[#EA580C] hover:bg-[#D94E06] active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm shadow-xs shrink-0 whitespace-nowrap transition"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Novo Produto</span>
        </Link>
      </div>

      {/* Search & Category chips */}
      {products.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center bg-white border-[3px] border-stone-400 rounded-2xl px-3.5 shadow-xs focus-within:border-[#0B4619]">
            <Search className="w-5 h-5 text-stone-600 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Procurar produto para vender..."
              className="w-full px-3 py-3 text-base font-bold placeholder:text-stone-500 focus:outline-none"
            />
          </div>

          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className={`px-4 py-2 rounded-xl text-sm font-extrabold shrink-0 border ${
                  selectedCategory === 'ALL'
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                Todos
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-sm font-extrabold shrink-0 border ${
                    selectedCategory === cat
                      ? 'bg-[#0B4619] text-white border-[#0B4619]'
                      : 'bg-white text-stone-700 border-stone-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Products list */}
      {loading ? (
        <div className="space-y-2.5">
          <div className="h-24 rounded-2xl bg-white animate-pulse" />
          <div className="h-24 rounded-2xl bg-white animate-pulse" />
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-white rounded-3xl border-2 border-stone-200 p-6 text-center space-y-4">
          <Package className="w-12 h-12 text-stone-300 mx-auto" />
          <div>
            <p className="text-lg font-extrabold text-stone-800">
              Você ainda não cadastrou produtos
            </p>
            <p className="text-sm font-semibold text-stone-500 mt-1">
              Para vender, primeiro cadastre os produtos que você vende.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center">
            <Link
              to="/produtos?novo=1"
              className="px-5 py-4 rounded-2xl bg-[#EA580C] hover:bg-[#D94E06] text-white font-extrabold text-base"
            >
              + Cadastrar Produto
            </Link>
            <button
              type="button"
              onClick={() => setNewCustOpen(true)}
              className="px-5 py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-base"
            >
              + Cadastrar Cliente
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredProducts.map((p) => {
            const inCart = cart.find((c) => c.product.id === p.id);
            const outOfStock = p.stock_qty <= 0;

            return (
              <div
                key={p.id}
                className={`bg-white rounded-2xl border-2 p-3 space-y-2.5 transition ${
                  inCart
                    ? 'border-[#0B4619] ring-2 ring-[#0B4619]/15'
                    : 'border-stone-200'
                }`}
              >
                <div className="flex items-stretch gap-3">
                  {p.photo_url ? (
                    <div className="w-28 sm:w-32 min-h-[124px] self-stretch rounded-xl bg-stone-50 border border-stone-200 p-1 flex items-center justify-center shrink-0 overflow-hidden">
                      <img
                        src={p.photo_url}
                        alt={p.name}
                        decoding="async"
                        className="w-full h-full object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="w-28 sm:w-32 min-h-[124px] self-stretch rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                      <ShoppingBag className="w-11 h-11 text-[#0B4619]" />
                    </div>
                  )}

                  <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                    <div>
                      <div className="font-extrabold text-base sm:text-lg text-stone-900 leading-snug break-words">
                        {p.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (!inCart) addToCart(p);
                            setEditingCartProdId(p.id);
                            setEditPriceText(
                              centsToInputString(inCart ? inCart.unitPriceCents : p.price_cents),
                            );
                          }}
                          className="text-lg sm:text-xl font-black text-[#0B4619] underline decoration-dotted whitespace-nowrap shrink-0"
                          title="Toque para mudar o preço nesta venda"
                        >
                          {formatBRL(inCart ? inCart.unitPriceCents : p.price_cents)}
                        </button>
                        <span
                          className={`inline-flex items-center whitespace-nowrap shrink-0 text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${
                            outOfStock
                              ? 'bg-red-100 text-red-900 border-red-300'
                              : p.stock_qty <= p.min_stock_qty
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : 'bg-emerald-50 text-[#0B4619] border-emerald-300'
                          }`}
                        >
                          {outOfStock ? 'Sem estoque' : `Tem ${p.stock_qty}`}
                        </span>
                      </div>
                    </div>

                    {!inCart && (
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          disabled={outOfStock}
                          onClick={() => addToCart(p)}
                          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#0B4619] hover:bg-[#115E2B] disabled:bg-stone-200 disabled:text-stone-400 text-white font-extrabold text-base shrink-0"
                        >
                          + Pegar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {inCart && (
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-emerald-200/80">
                    <div className="text-xs font-extrabold text-stone-600">
                      Item:{' '}
                      <span className="text-sm font-black text-[#0B4619]">
                        {formatBRL(inCart.unitPriceCents * inCart.quantity)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => changeQty(p.id, -1)}
                        className="w-10 h-10 rounded-xl bg-stone-200 hover:bg-stone-300 border border-stone-300 flex items-center justify-center font-black text-stone-900"
                        aria-label="Diminuir"
                      >
                        <Minus className="w-5 h-5" />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`Quantidade de ${p.name}`}
                        value={
                          qtyDrafts[p.id] !== undefined
                            ? qtyDrafts[p.id]
                            : String(inCart.quantity)
                        }
                        onFocus={(e) => {
                          setQtyDrafts((prev) => ({
                            ...prev,
                            [p.id]: String(inCart.quantity),
                          }));
                          e.currentTarget.select();
                        }}
                        onChange={(e) => handleQtyInputChange(p, e.target.value)}
                        onBlur={() => handleQtyInputBlur(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                        className="w-14 h-10 text-center text-lg font-black text-stone-900 bg-white rounded-xl border-2 border-stone-300 focus:border-[#0B4619] focus:outline-none tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => changeQty(p.id, 1)}
                        className="w-10 h-10 rounded-xl bg-[#0B4619] hover:bg-[#115E2B] border border-[#073311] text-white flex items-center justify-center font-black"
                        aria-label="Aumentar"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky Cart Bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-[calc(4.75rem+max(0.75rem,env(safe-area-inset-bottom)))] left-0 right-0 z-20 px-4">
          <div className="max-w-3xl mx-auto">
            <button
              type="button"
              onClick={openCheckout}
              className="w-full py-2.5 px-3.5 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white shadow-lg border-2 border-[#073311] flex items-center justify-between gap-2.5 active:scale-[0.99]"
            >
              <div className="text-left min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wide opacity-90 leading-tight">
                  {totalQty} {totalQty === 1 ? 'item' : 'itens'}
                </div>
                <div className="text-lg font-black leading-tight">{formatBRL(totalCents)}</div>
              </div>
              <span className="px-3.5 py-2 rounded-xl bg-[#EA580C] text-white font-black text-sm whitespace-nowrap shrink-0 shadow-xs">
                Fechar Venda →
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Price Edit Modal */}
      <Modal
        open={editingCartProdId !== null}
        onClose={() => setEditingCartProdId(null)}
        title="Mudar preço nesta venda"
      >
        <div className="space-y-4">
          <MoneyInput label="Novo preço de cada um" value={editPriceText} onChange={setEditPriceText} />
          <button
            type="button"
            onClick={() => {
              const cents = parseMoneyToCents(editPriceText);
              if (cents <= 0) {
                showError('Coloque um preço maior que zero.');
                return;
              }
              setCart((prev) =>
                prev.map((item) =>
                  item.product.id === editingCartProdId ? { ...item, unitPriceCents: cents } : item,
                ),
              );
              setEditingCartProdId(null);
            }}
            className="w-full py-4 rounded-2xl bg-[#0B4619] text-white font-extrabold text-lg"
          >
            APLICAR PREÇO
          </button>
        </div>
      </Modal>

      {/* Checkout Modal */}
      <Modal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="Como o cliente vai pagar?"
      >
        <div className="space-y-4">
          {/* Cart Summary */}
          <div className="bg-white rounded-2xl border border-stone-200 p-3.5 space-y-1.5">
            {cart.map((c) => (
              <div key={c.product.id} className="flex justify-between text-sm font-bold text-stone-700">
                <span>
                  {c.quantity}x {c.product.name}
                </span>
                <span>{formatBRL(c.unitPriceCents * c.quantity)}</span>
              </div>
            ))}
            {discountCents > 0 && (
              <>
                <div className="border-t border-stone-100 pt-1.5 flex justify-between text-sm font-bold text-stone-500">
                  <span>Subtotal:</span>
                  <span>{formatBRL(subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-red-600">
                  <span>Desconto:</span>
                  <span>- {formatBRL(discountCents)}</span>
                </div>
              </>
            )}
            <div className="border-t border-stone-200 pt-2 flex justify-between items-baseline text-xl font-black text-stone-900">
              <span>Total:</span>
              <span className="flex items-baseline gap-2">
                {discountCents > 0 && (
                  <span className="text-sm font-bold text-stone-400 line-through">
                    {formatBRL(subtotalCents)}
                  </span>
                )}
                <span className="text-[#0B4619]">{formatBRL(totalCents)}</span>
              </span>
            </div>
          </div>

          {/* Discount Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-base font-bold text-stone-800">Desconto (opcional)</label>
              {discountCents > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-red-600">
                    - {formatBRL(discountCents)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDiscountText('')}
                    className="px-2 py-0.5 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-700 text-xs font-extrabold"
                  >
                    Limpar
                  </button>
                </div>
              )}
            </div>
            <div
              className={`flex items-center rounded-2xl border-2 overflow-hidden transition ${
                discountTooHigh
                  ? 'border-red-500 bg-red-50'
                  : discountCents > 0
                    ? 'border-red-400 bg-red-50/40 focus-within:border-red-600'
                    : 'border-stone-300 bg-white focus-within:border-[#0B4619]'
              }`}
            >
              <span
                className={`px-3.5 py-2.5 font-extrabold text-base border-r select-none ${
                  discountCents > 0
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : 'bg-stone-100 text-stone-700 border-stone-200'
                }`}
              >
                {discountCents > 0 ? '- R$' : 'R$'}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={discountText}
                onChange={(e) => setDiscountText(formatMoneyMask(e.target.value))}
                placeholder="0,00"
                className={`w-full px-3.5 py-2.5 text-lg font-extrabold bg-transparent focus:outline-none ${
                  discountCents > 0 ? 'text-red-600' : 'text-stone-900'
                }`}
              />
            </div>
            {discountTooHigh && (
              <p className="mt-1 text-xs font-extrabold text-red-600">
                O desconto não pode ser igual ou maior que o valor dos produtos ({formatBRL(subtotalCents)}).
              </p>
            )}
          </div>

          {/* 3 Sale Types */}
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: 'CASH', label: 'À Vista' },
                { key: 'FIADO', label: 'Fiado' },
                { key: 'INSTALLMENT', label: 'Parcelado' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSaleType(opt.key)}
                className={`py-3.5 px-2 rounded-2xl font-extrabold text-base border-2 ${
                  saleType === opt.key
                    ? 'bg-[#0B4619] text-white border-[#0B4619]'
                    : 'bg-white text-stone-700 border-stone-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Customer Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-base font-bold text-stone-800">
                Cliente {saleType === 'CASH' ? '(opcional)' : <span className="text-orange-600">*</span>}
              </label>
              <button
                type="button"
                onClick={() => setNewCustOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-orange-100 hover:bg-orange-200 text-orange-900 font-extrabold text-sm flex items-center gap-1"
              >
                <UserPlus className="w-4 h-4" /> Novo Cliente
              </button>
            </div>

            {selectedCustomer ? (
              <div className="rounded-2xl border-2 border-[#0B4619] bg-emerald-50 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-extrabold text-base text-stone-900 truncate">
                    {selectedCustomer.name}
                  </div>
                  {(selectedCustomer.cpf ||
                    selectedCustomer.phone ||
                    selectedCustomer.address ||
                    selectedCustomer.notes) && (
                    <div className="text-xs font-bold text-stone-600 truncate mt-0.5">
                      {[
                        selectedCustomer.cpf ? `CPF ${selectedCustomer.cpf}` : null,
                        selectedCustomer.phone,
                        selectedCustomer.address,
                        selectedCustomer.notes,
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </div>
                  )}
                  {selectedCustomer.total_debt_cents > 0 && (
                    <div className="text-xs font-extrabold text-orange-800 mt-0.5">
                      Já deve: {formatBRL(selectedCustomer.total_debt_cents)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustomerId('');
                    setCustomerSearch('');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 font-extrabold text-xs shrink-0"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center bg-white border-[3px] border-stone-400 rounded-2xl px-3 shadow-xs focus-within:border-[#0B4619]">
                  <Search className="w-4 h-4 text-stone-600 shrink-0" />
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Buscar por nome, CPF, telefone ou endereço..."
                    className="w-full px-2.5 py-2.5 text-sm font-bold placeholder:text-stone-500 focus:outline-none"
                  />
                </div>

                <div className="bg-white rounded-2xl border-2 border-stone-200 max-h-44 overflow-y-auto divide-y divide-stone-100">
                  {saleType === 'CASH' && !customerSearch.trim() && (
                    <div className="px-3.5 py-2.5 bg-emerald-50 text-[#0B4619] text-sm font-extrabold flex items-center justify-between">
                      <span>Sem nome (venda rápida)</span>
                      <span className="text-[11px] uppercase">Selecionado</span>
                    </div>
                  )}

                  {filteredCustomers.length === 0 ? (
                    <div className="p-3 text-center space-y-2">
                      <div className="text-xs font-bold text-stone-500">
                        {customers.length === 0
                          ? 'Nenhum cliente cadastrado ainda.'
                          : 'Nenhum cliente encontrado com essa busca.'}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (customerSearch.trim() && /[a-zà-ÿ]/i.test(customerSearch)) {
                            setNewCustName(customerSearch.trim());
                          }
                          setNewCustOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-[#0B4619] font-extrabold text-xs inline-flex items-center gap-1"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Cadastrar cliente agora
                      </button>
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomerId(c.id);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 flex items-center justify-between gap-2 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-extrabold text-stone-900 truncate">
                            {c.name}
                          </div>
                          {(c.cpf || c.phone || c.address || c.notes) && (
                            <div className="text-xs font-semibold text-stone-500 truncate">
                              {[c.cpf ? `CPF ${c.cpf}` : null, c.phone, c.address, c.notes]
                                .filter(Boolean)
                                .join(' • ')}
                            </div>
                          )}
                        </div>
                        {c.total_debt_cents > 0 && (
                          <span className="px-2 py-0.5 rounded-lg bg-orange-100 text-orange-900 text-[11px] font-extrabold shrink-0">
                            Deve {formatBRL(c.total_debt_cents)}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Payment method for CASH or Down Payment */}
          {saleType !== 'CASH' && (
            <MoneyInput
              label="Deu alguma entrada agora? (opcional)"
              value={downPaymentText}
              onChange={setDownPaymentText}
              placeholder="0,00"
            />
          )}

          {(saleType === 'CASH' || downCentsPreview > 0) && (
            <div>
              <label className="block text-base font-bold text-stone-800 mb-1.5">
                {saleType === 'CASH' ? 'Forma de pagamento' : 'Como pagou a entrada?'}
              </label>
              <PaymentMethodSelector
                value={paymentMethod}
                onChange={setPaymentMethod}
                tone="orange"
              />
            </div>
          )}

          {/* FIADO due date */}
          {saleType === 'FIADO' && (
            <div className="space-y-3 bg-white p-3.5 rounded-2xl border-2 border-stone-200">
              <div>
                <label className="block text-base font-bold text-stone-800 mb-1.5">
                  Vencimento (dia para pagar)
                </label>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {[15, 30, 45, 60].map((days) => {
                    const target = addDaysISO(todayLocalISO(), days);
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setDueDate(target)}
                        className={`py-2 rounded-xl font-extrabold text-xs border-2 ${
                          dueDate === target
                            ? 'bg-[#0B4619] text-white border-[#0B4619]'
                            : 'bg-stone-50 text-stone-700 border-stone-200'
                        }`}
                      >
                        {days} dias
                      </button>
                    );
                  })}
                </div>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-stone-300 bg-white text-base font-bold"
                />
              </div>

              <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-between gap-2 text-sm font-extrabold text-orange-950">
                <span>Fica devendo ({formatDateBR(dueDate)}):</span>
                <span className="text-base font-black text-orange-800">
                  {formatBRL(remainingDebtPreview)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSaleType('INSTALLMENT')}
                className="w-full py-2.5 px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-extrabold text-xs"
              >
                Quer dividir em parcelas? Toque para colocar Parcelado →
              </button>
            </div>
          )}

          {/* INSTALLMENT options */}
          {saleType === 'INSTALLMENT' && (
            <div className="space-y-3 bg-white p-3.5 rounded-2xl border-2 border-stone-200">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-base font-bold text-stone-800">
                    Em quantas parcelas?
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateInstallmentsPlan(installmentCount - 1, firstDueDate)}
                      className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 font-black text-base flex items-center justify-center border border-stone-300"
                    >
                      -
                    </button>
                    <span className="min-w-[42px] text-center font-black text-base text-[#0B4619]">
                      {installmentCount}x
                    </span>
                    <button
                      type="button"
                      onClick={() => updateInstallmentsPlan(installmentCount + 1, firstDueDate)}
                      className="w-8 h-8 rounded-lg bg-stone-100 hover:bg-stone-200 font-black text-base flex items-center justify-center border border-stone-300"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {[2, 3, 4, 5, 6, 12].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => updateInstallmentsPlan(n, firstDueDate)}
                      className={`py-2.5 rounded-xl font-black text-sm border-2 ${
                        installmentCount === n
                          ? 'bg-[#0B4619] text-white border-[#0B4619]'
                          : 'bg-stone-50 text-stone-700 border-stone-200'
                      }`}
                    >
                      {n}x
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-stone-700 mb-1">
                  Vencimento da 1ª parcela
                </label>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {[
                    { label: 'Hoje', value: todayLocalISO() },
                    { label: '+15 dias', value: addDaysISO(todayLocalISO(), 15) },
                    { label: '+1 mês', value: addMonthISO(todayLocalISO(), 1) },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => updateInstallmentsPlan(installmentCount, opt.value)}
                      className={`py-2 rounded-xl font-extrabold text-xs border-2 ${
                        firstDueDate === opt.value
                          ? 'bg-[#0B4619] text-white border-[#0B4619]'
                          : 'bg-stone-50 text-stone-700 border-stone-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <input
                  type="date"
                  value={firstDueDate}
                  onChange={(e) => updateInstallmentsPlan(installmentCount, e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border-2 border-stone-300 bg-white text-base font-bold"
                />
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                <div className="flex items-center justify-between gap-2 text-sm font-extrabold text-emerald-950">
                  <span>
                    {installmentCount}x de {formatBRL(installmentValuePreview)}
                  </span>
                  <span className="text-xs font-bold text-emerald-800">
                    Total: {formatBRL(remainingDebtPreview)}
                  </span>
                </div>

                {installmentSchedule.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                    {installmentSchedule.map((inst, idx) => (
                      <div
                        key={inst.number}
                        className="flex items-center justify-between gap-2 bg-white rounded-xl px-2.5 py-1.5 border border-emerald-200 text-xs font-bold"
                      >
                        <span className="font-extrabold text-stone-700 shrink-0">
                          {inst.number}ª parc.
                        </span>
                        <input
                          type="date"
                          value={inst.dueDate}
                          onChange={(e) => {
                            const next = [...installmentDates];
                            while (next.length < installmentCount) {
                              next.push(addMonthISO(firstDueDate, next.length));
                            }
                            next[idx] = e.target.value;
                            setInstallmentDates(next);
                          }}
                          className="px-2 py-1 rounded-lg border border-stone-300 bg-stone-50 text-xs font-bold"
                        />
                        <span className="font-black text-[#0B4619] shrink-0">
                          {formatBRL(inst.amountCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-stone-700 mb-1">
              Algum recado? (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Entregar na feira"
              className="w-full px-3.5 py-3 rounded-xl border border-stone-300 bg-white text-base font-bold"
            />
          </div>

          <button
            type="button"
            disabled={submitting || discountTooHigh}
            onClick={handleFinishSale}
            className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-black text-xl shadow-lg disabled:opacity-60"
          >
            {submitting ? 'ANOTANDO...' : 'CONFIRMAR VENDA'}
          </button>
        </div>
      </Modal>

      {/* Quick New Customer Modal */}
      <Modal
        open={newCustOpen}
        onClose={() => setNewCustOpen(false)}
        title="Novo Cliente"
      >
        <form onSubmit={handleCreateQuickCustomer} className="space-y-4">
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Nome do cliente <span className="text-orange-600">*</span>
            </label>
            <input
              type="text"
              required
              value={newCustName}
              onChange={(e) => setNewCustName(e.target.value)}
              placeholder="Ex: Dona Maria"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Telefone / WhatsApp (opcional)
            </label>
            <input
              type="tel"
              value={newCustPhone}
              onChange={(e) => setNewCustPhone(formatPhoneInput(e.target.value))}
              placeholder="(88) 99999-9999"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              CPF (opcional)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={newCustCpf}
              onChange={(e) => setNewCustCpf(formatCpfInput(e.target.value))}
              placeholder="000.000.000-00"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Endereço (opcional)
            </label>
            <input
              type="text"
              value={newCustAddress}
              onChange={(e) => setNewCustAddress(e.target.value)}
              placeholder="Ex: Rua da Matriz, 40"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Detalhamento do endereço (opcional)
            </label>
            <input
              type="text"
              value={newCustNotes}
              onChange={(e) => setNewCustNotes(e.target.value)}
              placeholder="Ex: Casa verde perto da igreja, portão branco"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>
          <button
            type="submit"
            className="w-full py-4 rounded-2xl bg-[#0B4619] text-white font-extrabold text-lg"
          >
            SALVAR CLIENTE
          </button>
        </form>
      </Modal>
    </div>
  );
}
