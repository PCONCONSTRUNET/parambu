import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Home,
  Building2,
  LogOut,
  Package,
  ShoppingBag,
  Wallet,
} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface LayoutProps {
  title?: string;
  backTo?: string;
  userDisplayName: string;
  onLogout: () => void;
  children: React.ReactNode;
}

export function Layout({ title, backTo, userDisplayName, onLogout, children }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isHome = location.pathname === '/';
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const navItems = [
    { to: '/', label: 'Início', icon: Home, match: (p: string) => p === '/' },
    {
      to: '/vender',
      label: 'Vender',
      icon: ShoppingBag,
      match: (p: string) => p.startsWith('/vender') || p.startsWith('/vendas') || p.startsWith('/clientes'),
    },
    { to: '/produtos', label: 'Produtos', icon: Package, match: (p: string) => p.startsWith('/produtos') },
    { to: '/dinheiro', label: 'Dinheiro', icon: Wallet, match: (p: string) => p.startsWith('/dinheiro') },
    { to: '/alugueis', label: 'Aluguéis', icon: Building2, match: (p: string) => p.startsWith('/alugueis') },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-stone-900">
      {/* Top Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b-2 border-stone-300 px-4 py-3 shadow-xs">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2">
          {isHome ? (
            <Link to="/" className="flex items-center gap-3 min-w-0">
              <img
                src="/logo.png"
                alt="Cris Parambu"
                draggable={false}
                className="h-11 w-auto object-contain shrink-0 select-none pointer-events-none"
              />
              <div className="hidden sm:block text-sm font-bold text-stone-600 truncate">
                Olá, {userDisplayName}
              </div>
            </Link>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-stone-100 hover:bg-stone-200 active:scale-95 border-2 border-stone-300 font-extrabold text-stone-800 text-base shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
                Voltar
              </button>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-extrabold text-stone-900 truncate">
                  {title || 'Cris Parambu'}
                </h1>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0">
            {!isHome && (
              <Link to="/" aria-label="Início" className="hidden sm:block">
                <img
                  src="/logo.png"
                  alt="Cris Parambu"
                  draggable={false}
                  className="h-9 w-auto object-contain select-none pointer-events-none"
                />
              </Link>
            )}
            {installPrompt && (
              <button
                type="button"
                onClick={handleInstall}
                className="px-3 py-2 rounded-xl bg-orange-100 hover:bg-orange-200 border-2 border-orange-300 text-orange-900 font-bold text-sm flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Instalar App
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              title="Sair do sistema"
              className="px-3 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 border-2 border-stone-300 text-stone-700 font-bold text-sm flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 pt-4 pb-28">
        {children}
      </main>

      {/* Bottom Quick Bar */}
      <nav
        aria-label="Menu principal"
        className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t-2 border-stone-300 safe-bottom shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      >
        <div className="max-w-3xl mx-auto grid grid-cols-5 gap-1 px-1.5 pt-1.5">
          {navItems.map((item) => {
            const active = item.match(location.pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center justify-center py-2 px-1 rounded-2xl transition-colors border-2 ${
                  active
                    ? 'bg-[#0B4619] border-[#073311] text-white font-extrabold shadow-xs'
                    : 'border-transparent text-stone-600 hover:bg-stone-100 hover:border-stone-300 font-bold'
                }`}
              >
                <Icon className="w-6 h-6 mb-0.5" />
                <span className="text-xs leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
