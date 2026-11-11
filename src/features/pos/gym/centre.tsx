import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { formatINR } from '../../../../shared/domain';
import { ARENA_SLOTS, arenaSlug } from '../../../../shared/activities';
import { priorityLabel } from '../../../../shared/maintenance';
import { api } from '../../../lib/api';
import { printActivityQr } from '../../../lib/printQr';
import { useTitle } from '../../../lib/useTitle';
import { pushToast } from '../../../components/Toast';
import { getDeskMode } from '../staffSession';
import { ChromePagerTools, type BackendChromeContext } from '../odoo/OdooBackendLayout';
import { ChromeRecords, type BoardItem } from '../odoo/chrome';
import { BOOKING_STAGES, BOOKING_STATUS, BookingStages, bookingStageClass, Dropdown, describeAction, whenText } from './record';
import { JOIN_STATUS, joinPayment, type JoinRequest } from './forms';
import { stashSelectedMembers } from './comms';

type Member = {
  id: string;
  name: string;
  mobile: string;
  email: string;
  memberCode: string;
  membershipStatus: string;
  planName: string;
  expiresAt: string | null;
  accessInterest?: string;
  govtIdLabel?: string;
  coachName?: string;
  isMember?: boolean;
  hereNow?: string;
  hereSport?: string;
  lastInAt?: string;
  visits?: number;
  tappedToday?: boolean;
  consentStatus?: string;
  lastWhatsAppAt?: string;
  lastWhatsAppStatus?: string;
  hasUpcoming?: boolean;
};

type Facility = {
  id: string;
  name: string;
  sport: string;
  location: string;
  capacity: number;
  opensAt: string;
  closesAt: string;
  memberPrice: number;
  guestPrice: number;
  isAvailable: boolean;
  maintenanceStatus: string;
  visitorCount?: number;
  using?: { name: string; member: boolean; coach: string }[];
};

function facilityStage(facility: Facility) {
  const open = facility.isAvailable && facility.maintenanceStatus === 'OK';
  if (!open) return { label: 'Closed', className: 'gk-pill is-closed' };
  if ((facility.visitorCount ?? 0) >= facility.capacity) return { label: 'Fully occupied', className: 'gk-pill is-full' };
  return { label: 'Active', className: 'gk-pill is-active' };
}

type Plan = {
  id: string;
  name: string;
  durationDays: number;
  price: number;
  description: string;
  facilityAccess: string;
  bookingPrivileges: string;
  discountBps: number;
  guestPasses: number;
  renewalDays: number;
  freezeDays: number;
  isActive: boolean;
};

type Booking = {
  id: string;
  memberName: string;
  sport: string;
  facility: string;
  facilityId: string;
  startAt: string;
  endAt: string;
  participants: number;
  amount: number;
  paymentStatus: string;
  status: string;
};

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this page.');
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function Shell({ title, children, error }: { title: string; children: ReactNode; error?: string }) {
  useTitle(title);
  return (
    <section className="o-track">
      {error ? <p className="o-track__error">{error}</p> : null}
      {children}
    </section>
  );
}

function take<T extends { id: string }>(rows: T[], page: BoardItem[]) {
  const map = new Map(rows.map((row) => [row.id, row]));
  return page.map((item) => map.get(item.id)).filter((row): row is T => Boolean(row));
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="o-track__hello">
      <h2>{title}</h2>
      {children ? <div className="gk-head-actions">{children}</div> : null}
    </header>
  );
}

const MEMBER_CSV_TEMPLATE = `name,mobile,email,plan,activity,trainer,notes
Asha Menon,9811110001,asha@example.com,Monthly,Badminton,,
Kabir Seth,9811110002,,Quarterly,Gym,,
`;

type MemberCsvIssue = { row: number; name: string; reason: string };
type MemberCsvResult = { created: number; skipped: number; errors: MemberCsvIssue[]; skippedRows: MemberCsvIssue[] };

function PeopleActions({
  addLabel,
  onAdd,
  onImported,
}: {
  addLabel: string;
  onAdd: () => void;
  onImported: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const chrome = useOutletContext<BackendChromeContext>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MemberCsvResult | null>(null);

  function downloadTemplate() {
    const blob = new Blob([MEMBER_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gymkhana-members.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function takeFile(file?: File | null) {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const csv = await file.text();
      const data = await api<MemberCsvResult>('/api/gym/members/import', { method: 'POST', body: JSON.stringify({ csv }) });
      setResult(data);
      setOpen(true);
      if (data.created) {
        pushToast(data.created === 1 ? '1 member added from CSV' : `${data.created} members added from CSV`);
        await onImported();
      } else if (!data.errors.length) {
        pushToast('No new members in that file.');
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not read that CSV.', 'err');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <>
      <header className="o-track__hello gk-user-head">
        <button type="button" className="gk-btn" aria-expanded={open} disabled={busy} onClick={() => setOpen((value) => !value)}>
          {busy ? 'Uploading…' : 'Upload CSV'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={(event: ChangeEvent<HTMLInputElement>) => void takeFile(event.target.files?.[0])}
        />
        <ChromePagerTools
          search={chrome.search}
          setSearch={chrome.setSearch}
          pagerLabel={chrome.pagerLabel}
          pager={chrome.pager}
          view={chrome.view}
          setView={chrome.setView}
        />
        <button type="button" className="gk-btn" onClick={onAdd}>{addLabel}</button>
      </header>
      {open ? (
        <div className="gk-csv">
          <p>Upload a CSV of members. Needed columns are <strong>name</strong> and <strong>mobile</strong>. Optional: email, plan, activity, trainer, notes.</p>
          <div className="gk-csv__actions">
            <button type="button" className="gk-btn" onClick={downloadTemplate}>Download template</button>
            <button type="button" className="gk-btn" disabled={busy} onClick={() => fileRef.current?.click()}>Choose file</button>
          </div>
          {result ? (
            <>
              <p className="gk-csv__result">
                Added {result.created}. Skipped {result.skipped} already on file.
                {result.errors.length ? ` ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} need a fix.` : ''}
              </p>
              {result.errors.length || result.skippedRows.length ? (
                <ul className="gk-csv__errors">
                  {result.errors.slice(0, 8).map((row) => (
                    <li key={`err-${row.row}-${row.reason}`}>Row {row.row} · {row.name} — {row.reason}</li>
                  ))}
                  {result.skippedRows.slice(0, 4).map((row) => (
                    <li key={`skip-${row.row}-${row.reason}`}>Row {row.row} · {row.name} — {row.reason}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

function dayLabel(ymd: string, today: string) {
  if (ymd === today) return 'Today';
  const noon = Date.parse(`${ymd}T12:00:00+05:30`);
  if (Date.parse(`${today}T12:00:00+05:30`) - noon === 86_400_000) return 'Yesterday';
  return new Date(noon).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function elapsed(iso: string, until?: string | null) {
  const ms = (until ? new Date(until).getTime() : Date.now()) - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function stop(event: MouseEvent) {
  event.stopPropagation();
}

async function act(work: () => Promise<unknown>, done: string, reload: () => Promise<void>) {
  try {
    await work();
    pushToast(done);
    await reload();
  } catch (err) {
    pushToast(err instanceof Error ? err.message : 'That did not work.', 'err');
  }
}

const MEMBER_WA_FILTERS = [
  { value: '', label: 'This tab' },
  { value: 'expired', label: 'Expired memberships' },
  { value: 'expiring7', label: 'Expiring in 7 days' },
  { value: 'expiring14', label: 'Expiring in 14 days' },
  { value: 'expiring30', label: 'Expiring in 30 days' },
  { value: 'registered_recent', label: 'Recently registered' },
  { value: 'renewed_recent', label: 'Recently renewed' },
  { value: 'upcoming_bookings', label: 'Upcoming bookings' },
  { value: 'no_upcoming', label: 'No upcoming bookings' },
  { value: 'with_trainer', label: 'Assigned to a trainer' },
  { value: 'no_trainer', label: 'No trainer' },
  { value: 'wa_opted_in', label: 'WhatsApp opted in' },
  { value: 'wa_unknown', label: 'Unknown consent' },
  { value: 'wa_opted_out', label: 'Opted out' },
  { value: 'invalid_phone', label: 'Invalid phone' },
];

function waLabel(status?: string) {
  if (status === 'OPT_IN') return 'Opted in';
  if (status === 'OPT_OUT') return 'Opted out';
  return 'Unknown';
}

export function MembersPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tab = params.get('tab') || 'all';
  const [extraFilter, setExtraFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [sport, setSport] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const tabFilter = tab === 'in' ? 'in' : tab === 'members' ? 'ACTIVE' : tab === 'expiring' ? 'expiring' : 'all';
  const filter = extraFilter || tabFilter;
  const query = new URLSearchParams({ filter });
  if (sport) query.set('sport', sport);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const people = useLoad<{ members: Member[] }>(`/api/gym/members?${query.toString()}`);
  const plansLoad = useLoad<{ plans: Plan[] }>('/api/gym/plans');
  const facs = useLoad<{ facilities: Facility[] }>('/api/gym/facilities');
  const members = people.data?.members ?? [];
  const sports = Array.from(new Set((facs.data?.facilities ?? []).map((row) => row.sport).filter(Boolean))).sort();
  const plans = plansLoad.data?.plans ?? [];
  useEffect(() => {
    if (tab === 'requests' || tab === 'plans') return;
    const timer = window.setInterval(() => { void people.reload(); }, 8000);
    return () => window.clearInterval(timer);
  }, [tab, people.reload]);
  if (tab === 'requests') {
    return (
      <Shell title="Active users">
        <PeopleActions
          addLabel="Add member"
          onAdd={() => navigate('/pos/backend/people/new')}
          onImported={people.reload}
        />
        <JoinRequestsList route="STAFF" embedded />
      </Shell>
    );
  }
  const error = tab === 'plans' ? plansLoad.error : people.error;
  return (
    <Shell title="Active users" error={error}>
      <PeopleActions
        addLabel={tab === 'plans' ? 'Create plan' : 'Add member'}
        onAdd={() => navigate(tab === 'plans' ? '/pos/backend/plans/new' : '/pos/backend/people/new')}
        onImported={people.reload}
      />
      {tab !== 'plans' ? (
        <div className="gk-comms-filters">
          <Dropdown label="Audience" value={extraFilter} options={MEMBER_WA_FILTERS} onChange={(value) => { setExtraFilter(value); setPicked([]); }} />
          <Dropdown label="Sport" value={sport} options={[{ value: '', label: 'Any sport' }, ...sports.map((row) => ({ value: row, label: row }))]} onChange={setSport} />
          <label>Registered from <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>to <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button type="button" className="gk-btn gk-btn--sm" onClick={() => setPicked(members.filter((row) => row.consentStatus === 'OPT_IN').map((row) => row.id))}>Select eligible</button>
          <button
            type="button"
            className="gk-btn gk-btn--sm"
            disabled={!picked.length}
            onClick={() => { stashSelectedMembers(picked); navigate('/pos/backend/communications/compose'); }}
          >
            Send WhatsApp
          </button>
        </div>
      ) : null}
      {tab === 'plans' ? (
        <ChromeRecords
          items={plans.map((plan) => ({
            id: plan.id,
            title: plan.name,
            subtitle: `${plan.durationDays} days`,
            meta: plan.isActive ? 'Active plan' : 'Off',
            href: `/pos/backend/plans/${plan.id}`,
          }))}
          empty="No plans yet — create one from this page"
        >
          {(page) => (
            <table className="o-be-table gk-table">
              <thead><tr><th>Plan</th><th>Days</th><th>Price</th><th>Discount</th><th>Guest passes</th><th>Freeze</th><th>Access</th><th>Status</th><th /></tr></thead>
              <tbody>
                {take(plans, page).map((plan) => (
                  <tr key={plan.id} className="is-link" onClick={() => navigate(`/pos/backend/plans/${plan.id}`)}>
                    <td><strong>{plan.name}</strong><div className="gk-muted">{plan.description || '—'}</div></td>
                    <td>{plan.durationDays}</td>
                    <td>{formatINR(plan.price)}</td>
                    <td>{plan.discountBps / 100}%</td>
                    <td>{plan.guestPasses}</td>
                    <td>{plan.freezeDays} days</td>
                    <td>{plan.facilityAccess === 'ALL' ? 'All facilities' : plan.facilityAccess}</td>
                    <td>{plan.isActive ? 'Active' : 'Off'}</td>
                    <td className="gk-actions" onClick={stop}>
                      <button
                        type="button"
                        className="gk-btn gk-btn--sm"
                        onClick={() => void act(() => api(`/api/gym/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ ...plan, isActive: !plan.isActive }) }), plan.isActive ? 'Plan turned off' : 'Plan turned on', plansLoad.reload)}
                      >
                        {plan.isActive ? 'Turn off' : 'Turn on'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!plans.length ? <tr><td colSpan={9} className="o-be-table__empty">No plans yet — create one from this page</td></tr> : null}
              </tbody>
            </table>
          )}
        </ChromeRecords>
      ) : (
        <ChromeRecords
          items={members.map((member) => ({
            id: member.id,
            title: member.name,
            subtitle: `${member.mobile} ${member.memberCode} ${member.govtIdLabel ?? ''} ${member.hereSport || member.hereNow || ''} ${member.consentStatus ?? ''}`,
            meta: member.hereNow ? `In ${member.hereSport || member.hereNow}` : member.planName || member.membershipStatus,
            href: `/pos/backend/people/${member.id}`,
            when: member.lastInAt || undefined,
          }))}
          empty={tab === 'in' ? 'No one is in yet — they appear here after they scan the court QR' : 'No members yet — add one from this page'}
        >
          {(page) => (
            <table className="o-be-table gk-table">
              <thead>
                <tr>
                  <th />
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Member ID</th>
                  <th>Plan</th>
                  <th>Expires</th>
                  <th>WhatsApp</th>
                  <th>Last message</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {take(members, page).map((member) => (
                  <tr key={member.id} className="is-link" onClick={() => navigate(`/pos/backend/people/${member.id}`)}>
                    <td className="gk-actions" onClick={stop}>
                      <input
                        type="checkbox"
                        checked={picked.includes(member.id)}
                        aria-label={`Select ${member.name}`}
                        onChange={() => setPicked((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}
                      />
                    </td>
                    <td>
                      <strong>{member.name}</strong>
                      <div className="gk-muted">{member.hereNow ? (member.hereSport || member.hereNow) : member.memberCode}{member.isMember ? ' · Member' : ''}</div>
                    </td>
                    <td>{member.mobile}</td>
                    <td>{member.email || '—'}</td>
                    <td>{member.memberCode || '—'}</td>
                    <td>{member.planName || member.membershipStatus || '—'}</td>
                    <td>{member.expiresAt ? member.expiresAt.slice(0, 10) : '—'}</td>
                    <td>{waLabel(member.consentStatus)}</td>
                    <td>{member.lastWhatsAppAt ? `${member.lastWhatsAppStatus || ''} · ${when(member.lastWhatsAppAt)}` : '—'}</td>
                    <td className="gk-actions" onClick={stop}>
                      <button type="button" className="gk-btn gk-btn--sm" onClick={() => navigate(`/pos/backend/people/${member.id}`)}>Profile</button>
                      <button type="button" className="gk-btn gk-btn--sm" onClick={() => { stashSelectedMembers([member.id]); navigate('/pos/backend/communications/compose'); }}>WhatsApp</button>
                    </td>
                  </tr>
                ))}
                {!members.length ? (
                  <tr>
                    <td colSpan={10} className="o-be-table__empty">
                      {tab === 'in' ? 'No one is in yet — they appear here after they scan the court QR' : 'No members yet — add one from this page'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </ChromeRecords>
      )}
    </Shell>
  );
}

type ArenaPerson = { id: string; name: string; inside: boolean };
type ArenaBoard = { sport: string; slug: string; facilityId: string; inside: number; people: ArenaPerson[] };

function arenaPeople(people: ArenaPerson[]) {
  return [...people].sort((left, right) => Number(right.inside) - Number(left.inside) || left.name.localeCompare(right.name));
}

export function FacilitiesPage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<{ facilities: Facility[] }>('/api/gym/facilities');
  const boardLoad = useLoad<{ boards: ArenaBoard[] }>('/api/gym/activities');
  const [codes, setCodes] = useState<Record<string, string>>({});
  const facilities = data?.facilities ?? [];
  const boards = boardLoad.data?.boards ?? [];
  useEffect(() => {
    const timer = window.setInterval(() => {
      void reload();
      void boardLoad.reload();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [reload, boardLoad.reload]);
  useEffect(() => {
    const origin = window.location.origin;
    for (const board of boardLoad.data?.boards ?? []) {
      void QRCode.toDataURL(`${origin}/in/${board.slug}`, { margin: 0, width: 108 }).then((url) => {
        setCodes((current) => (current[board.slug] === url ? current : { ...current, [board.slug]: url }));
      });
    }
  }, [boardLoad.data]);
  return (
    <Shell title="Activities" error={error || boardLoad.error}>
      <Head title="Activities">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/facilities/new')}>Add facility</button>
      </Head>
      <div className="gk-arenas">
        {boards.map((board) => {
          const people = arenaPeople(board.people);
          return (
          <article key={board.sport} className="gk-arena">
            <header className="gk-arena__head">
              <div>
                <h3>{board.sport}</h3>
                <p>{board.inside} in · {board.people.length} registered</p>
              </div>
              <div className="gk-arena__qr">
                {codes[board.slug] ? <img src={codes[board.slug]} alt={`Scan with camera to enter ${board.sport}`} width={72} height={72} /> : <span className="gk-arena__qr-slot" />}
                <em>Camera</em>
                <button type="button" className="gk-btn gk-btn--sm" onClick={() => void printActivityQr(board.sport, board.slug)}>Print</button>
              </div>
            </header>
            <button
              type="button"
              className={`gk-arena__field is-${arenaSlug(board.sport)}`}
              aria-label={`${board.sport} court`}
              onClick={() => board.facilityId && navigate(`/pos/backend/facilities/${board.facilityId}`)}
            >
              <span className="gk-arena__paint" />
              <span className="gk-arena__mark" />
              <span className="gk-arena__gear" />
            </button>
            <div className="gk-arena__people" aria-label={`${board.inside} in, ${board.people.length} registered on ${board.sport}`}>
              {Array.from({ length: ARENA_SLOTS }, (_, slot) => {
                const person = people[slot];
                if (!person) return <span key={`open-${board.sport}-${slot}`} className="gk-dot" title="Open" />;
                return (
                  <span
                    key={person.id}
                    className={`gk-dot${person.inside ? ' is-in' : ''}`}
                    title={`${person.name}${person.inside ? ' · in' : ''}`}
                  />
                );
              })}
            </div>
          </article>
          );
        })}
      </div>
      <ChromeRecords
        items={facilities.map((facility) => ({
          id: facility.id,
          title: facility.name,
          subtitle: facility.sport,
          meta: facility.isAvailable && facility.maintenanceStatus === 'OK' ? 'Open' : 'Blocked',
          href: `/pos/backend/facilities/${facility.id}`,
        }))}
        empty="No facilities yet — add one from this page"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead>
              <tr><th>Facility</th><th>Timings</th><th>People</th><th>Amount</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {take(facilities, page).map((facility) => {
                const open = facility.isAvailable && facility.maintenanceStatus === 'OK';
                const stage = facilityStage(facility);
                const people = facility.using ?? [];
                return (
                  <tr key={facility.id} className="is-link" onClick={() => navigate(`/pos/backend/facilities/${facility.id}`)}>
                    <td><strong>{facility.name}</strong><div className="gk-muted">{facility.location}</div></td>
                    <td>{facility.opensAt}–{facility.closesAt}</td>
                    <td>
                      {facility.visitorCount ?? 0}
                      {people.map((person) => (
                        <div key={person.name} className="gk-muted">{person.name} · {person.member ? 'Member' : 'Visitor'}</div>
                      ))}
                    </td>
                    <td>{formatINR(facility.memberPrice)}<div className="gk-muted">{formatINR(facility.guestPrice)} guest</div></td>
                    <td><span className={stage.className}>{stage.label}</span></td>
                    <td className="gk-actions" onClick={stop}>
                      {open ? <button type="button" className="gk-btn gk-btn--sm" onClick={() => navigate(`/pos/backend/bookings/new?facility=${facility.id}`)}>Book</button> : null}
                      {open ? (
                        <button
                          type="button"
                          className="gk-btn gk-btn--sm"
                          onClick={() => void act(() => api(`/api/gym/facilities/${facility.id}/maintenance`, { method: 'POST', body: JSON.stringify({ title: 'Blocked', block: true }) }), `${facility.name} blocked`, reload)}
                        >
                          Block
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!facilities.length ? <tr><td colSpan={6} className="o-be-table__empty">No facilities yet — add one from this page</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
    </Shell>
  );
}

export function BookingsPage() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [date, setDate] = useState(today);
  const [facilityId, setFacilityId] = useState('');
  const [view, setView] = useState<'day' | 'week'>('day');
  const [stage, setStage] = useState('all');
  const facilities = useLoad<{ facilities: Facility[] }>('/api/gym/facilities');
  const path = `/api/gym/bookings?date=${view === 'day' ? date : ''}&facilityId=${facilityId}`;
  const { data, error } = useLoad<{ bookings: Booking[] }>(path);
  const rows = useMemo(() => {
    const list = data?.bookings ?? [];
    const byFacility = (left: Booking, right: Booking) => left.facility.localeCompare(right.facility) || left.startAt.localeCompare(right.startAt);
    if (view === 'day') return [...list].sort(byFacility);
    const start = new Date(`${date}T00:00:00+05:30`).getTime();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    return list.filter((row) => {
      const t = new Date(row.startAt).getTime();
      return t >= start && t < end;
    }).sort(byFacility);
  }, [data, view, date]);
  const shown = useMemo(() => {
    if (stage === 'all') return rows;
    if (stage === 'CANCELLED') return rows.filter((row) => row.status === 'CANCELLED' || row.status === 'NO_SHOW');
    return rows.filter((row) => row.status === stage);
  }, [rows, stage]);

  return (
    <Shell title="Bookings" error={error}>
      <Head title="Bookings">
        <button type="button" className="gk-btn" onClick={() => setView(view === 'day' ? 'week' : 'day')}>{view === 'day' ? 'Week view' : 'Day view'}</button>
        <button type="button" className="gk-btn" onClick={() => navigate(`/pos/backend/bookings/new?date=${date}${facilityId ? `&facility=${facilityId}` : ''}`)}>Create booking</button>
      </Head>
      <div className="gk-toolbar">
        <input className="gk-input gk-input--date" type="date" value={date} aria-label="Date" onChange={(event) => setDate(event.target.value)} />
        <Dropdown
          label="Facility"
          value={facilityId}
          onChange={setFacilityId}
          options={[{ value: '', label: 'All facilities' }, ...(facilities.data?.facilities ?? []).map((facility) => ({ value: facility.id, label: facility.name }))]}
        />
        <div className="gk-stages" role="group" aria-label="Filter by stage">
          {[{ id: 'all', label: 'All stages' }, ...BOOKING_STAGES].map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`gk-pill${entry.id === 'all' ? '' : ` ${bookingStageClass(entry.id)}`}${stage === entry.id ? ' is-on' : ''}`}
              aria-pressed={stage === entry.id}
              onClick={() => setStage(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <ChromeRecords
        items={shown.map((row) => ({
          id: row.id,
          title: row.memberName,
          subtitle: row.facility,
          meta: BOOKING_STATUS[row.status] ?? row.status,
          href: `/pos/backend/bookings/${row.id}`,
          when: row.startAt,
        }))}
        empty={rows.length ? 'No bookings in this stage' : 'No bookings yet — create one for this day'}
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead>
              <tr>{['Visitor', 'Facility', 'Start', 'End', 'People', 'Amount', 'Payment', 'Status'].map((label) => <th key={label}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {take(shown, page).map((row) => (
                <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/bookings/${row.id}`)}>
                  <td><strong>{row.memberName}</strong><div className="gk-muted">{row.sport}</div></td>
                  <td>{row.facility}</td>
                  <td>{view === 'day' ? clock(row.startAt) : when(row.startAt)}</td>
                  <td>{clock(row.endAt)}</td>
                  <td>{row.participants}</td>
                  <td>{formatINR(row.amount)}</td>
                  <td>{row.paymentStatus === 'PAID' ? 'Paid' : 'Due'}</td>
                  <td><BookingStages status={row.status} /></td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={8} className="o-be-table__empty">{rows.length ? 'No bookings in this stage' : 'No bookings yet — create one for this day'}</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
    </Shell>
  );
}

export function MembershipsPage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<{ plans: Plan[] }>('/api/gym/plans');
  const holders = useLoad<{ members: Member[] }>('/api/gym/members?filter=ACTIVE');
  const members = holders.data?.members ?? [];
  const plans = data?.plans ?? [];
  return (
    <Shell title="Memberships" error={error}>
      <Head title="Memberships">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/plans/new')}>Create plan</button>
      </Head>
      <ChromeRecords
        items={[
          ...members.map((member) => ({
            id: member.id,
            title: member.name,
            subtitle: member.planName || member.membershipStatus,
            meta: member.coachName || member.mobile,
            href: `/pos/backend/visitors/${member.id}`,
            when: member.expiresAt ?? undefined,
          })),
          ...plans.map((plan) => ({
            id: plan.id,
            title: plan.name,
            subtitle: `${plan.durationDays} days`,
            meta: plan.isActive ? 'Active plan' : 'Off',
            href: `/pos/backend/plans/${plan.id}`,
          })),
        ]}
        empty="No paid memberships yet — sell a plan and the member appears here"
      >
        {(page) => (
          <>
            <table className="o-be-table gk-table">
              <thead><tr><th>Member</th><th>Phone</th><th>Plan</th><th>Status</th><th>Expires</th><th>Trainer</th></tr></thead>
              <tbody>
                {take(members, page).map((member) => (
                  <tr key={member.id} className="is-link" onClick={() => navigate(`/pos/backend/visitors/${member.id}`)}>
                    <td><strong>{member.name}</strong><div className="gk-muted">{member.memberCode}</div></td>
                    <td>{member.mobile}</td>
                    <td>{member.planName || '—'}</td>
                    <td>{member.membershipStatus}</td>
                    <td>{member.expiresAt ? member.expiresAt.slice(0, 10) : '—'}</td>
                    <td>{member.coachName || '—'}</td>
                  </tr>
                ))}
                {!members.length ? <tr><td colSpan={6} className="o-be-table__empty">No paid memberships yet — sell a plan and the member appears here</td></tr> : null}
              </tbody>
            </table>
            <h3 className="gk-section">Plans</h3>
            <table className="o-be-table gk-table">
              <thead><tr><th>Plan</th><th>Days</th><th>Price</th><th>Discount</th><th>Guest passes</th><th>Freeze</th><th>Access</th><th>Status</th><th /></tr></thead>
              <tbody>
                {take(plans, page).map((plan) => (
                  <tr key={plan.id} className="is-link" onClick={() => navigate(`/pos/backend/plans/${plan.id}`)}>
                    <td><strong>{plan.name}</strong><div className="gk-muted">{plan.description || '—'}</div></td>
                    <td>{plan.durationDays}</td>
                    <td>{formatINR(plan.price)}</td>
                    <td>{plan.discountBps / 100}%</td>
                    <td>{plan.guestPasses}</td>
                    <td>{plan.freezeDays} days</td>
                    <td>{plan.facilityAccess === 'ALL' ? 'All facilities' : plan.facilityAccess}</td>
                    <td>{plan.isActive ? 'Active' : 'Off'}</td>
                    <td className="gk-actions" onClick={stop}>
                      <button
                        type="button"
                        className="gk-btn gk-btn--sm"
                        onClick={() => void act(() => api(`/api/gym/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ ...plan, isActive: !plan.isActive }) }), plan.isActive ? 'Plan turned off' : 'Plan turned on', reload)}
                      >
                        {plan.isActive ? 'Turn off' : 'Turn on'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!plans.length ? <tr><td colSpan={9} className="o-be-table__empty">No plans yet — create one from this page</td></tr> : null}
              </tbody>
            </table>
          </>
        )}
      </ChromeRecords>
    </Shell>
  );
}

type ClassRow = { id: string; name: string; category: string; trainer_name: string | null; trainer_phone: string | null; trainer_email: string | null; schedule: string; duration_minutes: number; capacity: number; price: number; description: string; is_private: number };
type TrainerRow = { id: string; name: string; phone: string; email?: string; specialization: string; availability: string; isActive?: boolean };
type Registration = { id: string; class_id: string; class_name?: string; class_schedule?: string; trainer_name?: string | null; trainer_phone?: string | null; name: string; status: string; attended: number };

export function ClassesPage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<{ classes: ClassRow[]; trainers: TrainerRow[]; registrations: Registration[] }>('/api/gym/classes');
  const [form, setForm] = useState({ name: '', category: '', schedule: '', trainerId: '', capacity: 12, price: 400, description: '' });
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.schedule.trim()) {
      pushToast('Enter the class name and schedule.', 'err');
      return;
    }
    await act(() => api('/api/gym/classes', { method: 'POST', body: JSON.stringify(form) }), 'Class created', reload);
    setForm({ ...form, name: '', category: '', schedule: '', trainerId: '' });
  }
  const classes = data?.classes ?? [];
  const trainers = data?.trainers ?? [];
  const registrations = data?.registrations ?? [];
  const taken = (classId: string) => registrations.filter((row) => row.class_id === classId && row.status === 'REGISTERED').length;
  return (
    <Shell title="Classes" error={error}>
      <Head title="Classes and coaching" />
      <form className="gk-inline" onSubmit={(event) => void add(event)}>
        <input className="gk-input" placeholder="Class name" aria-label="Class name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input className="gk-input" placeholder="Category" aria-label="Category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
        <input className="gk-input" placeholder="Schedule" aria-label="Schedule" value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} />
        <Dropdown
          label="Trainer"
          placeholder="Trainer"
          value={form.trainerId}
          onChange={(value) => setForm({ ...form, trainerId: value })}
          options={[{ value: '', label: 'No trainer yet' }, ...trainers.map((trainer) => ({ value: trainer.id, label: `${trainer.name} · ${trainer.specialization}` }))]}
        />
        <button type="submit" className="gk-btn">Create</button>
      </form>
      <div className="gk-section-row">
        <h3 className="gk-section">Trainers</h3>
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/trainers/new')}>Add trainer</button>
      </div>
      <ChromeRecords
        items={[
          ...classes.map((row) => ({ id: row.id, title: row.name, subtitle: row.trainer_name || row.category, meta: row.schedule, href: `/pos/backend/participants/new?class=${row.id}` })),
          ...trainers.map((trainer) => ({ id: trainer.id, title: trainer.name, subtitle: trainer.specialization, meta: trainer.availability || 'Trainer', href: `/pos/backend/trainers/${trainer.id}` })),
          ...registrations.map((row) => ({ id: row.id, title: row.name, subtitle: row.class_name || 'Class', meta: row.status === 'WAITLIST' ? 'Waitlist' : row.status === 'ATTENDED' ? 'Attended' : 'Registered' })),
        ]}
        empty="No classes yet — create one on the line above"
      >
        {(page) => (
          <>
            <table className="o-be-table gk-table">
              <thead><tr><th>Class</th><th>Trainer</th><th>Contact</th><th>Schedule</th><th>Places</th><th>Price</th><th /></tr></thead>
              <tbody>
                {take(classes, page).map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong><div className="gk-muted">{row.category || (row.is_private ? 'Private' : 'Group')}{row.description ? ` · ${row.description}` : ''}</div></td>
                    <td>{row.trainer_name || '—'}</td>
                    <td>{row.trainer_phone || '—'}<div className="gk-muted">{row.trainer_email || ''}</div></td>
                    <td>{row.schedule} · {row.duration_minutes}m</td>
                    <td>{taken(row.id)} of {row.capacity}</td>
                    <td>{formatINR(row.price)}</td>
                    <td className="gk-actions">
                      <button type="button" className="gk-btn gk-btn--sm" onClick={() => navigate(`/pos/backend/participants/new?class=${row.id}`)}>Add participant</button>
                    </td>
                  </tr>
                ))}
                {!classes.length ? <tr><td colSpan={7} className="o-be-table__empty">No classes yet — create one on the line above</td></tr> : null}
              </tbody>
            </table>
            <table className="o-be-table gk-table">
              <thead><tr><th>Name</th><th>Sport</th><th>Phone</th><th>Email</th><th>Hours</th><th>Status</th></tr></thead>
              <tbody>
                {take(trainers, page).map((trainer) => (
                  <tr key={trainer.id} className="is-link" onClick={() => navigate(`/pos/backend/trainers/${trainer.id}`)}>
                    <td><strong>{trainer.name}</strong></td>
                    <td>{trainer.specialization}</td>
                    <td>{trainer.phone || '—'}</td>
                    <td>{trainer.email || '—'}</td>
                    <td>{trainer.availability || '—'}</td>
                    <td>{trainer.isActive === false ? 'Inactive' : 'Active'}</td>
                  </tr>
                ))}
                {!trainers.length ? <tr><td colSpan={6} className="o-be-table__empty">No trainers yet — add one from this page</td></tr> : null}
              </tbody>
            </table>
            <h3 className="gk-section">Participants</h3>
            <table className="o-be-table gk-table">
              <thead><tr><th>Name</th><th>Class</th><th>Trainer</th><th>Status</th><th /></tr></thead>
              <tbody>
                {take(registrations, page).map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.class_name || '—'}{row.class_schedule ? <div className="gk-muted">{row.class_schedule}</div> : null}</td>
                    <td>{row.trainer_name || '—'}{row.trainer_phone ? <div className="gk-muted">{row.trainer_phone}</div> : null}</td>
                    <td>{row.status === 'WAITLIST' ? 'Waitlist' : row.status === 'ATTENDED' ? 'Attended' : 'Registered'}</td>
                    <td className="gk-actions">
                      <button type="button" className="gk-btn gk-btn--sm" onClick={() => void act(() => api(`/api/gym/registrations/${row.id}/remove`, { method: 'POST', body: '{}' }), `${row.name} removed`, reload)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {!registrations.length ? <tr><td colSpan={5} className="o-be-table__empty">No participants yet — add one from a class row</td></tr> : null}
              </tbody>
            </table>
          </>
        )}
      </ChromeRecords>
    </Shell>
  );
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Owner',
  MANAGER: 'Manager',
  RECEPTIONIST: 'Receptionist',
  CASHIER: 'Cashier',
  COACH: 'Trainer',
  FACILITY_MANAGER: 'Facility manager',
  INVENTORY_MANAGER: 'Inventory manager',
  staff: 'Staff',
};

export function EmployeesPage() {
  const { data, error, reload } = useLoad<{
    employees: { id: string; name: string; email: string; role: string; phone: string; specialization: string; schedule_json: string }[];
    attendance: { id: string; user_id: string; status: string; noted_at: string; actor: string }[];
    audit: { id: string; actor: string; action: string; entity: string; message: string; created_at: string }[];
  }>('/api/gym/employees');
  const employees = data?.employees ?? [];
  const nameOf = (id: string) => employees.find((row) => row.id === id)?.name ?? 'Former employee';
  const roleOptions = Object.entries(ROLE_LABELS).filter(([value]) => value !== 'staff').map(([value, label]) => ({ value, label }));
  function mark(id: string, status: 'IN' | 'OUT') {
    void act(() => api(`/api/gym/employees/${id}/attendance`, { method: 'POST', body: JSON.stringify({ status }) }), status === 'IN' ? 'Clocked in' : 'Clocked out', reload);
  }
  return (
    <Shell title="Employees" error={error}>
      <Head title="Employees" />
      <ChromeRecords
        items={employees.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: ROLE_LABELS[row.role] ?? row.role,
          meta: row.specialization || row.email,
        }))}
        empty="No employees yet"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Focus</th><th /></tr></thead>
            <tbody>
              {take(employees, page).map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.email}</td>
                  <td>
                    <Dropdown
                      label={`${row.name} role`}
                      value={row.role}
                      options={roleOptions.some((option) => option.value === row.role) ? roleOptions : [{ value: row.role, label: ROLE_LABELS[row.role] ?? row.role }, ...roleOptions]}
                      onChange={(role) => void act(() => api(`/api/gym/employees/${row.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }), 'Role updated', reload)}
                    />
                  </td>
                  <td>{row.phone || '—'}</td>
                  <td>{row.specialization || '—'}</td>
                  <td className="gk-actions">
                    <button type="button" className="gk-btn gk-btn--sm" onClick={() => mark(row.id, 'IN')}>Clock in</button>
                    <button type="button" className="gk-btn gk-btn--sm" onClick={() => mark(row.id, 'OUT')}>Clock out</button>
                  </td>
                </tr>
              ))}
              {!employees.length ? <tr><td colSpan={6} className="o-be-table__empty">No employees yet</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
      <h3 className="gk-section">Attendance</h3>
      <table className="o-be-table gk-table">
        <thead><tr><th>Employee</th><th>Status</th><th>When</th><th>Recorded by</th></tr></thead>
        <tbody>
          {(data?.attendance ?? []).map((row) => (
            <tr key={row.id}>
              <td><strong>{nameOf(row.user_id)}</strong></td>
              <td><span className={`gk-pill is-${row.status === 'IN' ? 'confirmed' : 'completed'}`}>{row.status === 'IN' ? 'Clocked in' : 'Clocked out'}</span></td>
              <td>{whenText(row.noted_at)}</td>
              <td>{row.actor || '—'}</td>
            </tr>
          ))}
          {!(data?.attendance ?? []).length ? <tr><td colSpan={4} className="o-be-table__empty">No attendance yet — clock an employee in from the table above</td></tr> : null}
        </tbody>
      </table>
      <h3 className="gk-section">Activity</h3>
      <table className="o-be-table gk-table">
        <thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Area</th></tr></thead>
        <tbody>
          {(data?.audit ?? []).map((row) => (
            <tr key={row.id}>
              <td>{whenText(row.created_at)}</td>
              <td><strong>{row.actor === 'seed' ? 'Demo data' : row.actor}</strong></td>
              <td>{describeAction(row.action, row.message)}</td>
              <td>{row.entity ? row.entity[0].toUpperCase() + row.entity.slice(1) : '—'}</td>
            </tr>
          ))}
          {!(data?.audit ?? []).length ? <tr><td colSpan={4} className="o-be-table__empty">No activity yet</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

type TaskRow = {
  id: string;
  title: string;
  notes: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  facility: string;
  facility_id: string;
  facility_status: string;
  actor?: string;
  category: string;
  priority: string;
  assigned_to: string;
  cost: number;
};

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function byUrgency(a: TaskRow, b: TaskRow) {
  if ((a.status === 'OPEN') !== (b.status === 'OPEN')) return a.status === 'OPEN' ? -1 : 1;
  if (a.status === 'OPEN') return (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || b.starts_at.localeCompare(a.starts_at);
  return (b.ends_at ?? '').localeCompare(a.ends_at ?? '');
}

export function MaintenancePage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<{ records: TaskRow[] }>('/api/gym/maintenance');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [facility, setFacility] = useState('all');
  const records = data?.records ?? [];
  const open = records.filter((row) => row.status === 'OPEN');
  const since = Date.now() - 30 * 86_400_000;
  const recent = records.filter((row) => row.status !== 'OPEN' && row.ends_at && new Date(row.ends_at).getTime() >= since);
  const closedFacilities = new Set(open.filter((row) => row.facility_status === 'MAINTENANCE').map((row) => row.facility_id)).size;
  const facilityOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of records) seen.set(row.facility_id, row.facility);
    return [{ value: 'all', label: 'All facilities' }, ...[...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))];
  }, [records]);
  const needle = q.trim().toLowerCase();
  const rows = records
    .filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (facility !== 'all' && row.facility_id !== facility) return false;
      if (needle && !`${row.title} ${row.notes} ${row.facility} ${row.category} ${row.assigned_to} ${row.actor ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    })
    .sort(byUrgency);
  return (
    <Shell title="Maintenance" error={error}>
      <Head title="Maintenance">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/maintenance/new')}>Add task</button>
      </Head>
      <section className="o-track__status">
        <article className="o-track__stat o-track__stat--plain"><span>Open tasks</span><strong>{open.length}</strong><em>Waiting to be fixed</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Urgent or high</span><strong>{open.filter((row) => row.priority === 'URGENT' || row.priority === 'HIGH').length}</strong><em>Fix these first</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Facilities closed</span><strong>{closedFacilities}</strong><em>Blocked for bookings</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Spent</span><strong>{formatINR(recent.reduce((sum, row) => sum + row.cost, 0))}</strong><em>{recent.length} tasks done in 30 days</em></article>
      </section>
      <div className="gk-toolbar">
        <input className="gk-input" value={q} placeholder="Search task, facility or person" aria-label="Search maintenance" onChange={(event) => setQ(event.target.value)} />
        <Dropdown
          label="Task status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All tasks' },
            { value: 'OPEN', label: 'Open' },
            { value: 'CLOSED', label: 'Done' },
          ]}
        />
        <Dropdown label="Facility" value={facility} onChange={setFacility} options={facilityOptions} />
      </div>
      <ChromeRecords
        items={rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.facility,
          meta: row.status === 'OPEN' ? priorityLabel(row.priority) : 'Done',
          href: `/pos/backend/maintenance/${row.id}`,
          when: row.starts_at,
        }))}
        empty={records.length ? 'No tasks match these filters' : 'No maintenance tasks yet — add one from this page'}
      >
        {(page) => (
      <table className="o-be-table gk-table">
        <thead><tr><th>Done</th><th>Task</th><th>Facility</th><th>Priority</th><th>Assigned to</th><th>Raised by</th><th>Status</th><th>Cost</th></tr></thead>
        <tbody>
          {take(rows, page).map((row) => (
            <tr key={row.id} className={`is-link${row.status === 'CLOSED' ? ' is-done' : ''}`} onClick={() => navigate(`/pos/backend/maintenance/${row.id}`)}>
              <td onClick={stop}>
                <input
                  type="checkbox"
                  className="gk-check"
                  aria-label={`Mark ${row.title} done`}
                  checked={row.status !== 'OPEN'}
                  disabled={row.status !== 'OPEN'}
                  onChange={() => void act(() => api(`/api/gym/maintenance/${row.id}/close`, { method: 'POST', body: '{}' }), 'Task done', reload)}
                />
              </td>
              <td className="gk-wrap"><strong>{row.title}</strong><div className="gk-muted">{row.category}{row.notes ? ` · ${row.notes}` : ''}</div></td>
              <td>{row.facility}{row.status === 'OPEN' && row.facility_status === 'MAINTENANCE' ? <div className="gk-muted">Closed for bookings</div> : null}</td>
              <td><span className={`gk-pill is-prio-${row.priority.toLowerCase()}`}>{priorityLabel(row.priority)}</span></td>
              <td>{row.assigned_to || '—'}</td>
              <td>{row.actor || '—'}<div className="gk-muted">{when(row.starts_at)}</div></td>
              <td>{row.status === 'OPEN' ? 'Open' : 'Done'}{row.status !== 'OPEN' && row.ends_at ? <div className="gk-muted">{when(row.ends_at)}</div> : null}</td>
              <td>{row.cost ? formatINR(row.cost) : '—'}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="o-be-table__empty">{records.length ? 'No tasks match these filters' : 'No maintenance tasks yet — add one from this page'}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
        )}
      </ChromeRecords>
    </Shell>
  );
}

type ShiftRow = {
  id: string;
  type: string;
  subjectId: string;
  name: string;
  roleLabel: string;
  phone: string;
  startedAt: string;
  endedAt: string | null;
  bookings: number;
  checkIns: number;
  sessions: number;
};

export function ShiftPage() {
  const navigate = useNavigate();
  const desk = getDeskMode();
  const { data, error, reload } = useLoad<{ shifts: ShiftRow[] }>('/api/gym/shifts');
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const kind = desk === 'trainer' ? 'TRAINER' : desk === 'employee' ? 'STAFF' : null;
  const rows = (data?.shifts ?? []).filter((row) => !kind || row.type === kind);
  const open = rows.filter((row) => !row.endedAt);
  const closed = rows.filter((row) => row.endedAt);
  const startTo = desk === 'trainer' ? '/pos/backend/shift/new?role=trainer' : '/pos/backend/shift/new';
  const title = desk === 'trainer' ? 'My shift' : 'Shift';
  return (
    <Shell title={title} error={error}>
      <Head title={title}>
        <button type="button" className="gk-btn" onClick={() => navigate(startTo)}>Start my shift</button>
      </Head>
      <ChromeRecords
        items={[...open, ...closed].map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: row.roleLabel || (row.type === 'TRAINER' ? 'Trainer' : 'Staff'),
          meta: row.endedAt ? 'Finished' : 'On shift',
          href: `/pos/backend/shift/${row.id}`,
          when: row.startedAt,
        }))}
        empty="No one is on shift — start a shift from this page"
      >
        {(page) => (
          <>
            {take(open, page).length ? (
              <div className="gk-shifts">
                {take(open, page).map((row) => (
                  <article key={row.id} className="gk-shift" onClick={() => navigate(`/pos/backend/shift/${row.id}`)}>
                    <header>
                      <span className="gk-shift__avatar">{row.name.trim().charAt(0).toUpperCase()}</span>
                      <div>
                        <strong>{row.name}</strong>
                        <em>{row.roleLabel || (row.type === 'TRAINER' ? 'Trainer' : 'Staff')}</em>
                      </div>
                      <span className="gk-shift__live">On shift</span>
                    </header>
                    <p className="gk-shift__clock">{elapsed(row.startedAt)}</p>
                    <dl>
                      <div><dt>Started</dt><dd>{clock(row.startedAt)}</dd></div>
                      <div><dt>Bookings</dt><dd>{row.bookings}</dd></div>
                      <div><dt>Check-ins</dt><dd>{row.checkIns}</dd></div>
                      {row.type === 'TRAINER' ? <div><dt>Sessions</dt><dd>{row.sessions}</dd></div> : null}
                    </dl>
                    <footer onClick={stop}>
                      <button type="button" className="gk-btn" onClick={() => navigate(`/pos/backend/shift/${row.id}`)}>{row.type === 'TRAINER' ? 'Log sessions' : 'Open shift'}</button>
                      <button type="button" className="gk-btn" onClick={() => void act(() => api(`/api/gym/shifts/${row.id}/end`, { method: 'POST', body: '{}' }), `${row.name} clocked out`, reload)}>Clock out</button>
                    </footer>
                  </article>
                ))}
              </div>
            ) : <p className="o-be-table__empty gk-empty-line">No one is on shift — start a shift from this page</p>}
            <h3 className="gk-section">Earlier shifts</h3>
            <table className="o-be-table gk-table">
              <thead><tr><th>Name</th><th>Role</th><th>Started</th><th>Ended</th><th>Hours</th><th>Bookings</th><th>Check-ins</th><th>Sessions</th></tr></thead>
              <tbody>
                {take(closed, page).map((row) => (
                  <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/shift/${row.id}`)}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.roleLabel || (row.type === 'TRAINER' ? 'Trainer' : 'Staff')}</td>
                    <td>{when(row.startedAt)}</td>
                    <td>{row.endedAt ? when(row.endedAt) : '—'}</td>
                    <td>{elapsed(row.startedAt, row.endedAt)}</td>
                    <td>{row.bookings}</td>
                    <td>{row.checkIns}</td>
                    <td>{row.type === 'TRAINER' ? row.sessions : '—'}</td>
                  </tr>
                ))}
                {!closed.length ? <tr><td colSpan={8} className="o-be-table__empty">No finished shifts yet</td></tr> : null}
              </tbody>
            </table>
          </>
        )}
      </ChromeRecords>
    </Shell>
  );
}

type SessionRow = {
  id: string;
  shiftId: string;
  trainerName: string;
  date: string;
  startTime: string;
  minutes: number;
  facility: string;
  activity: string;
  kind: string;
  people: number;
  visitors: string;
  amount: number;
  payment: string;
};

export function SessionsPage() {
  const navigate = useNavigate();
  const { data, error } = useLoad<{ sessions: SessionRow[] }>('/api/gym/sessions');
  const [trainer, setTrainer] = useState('all');
  const [period, setPeriod] = useState('week');
  const sessions = data?.sessions ?? [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const weekStart = new Date(Date.parse(`${today}T12:00:00+05:30`) - 6 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const trainerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of sessions) seen.set(row.trainerName, row.trainerName);
    return [{ value: 'all', label: 'All trainers' }, ...[...seen.keys()].sort().map((name) => ({ value: name, label: name }))];
  }, [sessions]);
  const rows = sessions.filter((row) => {
    if (trainer !== 'all' && row.trainerName !== trainer) return false;
    if (period === 'today' && row.date !== today) return false;
    if (period === 'week' && row.date < weekStart) return false;
    return true;
  });
  const span = period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'All time';
  const collected = rows.filter((row) => row.payment.startsWith('Paid')).reduce((sum, row) => sum + row.amount, 0);
  const due = rows.filter((row) => row.payment === 'Due').reduce((sum, row) => sum + row.amount, 0);
  return (
    <Shell title="Sessions" error={error}>
      <Head title="Sessions">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/shift/new?role=trainer')}>Log sessions</button>
      </Head>
      <section className="o-track__status">
        <article className="o-track__stat o-track__stat--plain"><span>Sessions</span><strong>{rows.length}</strong><em>{span}</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Hours coached</span><strong>{(rows.reduce((sum, row) => sum + row.minutes, 0) / 60).toFixed(1).replace(/\.0$/, '')}</strong><em>{span}</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>People coached</span><strong>{rows.reduce((sum, row) => sum + row.people, 0)}</strong><em>{span}</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Collected</span><strong>{formatINR(collected)}</strong><em>{due ? `${formatINR(due)} still due` : 'Nothing due'}</em></article>
      </section>
      <div className="gk-toolbar">
        <Dropdown
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'week', label: 'Last 7 days' },
            { value: 'all', label: 'All sessions' },
          ]}
        />
        <Dropdown label="Trainer" value={trainer} onChange={setTrainer} options={trainerOptions} />
      </div>
      <ChromeRecords
        items={rows.map((row) => ({
          id: row.id,
          title: row.activity,
          subtitle: row.trainerName,
          meta: `${row.facility || 'Floor'} · ${row.people} people`,
          href: `/pos/backend/shift/${row.shiftId}`,
          when: `${row.date}T${row.startTime}:00+05:30`,
        }))}
        empty={sessions.length ? 'No sessions match these filters' : 'No sessions yet — trainers log them from their shift at the end of the day'}
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead><tr><th>Date</th><th>Trainer</th><th>Time</th><th>Session</th><th>Facility</th><th>People</th><th>Visitors</th><th>Amount</th></tr></thead>
            <tbody>
              {take(rows, page).map((row) => (
                <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/shift/${row.shiftId}`)}>
                  <td>{dayLabel(row.date, today)}</td>
                  <td><strong>{row.trainerName}</strong></td>
                  <td>{row.startTime}<div className="gk-muted">{row.minutes} min</div></td>
                  <td>{row.activity}<div className="gk-muted">{row.kind}</div></td>
                  <td>{row.facility || '—'}</td>
                  <td>{row.people}</td>
                  <td className="gk-wrap">{row.visitors || '—'}</td>
                  <td>{row.amount ? formatINR(row.amount) : '—'}<div className="gk-muted">{row.payment}</div></td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={8} className="o-be-table__empty">{sessions.length ? 'No sessions match these filters' : 'No sessions yet — trainers log them from their shift at the end of the day'}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
    </Shell>
  );
}

function JoinRequestsList({ route, embedded = false }: { route: 'TRAINER' | 'STAFF'; embedded?: boolean }) {
  const navigate = useNavigate();
  const title = route === 'TRAINER' ? 'Trainer requests' : 'Membership requests';
  const base = route === 'TRAINER' ? '/pos/backend/trainer-requests' : '/pos/backend/membership-requests';
  const { data, error, reload } = useLoad<{ requests: JoinRequest[] }>(`/api/gym/join-requests?route=${route}`);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [trainer, setTrainer] = useState('all');
  const requests = data?.requests ?? [];
  const trainerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of requests) if (row.trainerId) seen.set(row.trainerId, row.trainerName);
    return [
      { value: 'all', label: 'All trainers' },
      { value: '', label: 'Any trainer' },
      ...[...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
    ];
  }, [requests]);
  const needle = q.trim().toLowerCase();
  const rows = requests.filter((row) => {
    if (status === 'open' && row.status !== 'NEW' && row.status !== 'CONTACTED') return false;
    if (status !== 'open' && status !== 'all' && row.status !== status) return false;
    if (route === 'TRAINER' && trainer !== 'all' && row.trainerId !== trainer) return false;
    if (needle && !`${row.ref} ${row.name} ${row.mobile} ${row.email} ${row.sport} ${row.trainerName} ${row.planName}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const count = (value: string) => requests.filter((row) => row.status === value).length;
  const paidWaiting = requests.filter((row) => row.paymentStatus === 'PAID' && (row.status === 'NEW' || row.status === 'CONTACTED')).length;
  const columns = route === 'TRAINER' ? 9 : 8;
  const body = (
    <>
      {embedded && error ? <p className="o-track__error">{error}</p> : null}
      <section className="o-track__status">
        <article className="o-track__stat o-track__stat--plain"><span>New</span><strong>{count('NEW')}</strong><em>Waiting for a call</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Contacted</span><strong>{count('CONTACTED')}</strong><em>Called, not decided</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Paid, not approved</span><strong>{paidWaiting}</strong><em>Approve to start the plan</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Approved</span><strong>{count('APPROVED')}</strong><em>Now members</em></article>
      </section>
      <div className="gk-toolbar">
        <input className="gk-input" value={q} placeholder="Search name, phone or ref" aria-label={`Search ${title.toLowerCase()}`} onChange={(event) => setQ(event.target.value)} />
        <Dropdown
          label="Request status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open requests' },
            { value: 'NEW', label: 'New' },
            { value: 'CONTACTED', label: 'Contacted' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'DECLINED', label: 'Declined' },
            { value: 'all', label: 'All requests' },
          ]}
        />
        {route === 'TRAINER' ? <Dropdown label="Trainer" value={trainer} onChange={setTrainer} options={trainerOptions} /> : null}
      </div>
      <ChromeRecords
        items={rows.map((row) => ({
          id: row.id,
          title: `${row.ref} · ${row.name}`,
          subtitle: row.kind === 'SESSION' ? `${row.sport} session` : row.sport,
          meta: row.kind === 'SESSION' ? (row.preferredSlotLabel || 'Session') : row.wantsTrainer ? (row.trainerName || 'Unassigned') : (row.planName || 'No plan yet'),
          href: `${base}/${row.id}`,
          when: row.createdAt,
        }))}
        empty={requests.length ? 'No requests match these filters' : route === 'TRAINER' ? 'No trainer requests yet — they arrive when someone registers with a trainer' : 'No requests yet — they arrive when someone registers or books a session'}
      >
        {(page) => (
      <table className="o-be-table gk-table">
        <thead>
          <tr>
            <th>Request</th>
            <th>Applicant</th>
            <th>Contact</th>
            <th>Sport</th>
            {route === 'TRAINER' ? <><th>Trainer</th><th>Preferred time</th></> : <th>Type</th>}
            <th>Plan</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {take(rows, page).map((row) => (
            <tr key={row.id} className="is-link" onClick={() => navigate(`${base}/${row.id}`)}>
              <td><strong>{row.ref}</strong><div className="gk-muted">{whenText(row.createdAt)}</div></td>
              <td><strong>{row.name}</strong><div className="gk-muted">{row.age != null ? `${row.age} yrs` : '—'}</div></td>
              <td>{row.mobile}<div className="gk-muted">{row.email}{row.hasPassword ? ' · login set' : ''}{row.hasPortrait ? ' · photo' : ''}</div></td>
              <td>{row.sport}{row.kind === 'SESSION' && row.preferredSlotLabel ? <div className="gk-muted">{row.preferredSlotLabel}</div> : null}</td>
              {route === 'TRAINER'
                ? <><td>{row.trainerName || 'Unassigned'}</td><td>{row.preferredSlotLabel || 'No preference'}</td></>
                : <td>{row.kind === 'SESSION' ? 'Session' : 'Membership'}{row.kind !== 'SESSION' && row.govtIdLabel ? <div className="gk-muted">{row.govtIdLabel}</div> : null}</td>}
              <td>{row.kind === 'SESSION' ? 'Session request' : row.planName ? `${row.planName} · ${formatINR(row.amount)}` : 'No plan yet'}<div className="gk-muted">{row.kind === 'SESSION' ? (row.preferredSlotLabel || 'Awaiting desk') : row.becomeMember ? 'Wants membership' : row.isMember ? 'Says member' : joinPayment(row)}</div></td>
              <td><span className={`gk-pill is-join-${row.status.toLowerCase()}`}>{JOIN_STATUS[row.status] ?? row.status}</span></td>
              <td className="gk-actions">
                <a className="gk-btn gk-btn--sm" href={`tel:+91${row.mobile}`} onClick={stop}>Call</a>
                {row.status === 'NEW' ? (
                  <button
                    type="button"
                    className="gk-btn gk-btn--sm"
                    onClick={(event) => {
                      stop(event);
                      void act(() => api(`/api/gym/join-requests/${row.id}/contacted`, { method: 'POST', body: '{}' }), 'Marked contacted', reload);
                    }}
                  >
                    Contacted
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={columns} className="o-be-table__empty">
                {requests.length ? 'No requests match these filters' : route === 'TRAINER' ? 'No trainer requests yet — they arrive when someone registers with a trainer' : 'No requests yet — they arrive when someone registers on the site'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
        )}
      </ChromeRecords>
    </>
  );
  if (embedded) return body;
  return (
    <Shell title={title} error={error}>
      <Head title={title} />
      {body}
    </Shell>
  );
}

export function TrainerRequestsPage() {
  return <JoinRequestsList route="TRAINER" />;
}

export function MembershipRequestsPage() {
  return <JoinRequestsList route="STAFF" />;
}

export function NotificationsPage() {
  const { data, error, reload } = useLoad<{ notifications: { id: string; title: string; body: string; created_at: string; read_at: string | null }[] }>('/api/gym/notifications');
  const rows = data?.notifications ?? [];
  return (
    <Shell title="Notifications" error={error}>
      <Head title="Notifications" />
      <ChromeRecords
        items={rows.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.body,
          meta: row.read_at ? 'Read' : 'New',
          when: row.created_at,
        }))}
        empty="No notifications yet"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead><tr><th>Title</th><th>Message</th><th>When</th><th /></tr></thead>
            <tbody>
              {take(rows, page).map((row) => (
                <tr key={row.id} className={row.read_at ? 'is-done' : ''}>
                  <td><strong>{row.title}</strong></td>
                  <td>{row.body}</td>
                  <td>{whenText(row.created_at)}</td>
                  <td className="gk-actions">
                    {row.read_at ? 'Read' : <button type="button" className="gk-btn gk-btn--sm" onClick={() => void act(() => api(`/api/gym/notifications/${row.id}/read`, { method: 'POST', body: '{}' }), 'Marked read', reload)}>Mark read</button>}
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={4} className="o-be-table__empty">No notifications yet</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
    </Shell>
  );
}
