import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, preloadImageUrls } from './lib/api';
import { monthStartLocalISO, todayLocalISO } from './lib/format';
import { FeedbackProvider } from './components/FeedbackContext';
import { Layout } from './components/Layout';
import { LoginPage, type AuthUser } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { ProductsPage } from './pages/ProductsPage';
import { SellPage } from './pages/SellPage';
import { SalesHistoryPage } from './pages/SalesHistoryPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { MoneyPage } from './pages/MoneyPage';
import { RentalsPage } from './pages/RentalsPage';
import { PropertyDetailPage } from './pages/PropertyDetailPage';

function monthEndLocalISO(): string {
  const [y, m] = todayLocalISO().split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function warmInitialCache() {
  const financeQs = new URLSearchParams({
    from: monthStartLocalISO(),
    to: monthEndLocalISO(),
    direction: 'ALL',
  }).toString();

  void Promise.allSettled([
    api('/dashboard'),
    api<{ products: Array<{ photo_url?: string | null }> }>('/products').then((res) => {
      preloadImageUrls(res.products.map((p) => p.photo_url));
      return res;
    }),
    api('/products/movements'),
    api('/customers?filter=all'),
    api('/customers'),
    api('/rentals/overview'),
    api(`/finance?${financeQs}`),
  ]);
}

function AppRoutes() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const checkMe = useCallback(async () => {
    const startMs =
      (window as Window & { __APP_SPLASH_START__?: number }).__APP_SPLASH_START__ ??
      performance.now();

    try {
      const res = await api<{ user: AuthUser | null }>('/auth/me');
      setUser(res.user);
      if (res.user) {
        warmInitialCache();
      }
    } catch {
      setUser(null);
    } finally {
      const elapsed = performance.now() - startMs;
      const minSplashMs = 3000;
      if (elapsed < minSplashMs) {
        await new Promise((resolve) => window.setTimeout(resolve, minSplashMs - elapsed));
      }

      setCheckingAuth(false);

      const splashEl = document.getElementById('app-splash');
      if (splashEl) {
        splashEl.classList.add('is-hiding');
        window.setTimeout(() => splashEl.remove(), 340);
      }
    }
  }, []);

  useEffect(() => {
    checkMe();
  }, [checkMe]);

  const handleLogout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  };

  if (checkingAuth) {
    return <div className="min-h-screen bg-[#FAF8F5]" />;
  }

  if (!user) {
    return (
      <LoginPage
        onSuccess={(loggedInUser) => {
          setUser(loggedInUser);
          warmInitialCache();
        }}
      />
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Layout userDisplayName={user.displayName} onLogout={handleLogout}>
            <HomePage />
          </Layout>
        }
      />
      <Route
        path="/vender"
        element={
          <Layout title="Vender" backTo="/" userDisplayName={user.displayName} onLogout={handleLogout}>
            <SellPage />
          </Layout>
        }
      />
      <Route
        path="/vendas"
        element={
          <Layout
            title="Vendas Feitas"
            backTo="/vender"
            userDisplayName={user.displayName}
            onLogout={handleLogout}
          >
            <SalesHistoryPage />
          </Layout>
        }
      />
      <Route
        path="/produtos"
        element={
          <Layout title="Produtos" backTo="/" userDisplayName={user.displayName} onLogout={handleLogout}>
            <ProductsPage />
          </Layout>
        }
      />
      <Route
        path="/clientes"
        element={
          <Layout
            title="Clientes e Fiados"
            userDisplayName={user.displayName}
            onLogout={handleLogout}
          >
            <CustomersPage />
          </Layout>
        }
      />
      <Route
        path="/clientes/:id"
        element={
          <Layout
            title="Conta do Cliente"
            backTo="/clientes"
            userDisplayName={user.displayName}
            onLogout={handleLogout}
          >
            <CustomerDetailPage />
          </Layout>
        }
      />
      <Route
        path="/dinheiro"
        element={
          <Layout title="Dinheiro e Pagamentos" backTo="/" userDisplayName={user.displayName} onLogout={handleLogout}>
            <MoneyPage />
          </Layout>
        }
      />
      <Route
        path="/alugueis"
        element={
          <Layout title="Aluguéis" backTo="/" userDisplayName={user.displayName} onLogout={handleLogout}>
            <RentalsPage />
          </Layout>
        }
      />
      <Route
        path="/alugueis/:id"
        element={
          <Layout
            title="Detalhes do Imóvel"
            backTo="/alugueis"
            userDisplayName={user.displayName}
            onLogout={handleLogout}
          >
            <PropertyDetailPage />
          </Layout>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <FeedbackProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </FeedbackProvider>
  );
}

export default App;
