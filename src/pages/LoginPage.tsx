import React, { useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { api } from '../lib/api';
import { useFeedback } from '../components/FeedbackContext';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  isDefaultPassword: boolean;
}

export function LoginPage({ onSuccess }: { onSuccess: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { showError } = useFeedback();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api<{ user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, rememberMe: true }),
      });
      onSuccess(res.user);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[#FAF8F5] flex flex-col">
      <div className="h-2.5 w-full bg-[#0B4619] shrink-0" />

      <div className="flex-1 w-full max-w-md mx-auto flex flex-col justify-center px-6 py-8">
        <div className="flex flex-col items-center text-center mb-9">
          <img
            src="/logo.png"
            alt="Logo Cris Parambu"
            draggable={false}
            className="w-72 max-w-[82%] h-auto object-contain mb-4 select-none pointer-events-none"
          />
          <p className="text-base font-bold text-stone-600 max-w-xs leading-snug">
            Entre com sua conta autorizada para controlar vendas, fiados e aluguéis
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-extrabold text-stone-800 mb-1.5">
              Seu e-mail
            </label>
            <div className="flex items-center rounded-2xl border-2 border-stone-300 bg-white focus-within:border-[#0B4619] px-3.5 shadow-xs">
              <User className="w-5 h-5 text-stone-400 shrink-0" />
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-3.5 text-base font-bold text-stone-900 bg-transparent focus:outline-none"
                placeholder="seuemail@exemplo.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-extrabold text-stone-800 mb-1.5">
              Sua senha
            </label>
            <div className="flex items-center rounded-2xl border-2 border-stone-300 bg-white focus-within:border-[#0B4619] px-3.5 shadow-xs">
              <Lock className="w-5 h-5 text-stone-400 shrink-0" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-3.5 text-base font-bold text-stone-900 bg-transparent focus:outline-none"
                placeholder="Digite sua senha"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="p-2 text-stone-500 hover:text-stone-800"
                aria-label="Mostrar ou esconder senha"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-4 rounded-2xl bg-[#0B4619] hover:bg-[#115E2B] active:scale-[0.99] text-white font-extrabold text-lg tracking-wide shadow-md transition disabled:opacity-60"
          >
            {loading ? 'ENTRANDO...' : 'ENTRAR'}
          </button>
        </form>
      </div>
    </div>
  );
}
