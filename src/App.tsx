import { lazy, Suspense, useLayoutEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingState } from './components/LoadingState';
import { ToastHost } from './components/Toast';
import { LoginPage } from './features/pos/LoginPage';
import { GatePage } from './features/site/GatePage';
import { LoginPage as SiteLoginPage } from './features/site/LoginPage';
import { MemberBookingLog } from './features/site/MemberBookingLog';
import { MemberBookings } from './features/site/MemberBookings';
import { MemberHome } from './features/site/MemberHome';
import { MemberReport } from './features/site/MemberReport';
import { MemberShell } from './features/site/MemberShell';
import { RegisterPage } from './features/site/RegisterPage';
import { SiteHome } from './features/site/SiteHome';
import { SoftRoute } from './features/site/SoftRoute';
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
          <Route element={<SoftRoute />}>
            <Route path="/" element={<SiteHome />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<SiteLoginPage />} />
            <Route path="/in" element={<GatePage />} />
            <Route path="/in/:sport" element={<GatePage />} />
          </Route>
          <Route path="/member" element={<MemberShell />}>
            <Route index element={<MemberHome />} />
            <Route path="bookings" element={<MemberBookings />} />
            <Route path="bookings/mine" element={<MemberBookingLog />} />
            <Route path="report" element={<MemberReport />} />
          </Route>
          <Route path="/pos/login" element={<LoginPage />} />
          <Route path="/pos/*" element={<Suspense fallback={<div className="o-screen-state"><LoadingState label="Loading" /></div>}><PosShell /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
