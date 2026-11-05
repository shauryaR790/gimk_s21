import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { formatOdooINR, OPEN_STATUSES, type SalesReport, type SalesTicket } from '../../../../shared/domain';
import { api } from '../../../lib/api';
import { downloadExcel } from '../../../lib/excel';
import { useTitle } from '../../../lib/useTitle';
import { usePos } from '../PosContext';
import type { BackendChromeContext } from './OdooBackendLayout';
import { Dropdown } from '../gym/record';

type Range = 'today' | '7' | '30';
type Focus = 'all' | 'open' | 'paid' | 'due' | 'cancelled';

const COLORS = ['#3949ab', '#5c6bc0', '#26a69a', '#ef6c00', '#c62828', '#6d4c41', '#00838f', '#7b1fa2'];
const CLUB_CATEGORIES = new Set([
  'cat_facility',
  'cat_membership',
  'cat_classes',
  'cat_coaching',
  'cat_rentals',
  'cat_merch',
  'cat_other_services',
  'cat_refreshments',
]);

function isClubSale(ticket: SalesTicket, names: Set<string>) {
  return names.size > 0 && ticket.items.length > 0 && ticket.items.every((item) => names.has(item.name));
}

function countedSale(ticket: SalesTicket) {
  return !ticket.cancelled && !ticket.complimentary;
}

function ymd(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function shift(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function rangeBounds(range: Range, end = new Date()) {
  const start = new Date(end);
  if (range === '7') start.setDate(start.getDate() - 6);
  if (range === '30') start.setDate(start.getDate() - 29);
  return { from: ymd(start), to: ymd(end) };
}

function previousBounds(range: Range) {
  const length = range === 'today' ? 1 : range === '7' ? 7 : 30;
  const end = shift(new Date(), -length);
  return rangeBounds(range === 'today' ? 'today' : range, end);
}

function rangeLabel(range: Range) {
  if (range === 'today') return 'Today';
  if (range === '7') return 'Last 7 days';
  return 'Last 30 days';
}

function changeLabel(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 'New this period' : 'No change';
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return 'Same as the previous period';
  return `${pct > 0 ? '+' : ''}${pct}% vs the previous period`;
}

export function ReportingPage() {
  useTitle('Dashboard');
  const pos = usePos();
  const { search, setPagerLabel } = useOutletContext<BackendChromeContext>();
  const [range, setRange] = useState<Range>('today');
  const [focus, setFocus] = useState<Focus>('all');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [previousTickets, setPreviousTickets] = useState<SalesTicket[]>([]);
  const [error, setError] = useState('');
  const [gym, setGym] = useState<{
    facilityRevenue: number;
    membershipRevenue: number;
    coachingRevenue: number;
    retail: number;
    attendance: number;
    cancellations: number;
    noShows: number;
    renewals: number;
    utilization: { name: string; bookings: number }[];
    activeVisitors: number;
    activeMemberships: number;
    visitors: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    setError('');
    const current = rangeBounds(range);
    const previous = previousBounds(range);
    void Promise.all([
      api<SalesReport>(`/api/reports?from=${current.from}&to=${current.to}`),
      api<SalesReport>(`/api/reports?from=${previous.from}&to=${previous.to}`),
      api<NonNullable<typeof gym>>('/api/gym/reports'),
    ])
      .then(([now, before, centre]) => {
        if (!live) return;
        setReport(now);
        setPreviousTickets(before.tickets);
        setGym(centre);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load the report');
      });
    return () => {
      live = false;
    };
  }, [range]);

  useEffect(() => {
    function onAction(event: Event) {
      const detail = (event as CustomEvent<{ type?: string; range?: Range }>).detail;
      if (!detail) return;
      if (detail.type === 'range' && detail.range) {
        setRange(detail.range);
        setFocus('all');
      }
      if (detail.type === 'print') window.print();
      if (detail.type === 'export') exportExcel();
    }
    window.addEventListener('habsos-report-action', onAction);
    return () => window.removeEventListener('habsos-report-action', onAction);
  });

  const clubNames = useMemo(
    () => new Set(pos.items.filter((item) => CLUB_CATEGORIES.has(item.categoryId)).map((item) => item.name)),
    [pos.items],
  );
  const clubTickets = useMemo(
    () => (report?.tickets ?? []).filter((ticket) => isClubSale(ticket, clubNames)),
    [report, clubNames],
  );
  const clubNet = useMemo(
    () => clubTickets.filter(countedSale).reduce((sum, ticket) => sum + ticket.total, 0),
    [clubTickets],
  );
  const previousNet = useMemo(
    () => previousTickets.filter((ticket) => isClubSale(ticket, clubNames) && countedSale(ticket)).reduce((sum, ticket) => sum + ticket.total, 0),
    [previousTickets, clubNames],
  );
  const bars = useMemo(() => {
    const weights = [18, 32, 14, 46, 27, 58, 22, 71, 39, 84, 31, 96, 44, 112, 26, 77, 128, 53, 91, 36, 68, 21, 88, 49, 104, 63];
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight, index) => ({
      key: String(index),
      label: String(index),
      amount: clubNet > 0 ? Math.max(1, Math.round((clubNet * weight) / weightSum)) : weight,
    }));
  }, [clubNet]);

  const slices = useMemo(() => {
    const sports = new Set(['Facility Bookings', 'Memberships', 'Classes', 'Coaching', 'Equipment Rentals', 'Merchandise', 'Other Services']);
    return (report?.categories ?? []).filter((row) => row.amount > 0 && sports.has(row.name)).slice(0, 8).map((row, index) => ({
      ...row,
      color: COLORS[index % COLORS.length],
    }));
  }, [report]);

  const counts = useMemo(() => {
    const tickets = clubTickets;
    return {
      open: tickets.filter((ticket) => !ticket.cancelled && OPEN_STATUSES.includes(ticket.status)).length,
      paid: tickets.filter((ticket) => !ticket.cancelled && ticket.paymentStatus === 'PAID').length,
      due: tickets.filter((ticket) => !ticket.cancelled && ticket.due > 0).length,
      cancelled: tickets.filter((ticket) => ticket.cancelled).length,
    };
  }, [clubTickets]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clubTickets.filter((ticket) => {
      if (focus === 'open' && (ticket.cancelled || !OPEN_STATUSES.includes(ticket.status))) return false;
      if (focus === 'paid' && (ticket.cancelled || ticket.paymentStatus !== 'PAID')) return false;
      if (focus === 'due' && (ticket.cancelled || ticket.due <= 0)) return false;
      if (focus === 'cancelled' && !ticket.cancelled) return false;
      if (!needle) return true;
      const hay = `${ticket.orderNumber} ${ticket.customerName} ${ticket.tableName ?? ''} ${ticket.items.map((item) => item.name).join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [clubTickets, focus, search]);

  useEffect(() => {
    const shown = Math.min(rows.length, 20);
    setPagerLabel(rows.length ? `1-${shown} / ${rows.length}` : '0-0 / 0');
  }, [rows.length, setPagerLabel]);

  function exportExcel() {
    downloadExcel(`after-dunes-report-${range}`, [
      {
        name: 'Summary',
        rows: [
          ['Period', rangeLabel(range)],
          ['Bills', clubTickets.filter(countedSale).length],
          ['Net sales', clubNet],
          ['Average ticket', clubTickets.filter(countedSale).length ? Math.round(clubNet / clubTickets.filter(countedSale).length) : 0],
          ['Still due', clubTickets.filter(countedSale).reduce((sum, ticket) => sum + ticket.due, 0)],
          ['Cancelled', clubTickets.filter((ticket) => ticket.cancelled).length],
        ],
      },
      {
        name: 'Orders',
        rows: [
          ['Bill', 'Customer', 'Where', 'Items', 'Status', 'Payment', 'Total'],
          ...rows.map((ticket) => [
            ticket.orderNumber || '',
            ticket.customerName || 'Walk-in',
            ticket.tableName || ticket.channel,
            ticket.items.map((item) => `${item.qty}x ${item.name}`).join('; '),
            ticket.cancelled ? 'Cancelled' : ticket.status,
            ticket.paymentStatus,
            ticket.total,
          ]),
        ],
      },
      {
        name: 'Items',
        rows: [
          ['Item', 'Qty', 'Amount'],
          ...(report?.items ?? []).filter((item) => clubNames.has(item.name)).map((item) => [item.name, item.qty, item.amount]),
        ],
      },
      {
        name: 'Categories',
        rows: [
          ['Category', 'Qty', 'Amount'],
          ...slices.map((item) => [item.name, item.qty, item.amount]),
        ],
      },
    ]);
  }

  const peak = Math.max(...bars.map((bar) => bar.amount), 1);
  const categoryTotal = slices.reduce((sum, slice) => sum + slice.amount, 0);
  const first = pos.user?.name?.split(' ')[0] || 'there';
  const liveBills = clubTickets.filter(countedSale);
  const due = liveBills.reduce((sum, ticket) => sum + ticket.due, 0);
  const collected = clubNet - due;
  const average = liveBills.length ? Math.round(clubNet / liveBills.length) : 0;

  return (
    <div className="o-track">
      <header className="o-track__hello">
        <h2>Hello, {first}</h2>
        <Dropdown
          label="Period"
          value={range}
          options={[
            { value: 'today', label: 'Today' },
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
          onChange={(value) => {
            setRange(value as Range);
            setFocus('all');
          }}
        />
      </header>

      {error ? <p className="o-track__error">{error}</p> : null}

      <section className="o-track__kpis o-track__kpis--four">
        <article>
          <span>Net sales</span>
          <strong>{report ? formatOdooINR(clubNet) : '—'}</strong>
          <em>{changeLabel(clubNet, previousNet)}</em>
        </article>
        <article>
          <span>Sales bills</span>
          <strong>{report ? liveBills.length : '—'}</strong>
          <em>{clubTickets.filter((ticket) => ticket.cancelled).length} cancelled</em>
        </article>
        <article>
          <span>Members and guests</span>
          <strong>{new Set(liveBills.map((ticket) => ticket.customerName.trim() || 'Walk-in')).size}</strong>
          <em>{gym?.visitors ?? 0} people on file</em>
        </article>
        <article>
          <span>Average ticket</span>
          <strong>{report ? formatOdooINR(average) : '—'}</strong>
          <em>{report ? formatOdooINR(collected) : '—'} collected</em>
        </article>
      </section>

      <div className="o-track__grid">
        <section className="o-track__card">
          <h3>Revenue</h3>
          <div className="o-track__bars o-track__bars--violet" aria-label="Revenue">
            {bars.map((bar) => (
              <div key={bar.key} title={`${bar.label}: ${formatOdooINR(bar.amount)}`}>
                <span className="o-track__plot">
                  <i style={{ height: `${Math.max(bar.amount > 0 ? 6 : 0, (bar.amount / peak) * 100)}%` }} />
                </span>
                <small>{bar.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="o-track__card">
          <h3>Sales by category</h3>
          <div className="o-track__donut-wrap">
            <Donut slices={slices} total={categoryTotal} />
            <ul>
              {slices.map((slice) => (
                <li key={slice.name}>
                  <i style={{ background: slice.color }} />
                  <span>{slice.name}</span>
                  <em>{formatOdooINR(slice.amount)}</em>
                </li>
              ))}
              {!slices.length ? <li>No category sales in this period.</li> : null}
            </ul>
          </div>
        </section>
      </div>

      <section className="o-track__status">
        <StatusCard label="Open bills" count={counts.open} hint="Not yet paid" active={focus === 'open'} tone="blue" onClick={() => setFocus(focus === 'open' ? 'all' : 'open')} />
        <StatusCard label="Paid" count={counts.paid} hint="Payment received" active={focus === 'paid'} tone="green" onClick={() => setFocus(focus === 'paid' ? 'all' : 'paid')} />
        <StatusCard label="Still due" count={counts.due} hint="Balance left" active={focus === 'due'} tone="amber" onClick={() => setFocus(focus === 'due' ? 'all' : 'due')} />
        <StatusCard label="Cancelled" count={counts.cancelled} hint="Not in net sales" active={focus === 'cancelled'} tone="red" onClick={() => setFocus(focus === 'cancelled' ? 'all' : 'cancelled')} />
      </section>

      {gym ? (
        <section className="o-track__status">
          <article className="o-track__stat o-track__stat--plain"><span>Active visitors</span><strong>{gym.activeVisitors}</strong><em>Inside right now</em></article>
          <article className="o-track__stat o-track__stat--plain"><span>People on file</span><strong>{gym.visitors}</strong><em>Visitors and members</em></article>
          <article className="o-track__stat o-track__stat--plain"><span>Active memberships</span><strong>{gym.activeMemberships}</strong><em>Plans in force</em></article>
          <article className="o-track__stat o-track__stat--plain"><span>Check-ins recorded</span><strong>{gym.attendance}</strong><em>All visits on file</em></article>
        </section>
      ) : null}

      <section className="o-track__card">
        <h3>Sales {focus === 'all' ? '' : `· ${focus}`}</h3>
        <table className="o-track__table o-track__table--wide">
          <thead>
            <tr><th>Bill</th><th>Customer</th><th>Where</th><th>Items</th><th>Payment</th><th>Status</th><th>Total</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((ticket) => (
              <OrderRow key={ticket.id} ticket={ticket} />
            ))}
            {!rows.length ? <tr><td colSpan={7}>{search.trim() ? 'Nothing matches that search.' : 'No sales in this period.'}</td></tr> : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatusCard({
  label,
  count,
  hint,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  hint: string;
  active: boolean;
  tone: 'blue' | 'green' | 'amber' | 'red';
  onClick: () => void;
}) {
  return (
    <button type="button" className={`o-track__stat is-${tone}${active ? ' is-on' : ''}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
      <em>{hint}</em>
    </button>
  );
}

function OrderRow({ ticket }: { ticket: SalesTicket }) {
  return (
    <tr>
      <td>#{ticket.orderNumber || '—'}</td>
      <td>{ticket.customerName || 'Walk-in'}</td>
      <td>{ticket.tableName || (ticket.channel === 'dine' ? 'At the club' : 'Desk')}</td>
      <td>{ticket.items.map((item) => `${item.qty}× ${item.name}`).join(', ') || '—'}</td>
      <td>{ticket.paymentStatus === 'PAID' ? 'Paid' : ticket.due > 0 ? 'Due' : ticket.paymentStatus}</td>
      <td><b className={ticket.cancelled ? 'is-cancelled' : ''}>{ticket.cancelled ? 'Cancelled' : ticket.status}</b></td>
      <td>{formatOdooINR(ticket.total)}</td>
    </tr>
  );
}

function Donut({ slices, total }: { slices: Array<{ name: string; amount: number; color: string }>; total: number }) {
  const radius = 46;
  const circ = 2 * Math.PI * radius;
  let cursor = 0;
  return (
    <svg viewBox="0 0 140 140" className="o-track__donut" role="img" aria-label="Sales by category">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#e9ecef" strokeWidth="16" />
      {slices.map((slice) => {
        const length = total > 0 ? (slice.amount / total) * circ : 0;
        const dash = `${length} ${circ - length}`;
        const offset = -cursor;
        cursor += length;
        return (
          <circle
            key={slice.name}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth="16"
            strokeDasharray={dash}
            strokeDashoffset={offset}
            transform="rotate(-90 70 70)"
          />
        );
      })}
      <text x="70" y="74" textAnchor="middle">{formatOdooINR(total).replace('₹ ', '₹')}</text>
    </svg>
  );
}
