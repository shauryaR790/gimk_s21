import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { CustomerSummary, MenuCategory, MenuItem, Order } from '../../../../shared/domain';
import { api } from '../../../lib/api';
import { downloadExcel, type ExcelSheet } from '../../../lib/excel';
import { usePos } from '../PosContext';

const NAV_MENUS = [
  {
    label: 'Operations',
    items: [
      { to: '/pos/backend/bookings', label: 'Bookings' },
      { to: '/pos/backend/shift', label: 'Shift' },
      { to: '/pos/backend/classes', label: 'Classes & Coaching' },
      { to: '/pos/backend/sessions', label: 'Sessions' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/pos/backend/visitors', label: 'Visitors' },
      { to: '/pos/backend/memberships', label: 'Memberships' },
      { to: '/pos/backend/membership-requests', label: 'Membership requests' },
      { to: '/pos/backend/trainer-requests', label: 'Trainer requests' },
      { to: '/pos/backend/employees', label: 'Employees' },
    ],
  },
  {
    label: 'Place',
    items: [
      { to: '/pos/backend/facilities', label: 'Facilities' },
      { to: '/pos/backend/maintenance', label: 'Maintenance' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { to: '/pos/backend/inventory', label: 'Inventory' },
    ],
  },
] as const;

export type ChromeView = 'list' | 'kanban' | 'activity';

export type ChromePager = {
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
};

export type BackendChromeContext = {
  search: string;
  setSearch: (value: string) => void;
  pagerLabel: string;
  setPagerLabel: (value: string) => void;
  view: ChromeView;
  setView: (value: ChromeView) => void;
  pager: ChromePager | null;
  setPager: (value: ChromePager | null) => void;
  listPath: string | null;
  setListPath: (value: string | null) => void;
};

function BrandMark() {
  return (
    <img
      src="/ui/gymkhana-mark.png"
      alt=""
      width={18}
      height={18}
      className="o-be-mark"
      draggable={false}
    />
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 8h12l-1 12H7L6 8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8V7a3 3 0 016 0v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="1" y="2" width="6" height="5" rx="1" />
      <rect x="9" y="2" width="6" height="5" rx="1" />
      <rect x="1" y="9" width="6" height="5" rx="1" />
      <rect x="9" y="9" width="6" height="5" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="1" y="2.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="7" width="14" height="2" rx="0.5" />
      <rect x="1" y="11.5" width="14" height="2" rx="0.5" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 1.5v3M11 1.5v3M2 6.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function defaultView(pathname: string): ChromeView {
  try {
    const stored = sessionStorage.getItem(`gk-view:${pathname}`);
    if (stored === 'list' || stored === 'kanban' || stored === 'activity') return stored;
  } catch {
    /* ignore */
  }
  if (/\/backend\/products\/[^/]+$/.test(pathname)) return 'list';
  if (pathname.includes('/backend/products') || pathname.includes('/backend/overview')) return 'kanban';
  return 'list';
}

function controlTitle(pathname: string) {
  if (pathname === '/pos' || pathname.endsWith('/pos') || pathname.includes('/backend/reporting') || pathname.endsWith('/reports')) return 'Dashboard';
  if (pathname.includes('/backend/overview')) return 'Overview';
  if (pathname.includes('/backend/bookings')) return 'Bookings';
  if (pathname.includes('/backend/orders')) return 'Bookings & Sales';
  if (pathname.includes('/backend/sessions')) return 'Sessions';
  if (pathname.includes('/backend/payments')) return 'Payments';
  if (pathname.includes('/backend/preparation')) return 'Activity Schedule';
  if (pathname.includes('/backend/membership-requests')) return 'Membership requests';
  if (pathname.includes('/backend/memberships')) return 'Memberships';
  if (pathname.includes('/backend/visitors') || pathname.includes('/backend/members')) return 'Visitors';
  if (pathname.includes('/backend/trainer-requests')) return 'Trainer requests';
  if (pathname.includes('/backend/plans')) return 'Memberships';
  if (pathname.includes('/backend/trainers')) return 'Trainers';
  if (pathname.includes('/backend/shift')) return 'Shift';
  if (pathname.includes('/backend/employees')) return 'Employees';
  if (pathname.includes('/backend/facilities')) return 'Facilities';
  if (pathname.includes('/backend/maintenance')) return 'Maintenance';
  if (pathname.includes('/backend/check-in')) return 'Check-in';
  if (pathname.includes('/backend/classes') || pathname.includes('/backend/participants')) return 'Classes & Coaching';
  if (pathname.includes('/backend/rentals')) return 'Equipment Rentals';
  if (pathname.includes('/backend/notifications')) return 'Notifications';
  if (pathname.includes('/backend/customers') || pathname.endsWith('/customers')) return 'Members';
  if (pathname.includes('/backend/products')) return 'Services & Products';
  if (pathname.includes('/backend/inventory') || pathname.endsWith('/inventory')) return 'Inventory';
  if (pathname.includes('/backend/config') || pathname.endsWith('/settings')) return 'Settings';
  if (pathname.endsWith('/menu')) return 'Menu';
  return 'Gymkhana';
}

export function OdooBackendLayout() {
  const { user, signOut, items, orders, customers, categories } = usePos();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const initial = (user?.name ?? 'S').trim().charAt(0).toUpperCase() || 'S';
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pagerLabel, setPagerLabel] = useState('0-0 / 0');
  const [view, setViewState] = useState<ChromeView>(() => defaultView(pathname));
  const [pager, setPager] = useState<ChromePager | null>(null);
  const [listPath, setListPath] = useState<string | null>(null);
  const ordersRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const title = controlTitle(pathname);

  function setView(next: ChromeView) {
    setViewState(next);
    const key = listPath || pathname;
    try {
      sessionStorage.setItem(`gk-view:${key}`, next);
    } catch {
      /* ignore */
    }
    if (listPath && pathname !== listPath) navigate(listPath);
  }

  useEffect(() => {
    if (!menuKey && !menuOpen && !titleOpen) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (menuKey && !ordersRef.current?.contains(target)) setMenuKey(null);
      if (menuOpen && !menuRef.current?.contains(target)) setMenuOpen(false);
      if (titleOpen && !titleRef.current?.contains(target)) setTitleOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuKey(null);
        setMenuOpen(false);
        setTitleOpen(false);
      }
    }
    // Use click (not mousedown) so the toggle button can open without racing the dismiss handler.
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuKey, menuOpen, titleOpen]);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  useEffect(() => {
    setMenuKey(null);
    setMenuOpen(false);
    setTitleOpen(false);
    setSearch('');
    setViewState(defaultView(pathname));
  }, [pathname]);

  return (
    <div className="odoo-pos odoo-pos--backend">
      <header className="o-be-nav o-be-nav--light">
        <div className="o-be-nav__brand">
          <BrandMark />
          <span>Gymkhana</span>
        </div>
        <nav className="o-be-nav__links">
          <NavLink to="/pos" end className={({ isActive }) => `o-be-nav__link${isActive ? ' is-active' : ''}`}>
            Dashboard
          </NavLink>

          {NAV_MENUS.map((menu) => {
            const sectionOn = menu.items.some((item) => pathname.startsWith(item.to));
            const opened = menuKey === menu.label;
            return (
              <div key={menu.label} className={`o-be-nav__menu${opened ? ' is-open' : ''}`} ref={opened ? ordersRef : undefined}>
                <button
                  type="button"
                  className={`o-be-nav__link o-be-nav__link--menu${sectionOn ? ' is-active' : ''}${opened ? ' is-open' : ''}`}
                  aria-expanded={opened}
                  aria-haspopup="menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuKey((current) => (current === menu.label ? null : menu.label));
                  }}
                >
                  {menu.label}
                </button>
                {opened ? (
                  <div className="o-be-dropdown" role="menu" onClick={(e) => e.stopPropagation()}>
                    {menu.items.map((item) => (
                      <button
                        key={item.to}
                        type="button"
                        role="menuitem"
                        className={`o-be-dropdown__item${pathname.startsWith(item.to) ? ' is-on' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuKey(null);
                          navigate(item.to);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <NavLink to="/pos/backend/products" className={({ isActive }) => `o-be-nav__link${isActive ? ' is-active' : ''}`}>
            Services & Products
          </NavLink>
          <NavLink to="/pos/backend/config" className={({ isActive }) => `o-be-nav__link${isActive ? ' is-active' : ''}`}>
            Settings
          </NavLink>
        </nav>
        <div className="o-be-nav__right">
          <label className="o-search o-search--nav">
            <SearchIcon />
            <input
              placeholder="Search services..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="o-icon-btn"
            aria-label="Bag"
            onClick={() => navigate('/pos/backend/products')}
          >
            <BagIcon />
          </button>
          <button
            type="button"
            className="o-avatar o-avatar--bw"
            title={user?.name ?? 'Account'}
            onClick={() => void signOut().then(() => navigate('/pos/login'))}
          >
            {initial}
          </button>
          <div className="o-be-nav__menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="o-icon-btn"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
            >
              <MenuIcon />
            </button>
            {menuOpen ? (
              <div className="o-be-dropdown o-be-dropdown--right" role="menu" onClick={(e) => e.stopPropagation()}>
                <button type="button" role="menuitem" className="o-be-dropdown__item" onClick={() => { setMenuOpen(false); navigate('/pos/app/register'); }}>
                  Open POS
                </button>
                <button type="button" role="menuitem" className="o-be-dropdown__item" onClick={() => { setMenuOpen(false); navigate('/pos/backend/products'); }}>
                  Services & Products
                </button>
                <button type="button" role="menuitem" className="o-be-dropdown__item" onClick={() => { setMenuOpen(false); navigate('/pos/backend/visitors'); }}>
                  Visitors
                </button>
                <button type="button" role="menuitem" className="o-be-dropdown__item" onClick={() => { setMenuOpen(false); navigate('/pos/backend/notifications'); }}>
                  Notifications
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="o-be-dropdown__item"
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut().then(() => navigate('/pos/login'));
                  }}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="o-be-control">
        <div className="o-be-control__left">
          {pathname.includes('/backend/preparation') ? (
            <button type="button" className="o-prep-new" onClick={() => navigate('/pos/prep')}>New</button>
          ) : null}
          <div className="o-be-control__title">{title}</div>
          <div className="o-be-title-menu" ref={titleRef}>
            <button
              type="button"
              className="o-be-icon o-be-icon--dots"
              aria-label="Actions"
              aria-expanded={titleOpen}
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation();
                setTitleOpen((open) => !open);
              }}
            >
              <DotsIcon />
            </button>
            {titleOpen ? (
              <div className="o-be-dropdown" role="menu" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  role="menuitem"
                  className="o-be-dropdown__item"
                  onClick={() => {
                    setTitleOpen(false);
                    if (pathname === '/pos' || pathname.endsWith('/pos') || pathname.includes('/backend/reporting')) {
                      window.dispatchEvent(new CustomEvent('habsos-report-action', { detail: { type: 'export' } }));
                      return;
                    }
                    void exportPageExcel(pathname, { items, orders, customers, categories });
                  }}
                >
                  Export to Excel
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <label className="o-be-search">
          <SearchIcon />
          <input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="o-be-control__right">
          <span className="o-be-pager">{pagerLabel}</span>
          <div className="o-be-page-btns">
            <button type="button" className="o-be-icon o-be-icon--bare" aria-label="Previous" disabled={!pager?.canPrev} onClick={() => pager?.onPrev()}>
              <ChevronIcon dir="left" />
            </button>
            <button type="button" className="o-be-icon o-be-icon--bare" aria-label="Next" disabled={!pager?.canNext} onClick={() => pager?.onNext()}>
              <ChevronIcon dir="right" />
            </button>
          </div>
          <div className="o-be-view-switch">
            <button
              type="button"
              className={`o-be-icon o-be-icon--bare${view === 'list' ? ' is-on' : ''}`}
              aria-label="List"
              onClick={() => setView('list')}
            >
              <ListIcon />
            </button>
            <button
              type="button"
              className={`o-be-icon o-be-icon--bare${view === 'kanban' ? ' is-on' : ''}`}
              aria-label="Kanban"
              onClick={() => setView('kanban')}
            >
              <KanbanIcon />
            </button>
            <button
              type="button"
              className={`o-be-icon o-be-icon--bare${view === 'activity' ? ' is-on' : ''}`}
              aria-label="Activity"
              onClick={() => setView('activity')}
            >
              <ActivityIcon />
            </button>
          </div>
        </div>
      </div>

      <div className="o-be-body">
        <Outlet context={{ search, setSearch, pagerLabel, setPagerLabel, view, setView, pager, setPager, listPath, setListPath } satisfies BackendChromeContext} />
      </div>
    </div>
  );
}

async function exportPageExcel(pathname: string, data: {
  items: MenuItem[];
  orders: Order[];
  customers: CustomerSummary[];
  categories: MenuCategory[];
}) {
  const categoryName = (id: string) => data.categories.find((category) => category.id === id)?.name ?? '';
  if (pathname.includes('/backend/products') || pathname.includes('/menu')) {
    downloadExcel('after-dunes-products', [{
      name: 'Products',
      rows: [
        ['Name', 'Category', 'Price', 'Available', 'Veg', 'Ingredients'],
        ...data.items.map((item) => [
          item.name,
          categoryName(item.categoryId),
          item.price,
          item.isAvailable ? 'Yes' : 'No',
          item.isVeg ? 'Veg' : 'Non-veg',
          item.ingredients.join(', '),
        ]),
      ],
    }]);
    return;
  }
  if (pathname.includes('/backend/orders') || pathname.includes('/app/orders')) {
    downloadExcel('after-dunes-orders', [{
      name: 'Orders',
      rows: [
        ['Bill', 'Customer', 'Mobile', 'Table', 'Status', 'Payment', 'Total', 'Created'],
        ...data.orders.map((order) => [
          order.orderNumber,
          order.customerName,
          order.customerMobile,
          order.tableName ?? '',
          order.status,
          order.paymentStatus,
          order.total,
          new Date(order.createdAt).toLocaleString(),
        ]),
      ],
    }]);
    return;
  }
  if (pathname.includes('/customers')) {
    downloadExcel('after-dunes-customers', [{
      name: 'Customers',
      rows: [
        ['Name', 'Mobile', 'Orders', 'Spent', 'Last order'],
        ...data.customers.map((customer) => [
          customer.name,
          customer.mobile,
          customer.orderCount,
          customer.spent,
          customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleString() : '',
        ]),
      ],
    }]);
    return;
  }
  if (pathname.includes('/inventory')) {
    const bundle = await api<{
      items: { name: string; sku: string; qty: number; unit: string; reorderLevel: number; costPerUnit: number; supplier: string; lowStock: boolean }[];
      movements: { createdAt: string; itemName: string; kind: string; qtyDelta: number; notes: string }[];
    }>('/api/inventory');
    const sheets: ExcelSheet[] = [
      {
        name: 'Stock',
        rows: [
          ['Item', 'SKU', 'On hand', 'Unit', 'Reorder', 'Cost', 'Supplier', 'Low'],
          ...bundle.items.map((item) => [item.name, item.sku, item.qty, item.unit, item.reorderLevel, item.costPerUnit, item.supplier, item.lowStock ? 'Yes' : 'No']),
        ],
      },
      {
        name: 'Movements',
        rows: [
          ['When', 'Item', 'Kind', 'Qty', 'Notes'],
          ...bundle.movements.map((move) => [new Date(move.createdAt).toLocaleString(), move.itemName, move.kind, move.qtyDelta, move.notes]),
        ],
      },
    ];
    downloadExcel('after-dunes-inventory', sheets);
    return;
  }
  if (pathname.includes('/sessions')) {
    const result = await api<{ sessions: { configName: string; status: string; openedAt: string; openingCash: number; countedCash: number | null }[] }>('/api/pos/sessions');
    downloadExcel('after-dunes-sessions', [{
      name: 'Sessions',
      rows: [
        ['Register', 'Status', 'Opened', 'Opening cash', 'Counted'],
        ...result.sessions.map((session) => [
          session.configName,
          session.status,
          new Date(session.openedAt).toLocaleString(),
          session.openingCash,
          session.countedCash ?? '',
        ]),
      ],
    }]);
    return;
  }
  downloadExcel('after-dunes-orders', [{
    name: 'Orders',
    rows: [
      ['Bill', 'Customer', 'Table', 'Status', 'Payment', 'Total'],
      ...data.orders.map((order) => [order.orderNumber, order.customerName, order.tableName ?? '', order.status, order.paymentStatus, order.total]),
    ],
  }]);
}
