import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Edit3,
  History,
  Package,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { api, getCachedApi, preloadImageUrls } from '../lib/api';
import { matchesFlexibleSearch } from '../lib/search';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import {
  centsToInputString,
  formatBRL,
  formatDateBR,
  parseMoneyToCents,
} from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import { Modal } from '../components/Modal';
import { MoneyInput } from '../components/MoneyInput';
import { ImageUpload } from '../components/ImageUpload';
import { PaymentMethodSelector } from '../components/PaymentMethodIcon';

export interface Product {
  id: number;
  name: string;
  category: string | null;
  photo_url: string | null;
  stock_qty: number;
  min_stock_qty: number;
  cost_cents: number;
  price_cents: number;
  low_stock: boolean;
}

interface StockMovement {
  id: number;
  product_id: number;
  product_name: string;
  type: string;
  delta_qty: number;
  qty_after: number;
  unit_cost_cents: number;
  reason: string | null;
  created_at: string;
}

export function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [onlyLow, setOnlyLow] = useState(searchParams.get('low') === '1');
  const initialProductsPath = onlyLow ? '/products?lowStock=1' : '/products';
  const [products, setProducts] = useState<Product[]>(
    () => getCachedApi<{ products: Product[] }>(initialProductsPath)?.products ?? [],
  );
  const [movements, setMovements] = useState<StockMovement[]>(
    () => getCachedApi<{ movements: StockMovement[] }>('/products/movements')?.movements ?? [],
  );
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'list' | 'history'>('list');
  const [loading, setLoading] = useState(
    () =>
      !(
        getCachedApi<{ products: Product[] }>(initialProductsPath) &&
        getCachedApi<{ movements: StockMovement[] }>('/products/movements')
      ),
  );

  // Form Modal (Create/Edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [stockQty, setStockQty] = useState('0');
  const [minStockQty, setMinStockQty] = useState('5');
  const [costText, setCostText] = useState('');
  const [priceText, setPriceText] = useState('');
  const [registerInitialPurchase, setRegisterInitialPurchase] = useState(false);
  const [saving, setSaving] = useState(false);

  // Stock Movement Modal
  const [stockModalProduct, setStockModalProduct] = useState<Product | null>(null);
  const [movType, setMovType] = useState<'IN' | 'OUT'>('IN');
  const [movQty, setMovQty] = useState('1');
  const [movCostText, setMovCostText] = useState('');
  const [movReason, setMovReason] = useState('');
  const [movPaidNow, setMovPaidNow] = useState(true);
  const [movMethod, setMovMethod] = useState<'DINHEIRO' | 'PIX' | 'CARTAO'>('DINHEIRO');

  const { showSuccess, showError, confirmAction } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const productsPath = onlyLow ? '/products?lowStock=1' : '/products';
        const [prodRes, movRes] = await Promise.all([
          api<{ products: Product[] }>(productsPath),
          api<{ movements: StockMovement[] }>('/products/movements'),
        ]);
        setProducts(prodRes.products);
        setMovements(movRes.movements);
        preloadImageUrls(prodRes.products.map((p) => p.photo_url));
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao carregar produtos.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [onlyLow, showError],
  );

  const filteredProducts = useMemo(
    () => products.filter((p) => matchesFlexibleSearch(search, [p.name, p.category])),
    [products, search],
  );

  useEffect(() => {
    const productsPath = onlyLow ? '/products?lowStock=1' : '/products';
    const cachedProds = getCachedApi<{ products: Product[] }>(productsPath);
    const cachedMovs = getCachedApi<{ movements: StockMovement[] }>('/products/movements');
    if (cachedProds) {
      setProducts(cachedProds.products);
      preloadImageUrls(cachedProds.products.map((p) => p.photo_url));
    }
    if (cachedMovs) {
      setMovements(cachedMovs.movements);
    }
    load(Boolean(cachedProds && cachedMovs));
  }, [load, onlyLow]);

  useLiveRefresh(() => load(true));

  const openNew = useCallback(() => {
    setEditing(null);
    setName('');
    setCategory('');
    setPhotoUrl(null);
    setStockQty('1');
    setMinStockQty('5');
    setCostText('');
    setPriceText('');
    setRegisterInitialPurchase(false);
    setFormOpen(true);
  }, []);

  useEffect(() => {
    if (searchParams.get('novo') === '1') {
      openNew();
      const next = new URLSearchParams(searchParams);
      next.delete('novo');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, openNew]);

  const openEdit = (p: Product) => {
    setEditing(p);
    setName(p.name);
    setCategory(p.category || '');
    setPhotoUrl(p.photo_url);
    setStockQty(String(p.stock_qty));
    setMinStockQty(String(p.min_stock_qty));
    setCostText(centsToInputString(p.cost_cents));
    setPriceText(centsToInputString(p.price_cents));
    setFormOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const costCents = parseMoneyToCents(costText);
    const priceCents = parseMoneyToCents(priceText);
    if (priceCents <= 0) {
      showError('Coloque o preço de venda maior que zero.');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await api(`/products/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name,
            category: category || null,
            photoUrl,
            stockQty: Math.max(0, Number.parseInt(stockQty || '0', 10) || 0),
            minStockQty: Math.max(0, Number.parseInt(minStockQty || '5', 10) || 0),
            costCents,
            priceCents,
          }),
        });
        showSuccess('Produto atualizado!');
      } else {
        await api('/products', {
          method: 'POST',
          body: JSON.stringify({
            name,
            category: category || null,
            photoUrl,
            stockQty: Math.max(0, Number.parseInt(stockQty || '0', 10) || 0),
            minStockQty: Math.max(0, Number.parseInt(minStockQty || '5', 10) || 0),
            costCents,
            priceCents,
            registerInitialPurchase,
            paymentMethod: 'DINHEIRO',
          }),
        });
        showSuccess('Produto cadastrado!');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar produto.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (p: Product) => {
    const confirmed = await confirmAction({
      title: 'Excluir produto?',
      message: `Tem certeza que deseja tirar "${p.name}" da lista de produtos?`,
      confirmLabel: 'Sim, excluir',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const res = await api<{ mode: 'deleted' | 'archived' }>(`/products/${p.id}`, {
        method: 'DELETE',
      });
      showSuccess(
        res.mode === 'archived'
          ? 'Produto escondido (vendas antigas mantidas).'
          : 'Produto apagado!',
      );
      setFormOpen(false);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao apagar produto.');
    }
  };

  const openStockModal = (p: Product, type: 'IN' | 'OUT') => {
    setStockModalProduct(p);
    setMovType(type);
    setMovQty('1');
    setMovCostText(centsToInputString(p.cost_cents));
    setMovReason('');
    setMovPaidNow(true);
    setMovMethod('DINHEIRO');
  };

  const handleSaveMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModalProduct) return;
    const qty = Number.parseInt(movQty || '0', 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      showError('Coloque uma quantidade maior que zero.');
      return;
    }
    setSaving(true);
    try {
      await api(`/products/${stockModalProduct.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          type: movType,
          quantity: qty,
          unitCostCents: movType === 'IN' ? parseMoneyToCents(movCostText) : undefined,
          reason: movReason || undefined,
          registerFinancialOutflow: movType === 'IN' ? movPaidNow : false,
          paymentMethod: movMethod,
        }),
      });
      showSuccess(
        movType === 'IN'
          ? `Entrada de ${qty}x ${stockModalProduct.name} anotada!`
          : `Saída de ${qty}x ${stockModalProduct.name} anotada!`,
      );
      setStockModalProduct(null);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao mexer no estoque.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Action + Tabs */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <button
          type="button"
          onClick={openNew}
          className="flex-1 py-4 px-5 rounded-2xl bg-[#EA580C] hover:bg-[#D94E06] text-white font-extrabold text-lg shadow-md flex items-center justify-center gap-2"
        >
          <Plus className="w-6 h-6" /> Cadastrar Novo Produto
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('list')}
            className={`flex-1 sm:flex-initial px-4 py-3.5 rounded-2xl font-extrabold text-base border-2 flex items-center justify-center gap-1.5 ${
              tab === 'list'
                ? 'bg-[#0B4619] text-white border-[#0B4619]'
                : 'bg-white text-stone-700 border-stone-200'
            }`}
          >
            <Package className="w-5 h-5" /> Lista
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={`flex-1 sm:flex-initial px-4 py-3.5 rounded-2xl font-extrabold text-base border-2 flex items-center justify-center gap-1.5 ${
              tab === 'history'
                ? 'bg-[#0B4619] text-white border-[#0B4619]'
                : 'bg-white text-stone-700 border-stone-200'
            }`}
          >
            <History className="w-5 h-5" /> Movimentos
          </button>
        </div>
      </div>

      {tab === 'list' ? (
        <>
          {/* Search + Low stock filter */}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center bg-white border-[3px] border-stone-400 rounded-2xl px-3.5 shadow-xs focus-within:border-[#0B4619]">
              <Search className="w-5 h-5 text-stone-600 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar produto..."
                className="w-full px-3 py-3 text-base font-bold placeholder:text-stone-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setOnlyLow((v) => !v)}
              className={`px-4 py-3 rounded-2xl font-extrabold text-sm border-2 flex items-center gap-1.5 shrink-0 ${
                onlyLow
                  ? 'bg-amber-200 text-amber-950 border-amber-500'
                  : 'bg-white text-stone-700 border-stone-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4 text-amber-700" />
              Acabando
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="h-28 rounded-3xl bg-white animate-pulse" />
              <div className="h-28 rounded-3xl bg-white animate-pulse" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="bg-white rounded-3xl border-2 border-stone-200 p-8 text-center">
              <Package className="w-12 h-12 text-stone-300 mx-auto mb-2" />
              <p className="text-lg font-extrabold text-stone-700">Nenhum produto encontrado</p>
              <p className="text-sm text-stone-500 mt-1">
                Toque em <strong>Novo Produto</strong> para cadastrar sua mercadoria.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredProducts.map((p) => (
                <div
                  key={p.id}
                  className="bg-white rounded-2xl border-2 border-stone-300 p-3 shadow-xs space-y-2.5"
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
                      <div className="w-28 sm:w-32 min-h-[124px] self-stretch rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center shrink-0">
                        <Package className="w-11 h-11 text-orange-600" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <h3 className="text-base sm:text-lg font-black text-stone-900 leading-snug break-words">
                        {p.name}
                      </h3>

                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {p.category && (
                            <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-md bg-stone-100 border border-stone-300 text-stone-600">
                              {p.category}
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end">
                          <div className="text-xl font-black text-[#0B4619] leading-none">
                            {formatBRL(p.price_cents)}
                          </div>
                          <div className="text-xs font-bold text-stone-500 mt-1">
                            Custo: {formatBRL(p.cost_cents)}
                          </div>
                          <span
                            className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-extrabold border leading-tight ${
                              p.low_stock
                                ? 'bg-red-50 text-red-800 border-red-200'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            {p.low_stock && <AlertTriangle className="w-3 h-3 shrink-0" />}
                            Est: {p.stock_qty} {p.low_stock ? '• Baixo' : 'un.'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Quick buttons */}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openStockModal(p, 'IN')}
                      className="py-2.5 px-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-extrabold text-sm flex items-center justify-center gap-1 border border-emerald-200"
                    >
                      <ArrowUpCircle className="w-4 h-4" /> Entrada
                    </button>
                    <button
                      type="button"
                      onClick={() => openStockModal(p, 'OUT')}
                      className="py-2.5 px-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-extrabold text-sm flex items-center justify-center gap-1 border border-amber-200"
                    >
                      <ArrowDownCircle className="w-4 h-4" /> Saída
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="py-2.5 px-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-extrabold text-sm flex items-center justify-center gap-1 border border-stone-200"
                    >
                      <Edit3 className="w-4 h-4" /> Editar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2.5">
          {movements.length === 0 ? (
            <div className="bg-white rounded-3xl border-2 border-stone-200 p-8 text-center text-stone-500 font-bold">
              Nenhuma movimentação registrada ainda.
            </div>
          ) : (
            movements.map((m) => (
              <div
                key={m.id}
                className="bg-white rounded-2xl border border-stone-200 p-3.5 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-extrabold text-stone-900">{m.product_name}</div>
                  <div className="text-sm text-stone-600">{m.reason || m.type}</div>
                  <div className="text-xs text-stone-400">{formatDateBR(m.created_at)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={`text-lg font-black ${
                      m.delta_qty > 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {m.delta_qty > 0 ? `+${m.delta_qty}` : m.delta_qty}
                  </div>
                  <div className="text-xs font-bold text-stone-500">Ficou: {m.qty_after}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal Create/Edit Product */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar Produto' : 'Novo Produto'}
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Nome do produto <span className="text-orange-600">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Rede, Camisa, Sandália"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold focus:outline-none focus:border-[#0B4619]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MoneyInput
              label="Quanto custou"
              value={costText}
              onChange={setCostText}
              placeholder="0,00"
            />
            <MoneyInput
              label="Preço de venda"
              value={priceText}
              onChange={setPriceText}
              placeholder="0,00"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-base font-bold text-stone-800 mb-1.5">
                Quantos tem agora
              </label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-xl font-bold focus:outline-none focus:border-[#0B4619]"
              />
            </div>
            <div>
              <label className="block text-base font-bold text-stone-800 mb-1.5">
                Avisar quando faltar
              </label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={minStockQty}
                onChange={(e) => setMinStockQty(e.target.value)}
                className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-xl font-bold focus:outline-none focus:border-[#0B4619]"
              />
            </div>
          </div>

          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Categoria (opcional)
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex: Roupas, Calçados, Casa"
              className="w-full px-4 py-3 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold focus:outline-none focus:border-[#0B4619]"
            />
          </div>

          <ImageUpload value={photoUrl} onChange={setPhotoUrl} />

          {!editing && Number.parseInt(stockQty || '0', 10) > 0 && (
            <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 cursor-pointer">
              <input
                type="checkbox"
                checked={registerInitialPurchase}
                onChange={(e) => setRegisterInitialPurchase(e.target.checked)}
                className="w-5 h-5 accent-[#0B4619]"
              />
              <span className="text-sm font-bold text-amber-950">
                Tirar o valor dessa compra do caixa agora?
              </span>
            </label>
          )}

          <div className="flex gap-2 pt-2">
            {editing && (
              <button
                type="button"
                onClick={() => handleDeleteProduct(editing)}
                className="px-4 py-4 rounded-2xl bg-red-100 hover:bg-red-200 border-2 border-red-300 text-red-800 font-extrabold flex items-center gap-1.5"
              >
                <Trash2 className="w-5 h-5" /> Apagar
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-lg shadow-md disabled:opacity-60"
            >
              {saving ? 'SALVANDO...' : 'SALVAR PRODUTO'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Stock Movement */}
      <Modal
        open={Boolean(stockModalProduct)}
        onClose={() => setStockModalProduct(null)}
        title={
          movType === 'IN'
            ? `Entrada: ${stockModalProduct?.name || ''}`
            : `Saída: ${stockModalProduct?.name || ''}`
        }
      >
        <form onSubmit={handleSaveMovement} className="space-y-3">
          <div>
            <label className="block text-sm font-bold text-stone-800 mb-1">
              Quantidade (tem {stockModalProduct?.stock_qty ?? 0} agora)
            </label>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              required
              value={movQty}
              onChange={(e) => setMovQty(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border-2 border-stone-300 bg-white text-2xl font-black focus:outline-none focus:border-[#0B4619]"
            />
            <div className="grid grid-cols-4 gap-1.5 mt-2">
              {[1, 5, 10, 20].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMovQty(String(n))}
                  className="py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 font-extrabold text-sm text-stone-800 border border-stone-200"
                >
                  {n} un.
                </button>
              ))}
            </div>
          </div>

          {movType === 'IN' && (
            <>
              <MoneyInput
                label="Custo de cada um (opcional)"
                value={movCostText}
                onChange={setMovCostText}
                helper=""
              />

              <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-amber-50 border border-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={movPaidNow}
                  onChange={(e) => setMovPaidNow(e.target.checked)}
                  className="w-5 h-5 accent-[#0B4619]"
                />
                <span className="text-sm font-bold text-amber-950">
                  Pagou agora? (Anota no Dinheiro)
                </span>
              </label>

              {movPaidNow && (
                <PaymentMethodSelector value={movMethod} onChange={setMovMethod} size="sm" />
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-bold text-stone-700 mb-1">
              Observação (opcional)
            </label>
            <input
              type="text"
              value={movReason}
              onChange={(e) => setMovReason(e.target.value)}
              placeholder={movType === 'IN' ? 'Ex: Compra na feira' : 'Ex: Estragou / Brinde'}
              className="w-full px-3.5 py-2.5 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold focus:outline-none focus:border-[#0B4619]"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3.5 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-lg shadow-md"
          >
            {saving ? 'SALVANDO...' : movType === 'IN' ? 'CONFIRMAR ENTRADA' : 'CONFIRMAR SAÍDA'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
