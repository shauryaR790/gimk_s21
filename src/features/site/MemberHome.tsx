import { Link, useOutletContext } from 'react-router-dom';
import { badgeCode, clubDay, dashboardNews, renewDay, yearOn } from './club';
import type { MemberCtx } from './MemberShell';
import memberOrb from './assets/member-orb.png';

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

export function MemberHome() {
  const { member, announcements, sessions } = useOutletContext<MemberCtx>();
  const news = dashboardNews(announcements);
  const ends = member.expiresAt || yearOn(member.startsAt || member.registeredAt);
  const active = member.membershipStatus === 'ACTIVE';
  const upcoming = sessions.slice(0, 3);
  const sports = (member.activities ?? []).filter(Boolean).slice(0, 4);

  return (
    <section className="gkm-dash">
      <header className="gkm-head">
        <div className="gkm-orb-wrap">
          <img className="gkm-orb" src={memberOrb} alt="" />
        </div>
        <h1>{member.name}</h1>
        <p className="gkm-code">{badgeCode(member.memberCode)}</p>
      </header>
      <article className="gkm-glass">
        <p className="gkm-news">{news.body}</p>

        <div className="gkm-panel">
          <div className="gkm-panel__row">
            <div className="gkm-stat">
              <span>Next booking</span>
              <strong>
                {upcoming[0]
                  ? (upcoming[0].preferredSlotLabel || clubDay(upcoming[0].createdAt))
                  : 'None yet'}
              </strong>
            </div>
            <div className="gkm-stat">
              <span>Open requests</span>
              <strong>{sessions.filter((row) => !['APPROVED', 'DECLINED', 'CANCELLED'].includes(row.status)).length}</strong>
            </div>
          </div>

          {sports.length ? (
            <p className="gkm-sports">
              <span>Your sports</span>
              <strong>{sports.join(' · ')}</strong>
            </p>
          ) : null}

          {upcoming.length ? (
            <ul className="gkm-next">
              {upcoming.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.sport}</strong>
                    <span>{row.preferredSlotLabel || clubDay(row.createdAt)}</span>
                  </div>
                  <em className={`gkm-chip is-${tone(row.status)}`}>{label(row.status)}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gkm-panel__empty">No bookings yet. Lock a court from Bookings.</p>
          )}

          <nav className="gkm-quick" aria-label="Quick actions">
            <Link to="/member/bookings">Book a session</Link>
            <Link to="/member/bookings/mine">My bookings</Link>
            <Link to="/member/report">Report</Link>
          </nav>
        </div>

        <p className="gkm-status">
          Membership Status: <em className={active ? 'is-on' : 'is-off'}>{active ? 'Active' : (member.membershipStatus || 'Pending')}</em>
          <span>Auto Renews on {renewDay(ends)}</span>
        </p>
      </article>
    </section>
  );
}
