import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { SIGNUP_ACTIVITIES } from '../../../shared/activities';
import { SLOT_HOURS } from '../../../shared/slots';
import { api } from '../../lib/api';
import { Dropdown } from '../pos/gym/record';
import { todayIso, upcomingDates } from './club';
import { DoneScreen } from './DoneScreen';
import type { MemberCtx } from './MemberShell';

export function MemberBookings() {
  const navigate = useNavigate();
  const { reload } = useOutletContext<MemberCtx>();
  const [venue, setVenue] = useState('');
  const [slot, setSlot] = useState('18:00');
  const [date, setDate] = useState(todayIso);
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const venues = SIGNUP_ACTIVITIES.map((name) => ({ value: name, label: name }));
  const times = useMemo(() => SLOT_HOURS.map((hour) => ({ value: hour, label: hour })), []);
  const dates = useMemo(() => upcomingDates(21), []);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!venue) {
      setError('Choose a venue.');
      return;
    }
    if (!date || !slot) {
      setError('Choose a date and time slot.');
      return;
    }
    setBusy(true);
    try {
      const startAt = new Date(`${date}T${slot}:00+05:30`).toISOString();
      await api<{ note?: string }>('/api/portal/sessions', {
        method: 'POST',
        body: JSON.stringify({ sport: venue, startAt, purpose, remarks }),
      });
      setPurpose('');
      setRemarks('');
      reload();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that request.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <DoneScreen
        copy="Your booking request has been Completed you will receive the final confirmation on your registered mail id"
        onContinue={() => navigate('/member/bookings/mine', { replace: true })}
      />
    );
  }

  return (
    <section className="gkm-sheet">
      <p className="gkm-brand">GYMKHANA<br /><span>SECTOR 21</span></p>
      <form className="gkm-form" onSubmit={(event) => void send(event)}>
        <div className="gkm-sheet__card">
          <h1>BOOKINGS</h1>
          <div className="gkm-field">
            <span>Venue</span>
            <Dropdown label="Venue" placeholder="Basketball, badminton, courts…" value={venue} options={venues} onChange={setVenue} />
          </div>
          <div className="gkm-field">
            <span>Time Slot</span>
            <Dropdown label="Time Slot" placeholder="Select" value={slot} options={times} onChange={setSlot} />
          </div>
          <div className="gkm-field">
            <span>Date</span>
            <Dropdown label="Date" placeholder="Select" value={date} options={dates} onChange={setDate} />
          </div>
          <label className="gkm-field">
            <span>Purpose</span>
            <input
              type="text"
              value={purpose}
              maxLength={400}
              autoComplete="off"
              onChange={(event) => setPurpose(event.target.value)}
            />
          </label>
          <label className="gkm-field">
            <span>Remarks</span>
            <input
              type="text"
              value={remarks}
              maxLength={400}
              autoComplete="off"
              onChange={(event) => setRemarks(event.target.value)}
            />
          </label>
          {error ? <p className="gkm-error" role="alert">{error}</p> : null}
          <button type="submit" className="gkm-submit" disabled={busy}>{busy ? 'SENDING' : 'SUBMIT'}</button>
        </div>
      </form>
    </section>
  );
}
