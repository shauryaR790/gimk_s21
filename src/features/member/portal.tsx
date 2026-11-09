import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { formatINR } from '../../../shared/domain';
import { api } from '../../lib/api';
import { clearMemberPass, saveMemberPass } from '../../lib/memberPass';
import { useTitle } from '../../lib/useTitle';

type Home = {
  plans: { id: string; name: string; durationDays: number; price: number; description: string; discountBps: number; guestPasses: number; isActive: boolean }[];
  facilities: { id: string; name: string; sport: string; location: string; memberPrice: number; guestPrice: number; slotMinutes: number; isAvailable: boolean }[];
  announcements: { id: string; title: string; body: string }[];
  classes: { id: string; name: string; category: string; schedule: string; price: number; description: string }[];
  member: {
    member: { id: string; name: string; memberCode: string; membershipStatus: string; planName: string; expiresAt: string | null; email: string; emergencyContact: string; mobile: string };
    bookings: { id: string; sport: string; facility: string; start_at: string; end_at: string; amount: number; payment_status: string; status: string }[];
    payments: { id: string; order_number: number; total: number; payment_status: string; created_at: string }[];
    upcoming: { id: string; facility: string; start_at: string; status: string }[];
    outstanding: number;
  } | null;
  razorpay: boolean;
};

const LINKS = [
  ['/', 'Home'],
  ['/member/book', 'Book Facilities'],
  ['/member/plans', 'Memberships'],
  ['/member/bookings', 'My Bookings'],
  ['/member/classes', 'Classes & Coaching'],
  ['/member/events', 'Events'],
  ['/member/payments', 'Payments'],
  ['/member/profile', 'Profile'],
] as const;

export function MemberNav() {
  return (
    <header className="ad-guest-hero-nav ad-guest-hero-nav--surface" aria-label="Member">
      <Link className="ad-guest-hero-nav-brand" to="/">Gymkhana</Link>
      <nav className="ad-guest-hero-nav-links" aria-label="Member">
        {LINKS.map(([to, label]) => (
          <Link key={to} to={to} className="ad-guest-hero-nav-link">{label}</Link>
        ))}
      </nav>
    </header>
  );
}

function useHome() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState('');
  async function reload() {
    try {
      setHome(await api<Home>('/api/portal/home'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the member portal.');
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  return { home, error, reload };
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  useTitle(title);
  return (
    <main className="cust" style={{ padding: 24 }}>
      <MemberNav />
      <div style={{ paddingTop: 24 }}>{children}</div>
    </main>
  );
}

export function MemberHomePage() {
  const { home, error } = useHome();
  const [qr, setQr] = useState('');
  const member = home?.member?.member;
  useEffect(() => {
    if (!member) return;
    void QRCode.toDataURL(member.memberCode || member.id, { margin: 1, width: 180 }).then(setQr);
  }, [member]);
  return (
    <Frame title="Gymkhana">
      {error ? <p>{error}</p> : null}
      <h1>Welcome{member ? `, ${member.name}` : ''}</h1>
      {member ? (
        <article>
          <p>{member.planName || 'No plan'} · {member.membershipStatus} · expires {member.expiresAt?.slice(0, 10) ?? '—'}</p>
          {qr ? <img src={qr} alt={`Membership QR ${member.memberCode}`} width={180} height={180} /> : null}
          <p>Member ID {member.memberCode}</p>
          <h2>Upcoming</h2>
          <ul>{(home?.member?.upcoming ?? []).map((row) => <li key={row.id}>{row.facility} · {new Date(row.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</li>)}</ul>
        </article>
      ) : (
        <p>Sign in from Profile with the mobile number on your membership.</p>
      )}
      <h2>Facilities</h2>
      <ul>{(home?.facilities ?? []).map((facility) => <li key={facility.id}>{facility.name} · {facility.sport} · member {formatINR(facility.memberPrice)}</li>)}</ul>
      <h2>Announcements</h2>
      <ul>{(home?.announcements ?? []).map((row) => <li key={row.id}><strong>{row.title}</strong> {row.body}</li>)}</ul>
      <p><Link to="/member/book">Book a facility</Link></p>
    </Frame>
  );
}

export function MemberBookPage() {
  const { home, error, reload } = useHome();
  const [facilityId, setFacilityId] = useState('');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [slots, setSlots] = useState<{ start: string; end: string; free: boolean }[]>([]);
  const [note, setNote] = useState('');
  const [people, setPeople] = useState(1);
  useEffect(() => {
    if (!facilityId) return;
    void api<{ slots: { start: string; end: string; free: boolean }[] }>(`/api/portal/slots?facilityId=${facilityId}&date=${date}`)
      .then((result) => setSlots(result.slots))
      .catch((err: unknown) => setNote(err instanceof Error ? err.message : 'Could not load slots'));
  }, [facilityId, date]);
  async function book(start: string) {
    setNote('');
    try {
      const result = await api<{ note: string }>('/api/portal/bookings', {
        method: 'POST',
        body: JSON.stringify({ facilityId, startAt: start, participants: people }),
      });
      setNote(result.note);
      await reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Booking failed');
    }
  }
  return (
    <Frame title="Book facilities">
      {error ? <p>{error}</p> : null}
      <h1>Book a facility</h1>
      <p>{home?.razorpay ? 'Online card and UPI can be confirmed with Razorpay.' : 'Online payment is not configured. A booking stays unpaid until the desk records cash, UPI, or card.'}</p>
      <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
        <option value="">Choose a sport facility</option>
        {(home?.facilities ?? []).map((facility) => <option key={facility.id} value={facility.id}>{facility.sport} · {facility.name}</option>)}
      </select>
      <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      <input type="number" min={1} value={people} onChange={(event) => setPeople(Number(event.target.value))} aria-label="Participants" />
      <ul>
        {slots.map((slot) => (
          <li key={slot.start}>
            {new Date(slot.start).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
            {slot.free ? <button type="button" onClick={() => void book(slot.start)}>Reserve</button> : ' Booked'}
          </li>
        ))}
      </ul>
      {note ? <p>{note}</p> : null}
    </Frame>
  );
}

export function MemberPlansPage() {
  const { home, error } = useHome();
  return (
    <Frame title="Memberships">
      {error ? <p>{error}</p> : null}
      <h1>Memberships</h1>
      {home?.member ? <p>Current plan: {home.member.member.planName || 'None'} · {home.member.member.membershipStatus}</p> : null}
      <ul>
        {(home?.plans ?? []).map((plan) => (
          <li key={plan.id}>
            <strong>{plan.name}</strong> · {plan.durationDays} days · {formatINR(plan.price)} · {plan.description}
            <div>Discount {plan.discountBps / 100}% · guest passes {plan.guestPasses}</div>
          </li>
        ))}
      </ul>
      <p><Link to="/join">Buy a membership online</Link>: pick your sport, add your details, choose a plan and pay. You can also buy or renew at reception.</p>
    </Frame>
  );
}

export function MemberBookingsPage() {
  const { home, error, reload } = useHome();
  const rows = home?.member?.bookings ?? [];
  async function cancel(id: string) {
    await api(`/api/portal/bookings/${id}/cancel`, { method: 'POST', body: '{}' });
    await reload();
  }
  return (
    <Frame title="My bookings">
      {error ? <p>{error}</p> : null}
      <h1>My bookings</h1>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.facility} · {row.sport} · {new Date(row.start_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {row.status} · {row.payment_status} · {formatINR(row.amount)}
            {row.status === 'CONFIRMED' && row.payment_status !== 'PAID' ? <button type="button" onClick={() => void cancel(row.id)}>Cancel</button> : null}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function MemberClassesPage() {
  const { home, error } = useHome();
  return (
    <Frame title="Classes">
      {error ? <p>{error}</p> : null}
      <h1>Classes and coaching</h1>
      <ul>{(home?.classes ?? []).map((row) => <li key={row.id}><strong>{row.name}</strong> · {row.category} · {row.schedule} · {formatINR(row.price)} · {row.description}</li>)}</ul>
      <p>Ask reception to add you. Private coaching is booked as a facility hour plus a coach.</p>
    </Frame>
  );
}

export function MemberEventsPage() {
  const { home, error } = useHome();
  return (
    <Frame title="Events">
      {error ? <p>{error}</p> : null}
      <h1>Events</h1>
      <ul>{(home?.announcements ?? []).map((row) => <li key={row.id}><strong>{row.title}</strong> {row.body}</li>)}</ul>
    </Frame>
  );
}

export function MemberPaymentsPage() {
  const { home, error } = useHome();
  return (
    <Frame title="Payments">
      {error ? <p>{error}</p> : null}
      <h1>Payments</h1>
      <p>Outstanding {formatINR(home?.member?.outstanding ?? 0)}</p>
      <ul>
        {(home?.member?.payments ?? []).map((row) => (
          <li key={row.id}>Bill {row.order_number} · {formatINR(row.total)} · {row.payment_status} · {new Date(row.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</li>
        ))}
      </ul>
    </Frame>
  );
}

export function MemberProfilePage() {
  const { home, error, reload } = useHome();
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [emergency, setEmergency] = useState('');
  const [prefs, setPrefs] = useState('sms,email');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!home?.member) return;
    setEmail(home.member.member.email || '');
    setEmergency(home.member.member.emergencyContact || '');
  }, [home]);
  async function login(event: FormEvent) {
    event.preventDefault();
    try {
      const data = await api<{ ok: boolean; memberToken?: string }>('/api/portal/login', { method: 'POST', body: JSON.stringify({ mobile }) });
      saveMemberPass(data.memberToken);
      setNote('Signed in.');
      await reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Sign-in failed');
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await api('/api/portal/me', { method: 'PATCH', body: JSON.stringify({ email, emergencyContact: emergency, notifyPrefs: prefs }) });
    setNote('Profile saved.');
    await reload();
  }
  return (
    <Frame title="Profile">
      {error ? <p>{error}</p> : null}
      <h1>Profile</h1>
      <form onSubmit={(event) => void login(event)}>
        <label>Mobile <input value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="10-digit mobile" /></label>
        <button type="submit">Sign in</button>
      </form>
      {home?.member ? (
        <form onSubmit={(event) => void save(event)}>
          <p>{home.member.member.name} · {home.member.member.memberCode}</p>
          <label>Email <input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Emergency contact <input value={emergency} onChange={(event) => setEmergency(event.target.value)} /></label>
          <label>Notifications <input value={prefs} onChange={(event) => setPrefs(event.target.value)} /></label>
          <button type="submit">Save</button>
          <button type="button" onClick={() => { clearMemberPass(); void api('/api/portal/logout', { method: 'POST', body: '{}' }).then(reload); }}>Sign out</button>
        </form>
      ) : null}
      {note ? <p>{note}</p> : null}
    </Frame>
  );
}
