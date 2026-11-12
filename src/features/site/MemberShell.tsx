import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { clearMemberPass } from '../../lib/memberPass';
import { SilkFilm } from './silk';
import './done.css';
import './site.css';
import './member.css';

export type MemberCard = {
  name: string;
  memberCode: string;
  membershipStatus: string;
  startsAt?: string | null;
  expiresAt: string | null;
  registeredAt?: string;
  activities?: string[];
  accessInterest?: string;
  photoUrl?: string;
};

export type MemberRequest = {
  id: string;
  kind: 'JOIN' | 'SESSION' | 'REPORT';
  sport: string;
  status: string;
  notes: string;
  preferredSlot: string;
  preferredSlotLabel: string;
  createdAt: string;
};

export type MemberCtx = {
  member: MemberCard;
  announcements: { id: string; title: string; body: string; created_at: string }[];
  sessions: MemberRequest[];
  reload: () => void;
};

type Home = {
  member: { member: MemberCard } | null;
  announcements?: { id: string; title: string; body: string; created_at: string }[];
  sessions?: MemberRequest[];
};

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/member', label: 'Dashboard', end: true },
  { to: '/member/bookings/mine', label: 'My Bookings', end: false },
  { to: '/member/bookings', label: 'Bookings', end: true },
  { to: '/member/report', label: 'Report', end: false },
];

export function MemberShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [home, setHome] = useState<Home | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    document.title = 'Gymkhana';
    document.documentElement.classList.add('gkm-page');
    document.body.classList.add('gkm-page');
    return () => {
      document.documentElement.classList.remove('gkm-page');
      document.body.classList.remove('gkm-page');
    };
  }, []);

  useEffect(() => {
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  function load() {
    return api<Home>('/api/portal/home')
      .then((data) => {
        if (!data.member?.member) {
          navigate('/login', { replace: true });
          return;
        }
        setHome(data);
      })
      .catch((err: unknown) => {
        clearMemberPass();
        navigate('/login', { replace: true, state: { error: err instanceof Error ? err.message : 'Sign in again.' } });
      });
  }

  useEffect(() => {
    void load();
  }, [navigate]);

  const member = home?.member?.member;
  if (!member) {
    return (
      <main className="gkm">
        <SilkFilm className="gkm-film" />
      </main>
    );
  }

  const ctx: MemberCtx = {
    member,
    announcements: home.announcements ?? [],
    sessions: home.sessions ?? [],
    reload: load,
  };

  return (
    <main className={`gkm${menu ? ' is-menu' : ''}`}>
      <SilkFilm className="gkm-film" />
      <button
        type="button"
        className="gkm-burger"
        aria-label={menu ? 'Close menu' : 'Open menu'}
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        <span /><span /><span />
      </button>
      <div className={`gkm-veil${menu ? ' is-on' : ''}`} onClick={() => setMenu(false)} />
      <aside className={`gkm-side${menu ? ' is-open' : ''}`} aria-hidden={!menu}>
        <button type="button" className="gkm-side__close" aria-label="Close menu" onClick={() => setMenu(false)}>
          <span /><span /><span />
        </button>
        <nav className="gkm-side__nav">
          {LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `gkm-side__link${isActive ? ' is-on' : ''}`}>
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div key={pathname} className="gk-route gkm-route">
        <Outlet context={ctx} />
      </div>
    </main>
  );
}
