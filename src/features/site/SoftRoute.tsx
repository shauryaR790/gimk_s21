import { Outlet, useLocation } from 'react-router-dom';
import './done.css';

/** Soft enter motion for public site routes. */
export function SoftRoute() {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="gk-route">
      <Outlet />
    </div>
  );
}
