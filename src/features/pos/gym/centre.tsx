import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { formatINR } from '../../../../shared/domain';
import { api } from '../../../lib/api';
import { useTitle } from '../../../lib/useTitle';
import { pushToast } from '../../../components/Toast';
import type { BackendChromeContext } from '../odoo/OdooBackendLayout';
import { BOOKING_STATUS, Dropdown, describeAction, whenText } from './record';

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
  const { setPagerLabel } = useOutletContext<BackendChromeContext>();
  useEffect(() => {
    setPagerLabel('');
  }, [setPagerLabel]);
  return (
    <section className="o-track">
      {error ? <p className="o-track__error">{error}</p> : null}
      {children}
    </section>
  );
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="o-track__hello">
      <h2>{title}</h2>
      {children ? <div className="gk-head-actions">{children}</div> : null}
    </header>
  );
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
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

export function MembersPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const path = `/api/gym/members?filter=${encodeURIComponent(filter)}&q=${encodeURIComponent(q)}`;
  const { data, error } = useLoad<{ members: Member[] }>(path);
  const members = data?.members ?? [];
  return (
    <Shell title="Visitors" error={error}>
      <Head title="Visitors">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/visitors/new')}>Add visitor</button>
      </Head>
      <div className="gk-toolbar">
        <input className="gk-input" value={q} placeholder="Search name, phone, trainer, or ID" aria-label="Search visitors" onChange={(event) => setQ(event.target.value)} />
        <Dropdown
          label="Visitor filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'ACTIVE', label: 'Members only' },
            { value: 'PENDING', label: 'Visitors only' },
            { value: 'EXPIRED', label: 'Expired' },
            { value: 'SUSPENDED', label: 'Suspended' },
            { value: 'FROZEN', label: 'Frozen' },
          ]}
        />
      </div>
      <table className="o-be-table gk-table">
        <thead><tr><th>Name</th><th>Phone</th><th>Wants to use</th><th>Status</th><th>Trainer</th><th>Government ID</th></tr></thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="is-link" onClick={() => navigate(`/pos/backend/visitors/${member.id}`)}>
              <td><strong>{member.name}</strong><div className="gk-muted">{member.memberCode}</div></td>
              <td>{member.mobile}</td>
              <td>{member.accessInterest || '—'}</td>
              <td>{member.isMember ? member.planName || 'Member' : 'Visitor'}</td>
              <td>{member.coachName || '—'}</td>
              <td>{member.govtIdLabel || '—'}</td>
            </tr>
          ))}
          {!members.length ? <tr><td colSpan={6} className="o-be-table__empty">No visitors yet — add one from this page</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

export function FacilitiesPage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<{ facilities: Facility[] }>('/api/gym/facilities');
  const facilities = data?.facilities ?? [];
  return (
    <Shell title="Facilities" error={error}>
      <Head title="Facilities">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/facilities/new')}>Add facility</button>
      </Head>
      <table className="o-be-table gk-table">
        <thead>
          <tr><th>Facility</th><th>Sport</th><th>Using now</th><th>Trainer with them</th><th>Capacity</th><th>Hours</th><th>Member</th><th>Guest</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {facilities.map((facility) => {
            const open = facility.isAvailable && facility.maintenanceStatus === 'OK';
            return (
              <tr key={facility.id} className="is-link" onClick={() => navigate(`/pos/backend/facilities/${facility.id}`)}>
                <td><strong>{facility.name}</strong><div className="gk-muted">{facility.location}</div></td>
                <td>{facility.sport}</td>
                <td>{facility.visitorCount ?? 0}{(facility.using ?? []).map((person) => <div key={person.name} className="gk-muted">{person.name} · {person.member ? 'Member' : 'Visitor'}</div>)}</td>
                <td>{(facility.using ?? []).map((person) => person.coach).filter(Boolean).join(', ') || '—'}</td>
                <td>{facility.capacity}</td>
                <td>{facility.opensAt}–{facility.closesAt}</td>
                <td>{formatINR(facility.memberPrice)}</td>
                <td>{formatINR(facility.guestPrice)}</td>
                <td>{open ? 'Open' : 'Blocked'}</td>
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
          {!facilities.length ? <tr><td colSpan={10} className="o-be-table__empty">No facilities yet — add one from this page</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

export function BookingsPage() {
  const navigate = useNavigate();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [date, setDate] = useState(today);
  const [facilityId, setFacilityId] = useState('');
  const [view, setView] = useState<'day' | 'week'>('day');
  const facilities = useLoad<{ facilities: Facility[] }>('/api/gym/facilities');
  const path = `/api/gym/bookings?date=${view === 'day' ? date : ''}&facilityId=${facilityId}`;
  const { data, error, reload } = useLoad<{ bookings: Booking[] }>(path);
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

  function status(id: string, next: string) {
    void act(() => api(`/api/gym/bookings/${id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) }), next === 'CANCELLED' ? 'Booking cancelled' : 'Booking updated', reload);
  }

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
      </div>
      <table className="o-be-table gk-table">
        <thead>
          <tr>{['Visitor', 'Facility', 'Start', 'End', 'People', 'Amount', 'Payment', 'Status', ''].map((label) => <th key={label}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = row.status === 'CONFIRMED' || row.status === 'CHECKED_IN';
            return (
              <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/bookings/${row.id}`)}>
                <td><strong>{row.memberName}</strong><div className="gk-muted">{row.sport}</div></td>
                <td>{row.facility}</td>
                <td>{view === 'day' ? clock(row.startAt) : when(row.startAt)}</td>
                <td>{clock(row.endAt)}</td>
                <td>{row.participants}</td>
                <td>{formatINR(row.amount)}</td>
                <td>{row.paymentStatus === 'PAID' ? 'Paid' : 'Due'}</td>
                <td><span className={`gk-pill is-${row.status.toLowerCase()}`}>{BOOKING_STATUS[row.status] ?? row.status}</span></td>
                <td className="gk-actions" onClick={stop}>
                  {row.status === 'CONFIRMED' ? <button type="button" className="gk-btn gk-btn--sm" onClick={() => status(row.id, 'CHECKED_IN')}>Check in</button> : null}
                  {open ? <button type="button" className="gk-btn gk-btn--sm" onClick={() => status(row.id, 'COMPLETED')}>Done</button> : null}
                  {open ? <button type="button" className="gk-btn gk-btn--sm" onClick={() => status(row.id, 'CANCELLED')}>Cancel</button> : null}
                </td>
              </tr>
            );
          })}
          {!rows.length ? <tr><td colSpan={9} className="o-be-table__empty">No bookings yet — create one for this day</td></tr> : null}
        </tbody>
      </table>
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
      <table className="o-be-table gk-table">
        <thead><tr><th>Member</th><th>Phone</th><th>Plan</th><th>Status</th><th>Expires</th><th>Trainer</th></tr></thead>
        <tbody>
          {members.map((member) => (
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
          {plans.map((plan) => (
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
    </Shell>
  );
}

export function CheckInPage() {
  const { data, error, reload } = useLoad<{ checkIns: { id: string; member_name: string; facility_name: string; kind: string; payment_status: string; checked_in_at: string; checked_out_at: string | null }[] }>('/api/gym/checkins');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState<{ member: Member; outstanding: number; upcoming: { facility: string; start_at: string }[] } | null>(null);
  async function find(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      const members = await api<{ members: Member[] }>(`/api/gym/members?q=${encodeURIComponent(query)}`);
      const member = members.members[0];
      if (!member) {
        setProfile(null);
        setMessage('No visitor matched.');
        return;
      }
      setProfile(await api(`/api/gym/members/${member.id}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed');
    }
  }
  async function enter(payFee = false) {
    if (!profile) return;
    try {
      await api('/api/gym/checkins', { method: 'POST', body: JSON.stringify({ query: profile.member.id, payFee, method: 'CASH', guestFee: 200 }) });
      setMessage(payFee ? 'Checked in and day-pass payment recorded.' : 'Checked in.');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Check-in refused');
    }
  }
  const rows = data?.checkIns ?? [];
  return (
    <Shell title="Check-in" error={error}>
      <Head title="Check-in" />
      <form className="gk-toolbar" onSubmit={(event) => void find(event)}>
        <input className="gk-input" value={query} placeholder="Name, phone, or GK1001" aria-label="Find a visitor" onChange={(event) => setQuery(event.target.value)} />
        <button type="submit" className="gk-btn">Find</button>
      </form>
      {message ? <p className="gk-note">{message}</p> : null}
      {profile ? (
        <article className="o-track__card gk-found">
          <h3>{profile.member.name}</h3>
          <p>{profile.member.memberCode} · {profile.member.membershipStatus} · expires {profile.member.expiresAt?.slice(0, 10) ?? '—'}</p>
          <p>Outstanding {formatINR(profile.outstanding)} · {profile.upcoming[0] ? `${profile.upcoming[0].facility} ${when(profile.upcoming[0].start_at)}` : 'No booking today'}</p>
          <div className="gk-head-actions">
            <button type="button" className="gk-btn" onClick={() => void enter(false)}>Check in</button>
            <button type="button" className="gk-btn" onClick={() => void enter(true)}>Collect entry fee</button>
          </div>
        </article>
      ) : null}
      <table className="o-be-table gk-table">
        <thead><tr><th>Person</th><th>Place</th><th>Kind</th><th>In</th><th /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.member_name}</strong></td>
              <td>{row.facility_name}</td>
              <td>{row.kind} · {row.payment_status}</td>
              <td>{when(row.checked_in_at)}</td>
              <td className="gk-actions">
                {row.checked_out_at ? `Out ${clock(row.checked_out_at)}` : <button type="button" className="gk-btn gk-btn--sm" onClick={() => void act(() => api(`/api/gym/checkins/${row.id}/out`, { method: 'POST', body: '{}' }), 'Checked out', reload)}>Check out</button>}
              </td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={5} className="o-be-table__empty">No one is checked in — find a visitor above</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

type ClassRow = { id: string; name: string; category: string; trainer_name: string | null; trainer_phone: string | null; trainer_email: string | null; schedule: string; duration_minutes: number; capacity: number; price: number; description: string; is_private: number };
type TrainerRow = { id: string; name: string; phone: string; email?: string; specialization: string; availability: string; isActive?: boolean };
type Registration = { id: string; class_id: string; class_name?: string; name: string; status: string; attended: number };

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
      <table className="o-be-table gk-table">
        <thead><tr><th>Class</th><th>Trainer</th><th>Contact</th><th>Schedule</th><th>Places</th><th>Price</th><th /></tr></thead>
        <tbody>
          {classes.map((row) => (
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
      <div className="gk-section-row">
        <h3 className="gk-section">Trainers</h3>
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/trainers/new')}>Add trainer</button>
      </div>
      <table className="o-be-table gk-table">
        <thead><tr><th>Name</th><th>Sport</th><th>Phone</th><th>Email</th><th>Hours</th><th>Status</th></tr></thead>
        <tbody>
          {trainers.map((trainer) => (
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
        <thead><tr><th>Name</th><th>Class</th><th>Status</th><th /></tr></thead>
        <tbody>
          {registrations.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.name}</strong></td>
              <td>{row.class_name || '—'}</td>
              <td>{row.status === 'WAITLIST' ? 'Waitlist' : row.status === 'ATTENDED' ? 'Attended' : 'Registered'}</td>
              <td className="gk-actions">
                <button type="button" className="gk-btn gk-btn--sm" onClick={() => void act(() => api(`/api/gym/registrations/${row.id}/remove`, { method: 'POST', body: '{}' }), `${row.name} removed`, reload)}>Remove</button>
              </td>
            </tr>
          ))}
          {!registrations.length ? <tr><td colSpan={4} className="o-be-table__empty">No participants yet — add one from a class row</td></tr> : null}
        </tbody>
      </table>
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
      <table className="o-be-table gk-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Focus</th><th /></tr></thead>
        <tbody>
          {employees.map((row) => (
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

export function MaintenancePage() {
  const navigate = useNavigate();
  const { data, error, reload } = useLoad<{ records: { id: string; title: string; notes: string; status: string; starts_at: string; facility: string; actor?: string }[] }>('/api/gym/maintenance');
  const records = data?.records ?? [];
  return (
    <Shell title="Maintenance" error={error}>
      <Head title="Maintenance">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/maintenance/new')}>Add task</button>
      </Head>
      <table className="o-be-table gk-table">
        <thead><tr><th>Done</th><th>Facility</th><th>Task</th><th>Notes</th><th>Raised by</th><th>Started</th><th>Status</th></tr></thead>
        <tbody>
          {records.map((row) => (
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
              <td>{row.facility}</td>
              <td><strong>{row.title}</strong></td>
              <td>{row.notes || '—'}</td>
              <td>{row.actor || '—'}</td>
              <td>{when(row.starts_at)}</td>
              <td>{row.status === 'OPEN' ? 'Open' : 'Done'}</td>
            </tr>
          ))}
          {!records.length ? <tr><td colSpan={7} className="o-be-table__empty">No maintenance tasks yet — add one from this page</td></tr> : null}
        </tbody>
      </table>
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
  const { data, error, reload } = useLoad<{ shifts: ShiftRow[] }>('/api/gym/shifts');
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const open = (data?.shifts ?? []).filter((row) => !row.endedAt);
  const closed = (data?.shifts ?? []).filter((row) => row.endedAt);
  return (
    <Shell title="Shift" error={error}>
      <Head title="Shift">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/shift/new')}>Start my shift</button>
      </Head>
      {open.length ? (
        <div className="gk-shifts">
          {open.map((row) => (
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
          {closed.map((row) => (
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
  const sessions = data?.sessions ?? [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const todays = sessions.filter((row) => row.date === today);
  const collected = todays.filter((row) => row.payment.startsWith('Paid')).reduce((sum, row) => sum + row.amount, 0);
  return (
    <Shell title="Sessions" error={error}>
      <Head title="Sessions">
        <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/shift/new?role=trainer')}>Log sessions</button>
      </Head>
      <section className="o-track__status">
        <article className="o-track__stat o-track__stat--plain"><span>Sessions today</span><strong>{todays.length}</strong><em>Logged by trainers</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Minutes coached</span><strong>{todays.reduce((sum, row) => sum + row.minutes, 0)}</strong><em>Today</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>People coached</span><strong>{todays.reduce((sum, row) => sum + row.people, 0)}</strong><em>Today</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Collected</span><strong>{formatINR(collected)}</strong><em>Paid sessions today</em></article>
      </section>
      <table className="o-be-table gk-table">
        <thead><tr><th>Date</th><th>Trainer</th><th>Start</th><th>Minutes</th><th>Facility</th><th>Session</th><th>Type</th><th>People</th><th>Visitors</th><th>Amount</th><th>Payment</th></tr></thead>
        <tbody>
          {sessions.map((row) => (
            <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/shift/${row.shiftId}`)}>
              <td>{row.date === today ? 'Today' : row.date}</td>
              <td><strong>{row.trainerName}</strong></td>
              <td>{row.startTime}</td>
              <td>{row.minutes}</td>
              <td>{row.facility || '—'}</td>
              <td>{row.activity}</td>
              <td>{row.kind}</td>
              <td>{row.people}</td>
              <td className="gk-wrap">{row.visitors || '—'}</td>
              <td>{formatINR(row.amount)}</td>
              <td>{row.payment}</td>
            </tr>
          ))}
          {!sessions.length ? <tr><td colSpan={11} className="o-be-table__empty">No sessions yet — trainers log them from their shift at the end of the day</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

export function NotificationsPage() {
  const { data, error, reload } = useLoad<{ notifications: { id: string; title: string; body: string; created_at: string; read_at: string | null }[] }>('/api/gym/notifications');
  const rows = data?.notifications ?? [];
  return (
    <Shell title="Notifications" error={error}>
      <Head title="Notifications" />
      <table className="o-be-table gk-table">
        <thead><tr><th>Title</th><th>Message</th><th>When</th><th /></tr></thead>
        <tbody>
          {rows.map((row) => (
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
    </Shell>
  );
}
