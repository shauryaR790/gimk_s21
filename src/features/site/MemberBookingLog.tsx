import { useOutletContext } from 'react-router-dom';
import { clubDay } from './club';
import type { MemberCtx } from './MemberShell';

function tone(status: string) {
  if (status === 'APPROVED') return 'ok';
  if (status === 'DECLINED' || status === 'CANCELLED') return 'no';
  return 'wait';
}

function label(status: string) {
  if (status === 'APPROVED') return 'Approved';
  if (status === 'DECLINED') return 'Rejected';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Pending';
}

export function MemberBookingLog() {
  const { sessions } = useOutletContext<MemberCtx>();

  return (
    <section className="gkm-sheet">
      <p className="gkm-brand">GYMKHANA<br /><span>SECTOR 21</span></p>
      <div className="gkm-sheet__card">
        <h1>MY BOOKINGS</h1>
        {sessions.length ? (
          <ol className="gkm-log">
            {sessions.map((row) => (
              <li key={row.id} className="gkm-log__row">
                <div className="gkm-log__copy">
                  <strong>{clubDay(row.createdAt)}</strong>
                  <span>{row.sport}{row.preferredSlotLabel ? ` · ${row.preferredSlotLabel}` : ''}</span>
                  <p>{row.notes || 'Session booking'}</p>
                </div>
                <em className={`gkm-chip is-${tone(row.status)}`}>{label(row.status)}</em>
              </li>
            ))}
          </ol>
        ) : (
          <p className="gkm-empty">No bookings yet. Book a session from Bookings.</p>
        )}
      </div>
    </section>
  );
}
