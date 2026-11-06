import { lazy, Suspense, useLayoutEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingState } from './components/LoadingState';
import { ToastHost } from './components/Toast';
import { LoginPage } from './features/pos/LoginPage';
import { LoginPage as SiteLoginPage } from './features/site/LoginPage';
import { RegisterPage } from './features/site/RegisterPage';
import { SiteHome } from './features/site/SiteHome';
import { resetScrollLock } from './lib/scrollLock';

const PosShell = lazy(() => import('./features/pos/PosShell'));

function clearDocumentScrollLock() {
  resetScrollLock();
  const root = document.getElementById('root');
  for (const el of [document.documentElement, document.body, root]) {
    if (!el) continue;
    el.style.removeProperty('overflow');
    el.style.removeProperty('height');
    el.style.removeProperty('max-height');
  }
}

function ScrollUnlock() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    clearDocumentScrollLock();
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ScrollUnlock />
        <ToastHost />
        <Routes>
          <Route path="/" element={<SiteHome />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<SiteLoginPage />} />
          <Route path="/pos/login" element={<LoginPage />} />
          <Route path="/pos/*" element={<Suspense fallback={<div className="o-screen-state"><LoadingState label="Loading" /></div>}><PosShell /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
