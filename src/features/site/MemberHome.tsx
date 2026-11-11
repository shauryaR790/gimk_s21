import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { SIGNUP_ACTIVITIES } from '../../../shared/activities';
import { SLOT_HOURS } from '../../../shared/slots';
import { api } from '../../lib/api';
import { clearMemberPass } from '../../lib/memberPass';
import { Dropdown } from '../pos/gym/record';
import silk from './assets/member-silk.jpg';
import memberOrb from './assets/member-orb.png';
import { SportMark } from './sportMarks';
import './site.css';
import './member.css';

type MemberCard = {
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

type Home = {
  member: { member: MemberCard } | null;
};

function clubDay(value: string | null | undefined) {
  if (!value) return '— —';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '— —';
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

function yearOn(start: string | null | undefined) {
  if (!start) return null;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return null;
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

function badgeCode(code: string) {
  const digits = code.replace(/^GK/i, '').replace(/\D/g, '');
  return digits || code || '—';
}

function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function MemberHome() {
  const navigate = useNavigate();
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState('');
  const [sport, setSport] = useState('');
  const [date, setDate] = useState(todayIso);
  const [time, setTime] = useState('18:00');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const member = home?.member?.member;
  const activities = member?.activities?.length ? member.activities : [];
  const started = member?.startsAt || member?.registeredAt || null;
  const ends = member?.expiresAt || yearOn(started);

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
    let live = true;
    void api<Home>('/api/portal/home')
      .then((data) => {
        if (!live) return;
        if (!data.member?.member) {
          navigate('/login', { replace: true });
          return;
        }
        setHome(data);
        const first = data.member.member.activities?.[0] ?? '';
        if (first) setSport(first);
      })
      .catch((err: unknown) => {
        if (!live) return;
        clearMemberPass();
        navigate('/login', { replace: true, state: { error: err instanceof Error ? err.message : 'Sign in again.' } });
      });
    return () => {
      live = false;
    };
  }, [navigate]);

  const times = useMemo(() => SLOT_HOURS.map((hour) => ({ value: hour, label: `${hour}` })), []);
  const sportOptions = SIGNUP_ACTIVITIES.map((name) => ({ value: name, label: name }));
  const status = member?.membershipStatus === 'ACTIVE' ? 'Active' : (member?.membershipStatus || 'Pending');

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNote('');
    if (!sport) {
      setError('Choose a sport.');
      return;
    }
    if (!date || !time) {
      setError('Choose a date and time.');
      return;
    }
    setBusy(true);
    try {
      const startAt = new Date(`${date}T${time}:00+05:30`).toISOString();
      const data = await api<{ note?: string }>('/api/portal/sessions', {
        method: 'POST',
        body: JSON.stringify({ sport, startAt }),
      });
      setNote(data.note || 'Request sent to the desk.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request.');
    } finally {
      setBusy(false);
    }
  }

  if (!member) return <main className="gkm" style={{ backgroundImage: `url(${silk})` }} />;

  return (
    <main className="gkm" style={{ backgroundImage: `url(${silk})` }}>
      <header className="gkm-head">
        <img className="gkm-orb" src={memberOrb} alt="" />
        <h1>{member.name}</h1>
        <p className="gkm-code">{badgeCode(member.memberCode)}</p>
      </header>

      <section className="gkm-panel">
        <p className="gkm-status">
          Membership Status: <em>{status}</em>
        </p>

        <h2>Your Activities</h2>
        {activities.length ? (
          <ul className="gka-cards gkm-activities">
            {activities.map((name) => (
              <li key={name} className="gka-card">
                <div className="gka-card__copy">
                  <strong>{name}</strong>
                  <p>{clubDay(started)}</p>
                  <p>Your membership ends on {clubDay(ends)}</p>
                </div>
                <SportMark sport={name} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="gkm-empty">No activities yet — they appear here from registration.</p>
        )}

        <div className="gkm-book-block">
          <h2 className="gkm-book-title">Book a Session</h2>
          <form className="gkm-book" onSubmit={(event) => void sendRequest(event)}>
            <div className="gkm-field">
              <span>Sport</span>
              <Dropdown
                label="Sport"
                placeholder="Select sport"
                value={sport}
                options={sportOptions}
                onChange={setSport}
              />
            </div>
            <label className="gkm-field">
              <span>Date</span>
              <input type="date" value={date} min={todayIso()} onChange={(event) => setDate(event.target.value)} />
            </label>
            <div className="gkm-field">
              <span>Time slot</span>
              <Dropdown
                label="Time slot"
                placeholder="Select time"
                value={time}
                options={times}
                onChange={setTime}
              />
            </div>
            {error ? <p className="gkm-error" role="alert">{error}</p> : null}
            {note ? <p className="gkm-note" role="status">{note}</p> : null}
            <button type="submit" className="gk-btn gkm-send" disabled={busy}>{busy ? 'Sending' : 'Send request'}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
