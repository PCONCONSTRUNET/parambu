import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Phone,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { api, getCachedApi } from '../lib/api';
import { useLiveRefresh } from '../lib/useLiveRefresh';
import { matchesFlexibleSearch } from '../lib/search';
import { formatBRL, formatCpfInput, formatDateBR, formatPhoneInput } from '../lib/format';
import { useFeedback } from '../components/FeedbackContext';
import { Modal } from '../components/Modal';

interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  cpf: string | null;
  address: string | null;
  notes?: string | null;
  total_debt_cents: number;
  open_debts_count: number;
  overdue_installments_count: number;
  next_due_date: string | null;
}

export function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFilter = searchParams.get('filter');
  const resolvedInitialFilter: 'all' | 'owing' | 'overdue' =
    initialFilter === 'overdue' || initialFilter === 'owing' ? initialFilter : 'all';
  const [filter, setFilter] = useState<'all' | 'owing' | 'overdue'>(resolvedInitialFilter);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>(
    () =>
      getCachedApi<{ customers: CustomerRow[] }>(`/customers?filter=${resolvedInitialFilter}`)
        ?.customers ?? [],
  );
  const [loading, setLoading] = useState(
    () => !getCachedApi(`/customers?filter=${resolvedInitialFilter}`),
  );

  const [newOpen, setNewOpen] = useState(searchParams.get('novo') === '1');

  useEffect(() => {
    if (searchParams.get('novo') === '1') {
      setNewOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('novo');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cpf, setCpf] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const { showSuccess, showError } = useFeedback();

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({ filter });
        const res = await api<{ customers: CustomerRow[] }>(`/customers?${qs.toString()}`);
        setCustomers(res.customers);
      } catch (err) {
        if (!silent) {
          showError(err instanceof Error ? err.message : 'Erro ao carregar clientes.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filter, showError],
  );

  const filteredCustomers = useMemo(
    () =>
      customers.filter((c) =>
        matchesFlexibleSearch(search, [c.name, c.phone, c.cpf, c.address, c.notes], [c.phone, c.cpf]),
      ),
    [customers, search],
  );

  useEffect(() => {
    const cached = getCachedApi<{ customers: CustomerRow[] }>(`/customers?filter=${filter}`);
    if (cached) setCustomers(cached.customers);
    load(Boolean(cached));
  }, [load, filter]);

  useLiveRefresh(() => load(true));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name,
          phone: phone || null,
          cpf: cpf || null,
          address: address || null,
          notes: notes || null,
        }),
      });
      showSuccess('Cliente cadastrado!');
      setName('');
      setPhone('');
      setCpf('');
      setAddress('');
      setNotes('');
      setNewOpen(false);
      await load();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao cadastrar cliente.');
    } finally {
      setSaving(false);
    }
  };

  const totalPendingCents = customers.reduce((acc, c) => acc + c.total_debt_cents, 0);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setNewOpen(true)}
        className="w-full py-4 px-5 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-black text-xl flex items-center justify-center gap-2 shadow-md"
      >
        <UserPlus className="w-6 h-6" /> + CADASTRAR NOVO CLIENTE
      </button>

      <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-orange-900">Total de fiados a receber:</span>
        <span className="text-xl font-black text-orange-800">{formatBRL(totalPendingCents)}</span>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            { key: 'all', label: 'Todos' },
            { key: 'owing', label: 'Devendo' },
            { key: 'overdue', label: 'Atrasados' },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`py-3 rounded-2xl font-extrabold text-sm sm:text-base border-2 ${
              filter === f.key
                ? 'bg-[#0B4619] text-white border-[#0B4619]'
                : 'bg-white text-stone-700 border-stone-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex items-center bg-white border-[3px] border-stone-400 rounded-2xl px-3.5 shadow-xs focus-within:border-[#0B4619]">
        <Search className="w-5 h-5 text-stone-600 shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, telefone, CPF ou endereço..."
          className="w-full px-3 py-3 text-base font-bold placeholder:text-stone-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <div className="h-24 rounded-2xl bg-white animate-pulse" />
          <div className="h-24 rounded-2xl bg-white animate-pulse" />
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="bg-white rounded-3xl border-2 border-stone-200 p-8 text-center">
          <Users className="w-12 h-12 text-stone-300 mx-auto mb-2" />
          <p className="text-lg font-extrabold text-stone-700">Nenhum cliente aqui</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredCustomers.map((c) => {
            const hasDebt = c.total_debt_cents > 0;
            const isOverdue = c.overdue_installments_count > 0;

            return (
              <Link
                key={c.id}
                to={`/clientes/${c.id}`}
                className="block bg-white rounded-2xl border-2 border-stone-200 hover:border-[#0B4619] p-4 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-extrabold text-stone-900 truncate">{c.name}</div>
                    {(c.phone || c.cpf || c.address || c.notes) && (
                      <div className="text-sm font-semibold text-stone-500 flex items-center gap-2 flex-wrap mt-0.5">
                        {c.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3.5 h-3.5" /> {c.phone}
                          </span>
                        )}
                        {c.cpf && <span>CPF: {c.cpf}</span>}
                        {c.address && <span className="truncate">{c.address}</span>}
                        {c.notes && <span className="truncate">({c.notes})</span>}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {isOverdue ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-red-100 text-red-900 border border-red-300 text-xs font-extrabold">
                          <AlertTriangle className="w-3.5 h-3.5" /> Atrasado
                        </span>
                      ) : hasDebt ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-100 text-amber-950 border border-amber-300 text-xs font-extrabold">
                          Vence {formatDateBR(c.next_due_date)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs font-extrabold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Tudo pago
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-xs font-bold text-stone-500">
                        {hasDebt ? 'Deve' : 'Saldo'}
                      </div>
                      <div
                        className={`text-xl font-black ${
                          isOverdue
                            ? 'text-red-700'
                            : hasDebt
                              ? 'text-orange-700'
                              : 'text-emerald-700'
                        }`}
                      >
                        {formatBRL(c.total_debt_cents)}
                      </div>
                      <div className="text-[11px] font-extrabold text-[#0B4619] mt-0.5">
                        {hasDebt ? 'Receber →' : 'Abrir →'}
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-stone-400" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Novo Cliente">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Nome <span className="text-orange-600">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Maria da Conceição"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-lg font-bold"
            />
          </div>
          <div>
            <label className="block text-base font-bold text-stone-800 mb-1.5">
              Telefone (opcional)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
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
              value={cpf}
              onChange={(e) => setCpf(formatCpfInput(e.target.value))}
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
              value={address}
              onChange={(e) => setAddress(e.target.value)}
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Casa verde perto da igreja, portão branco"
              className="w-full px-4 py-3.5 rounded-2xl border-2 border-stone-300 bg-white text-base font-bold"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] text-white font-extrabold text-lg"
          >
            {saving ? 'SALVANDO...' : 'SALVAR CLIENTE'}
          </button>
        </form>
      </Modal>
    </div>
  );
}
