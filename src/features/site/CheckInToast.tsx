import { useEffect, useState } from 'react';
import './checkInToast.css';

export type CheckInToastInfo = {
  name: string;
  already?: boolean;
  sport?: string;
};

export function CheckInToast({
  info,
  onDone,
}: {
  info: CheckInToastInfo;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    const hold = window.setTimeout(() => setPhase('out'), 6000);
    return () => window.clearTimeout(hold);
  }, []);

  useEffect(() => {
    if (phase !== 'out') return;
    const end = window.setTimeout(onDone, 520);
    return () => window.clearTimeout(end);
  }, [onDone, phase]);

  const line = info.already
    ? `${info.name}, you are already in`
    : `${info.name}, you are in`;

  return (
    <div className={`gkm-cin${phase === 'out' ? ' is-out' : ' is-in'}`} role="status" aria-live="polite">
      <div className="gkm-cin__card">
        <p className="gkm-cin__msg">{line}</p>
        {info.sport ? <p className="gkm-cin__sport">{info.sport}</p> : null}
        <div className="gkm-cin__mark" aria-hidden="true">
          <svg viewBox="0 0 52 52">
            <circle className="gkm-cin__ring" cx="26" cy="26" r="24" fill="none" />
            <path className="gkm-cin__tick" fill="none" d="M14.5 27.2l7.2 7.2 15.8-16.4" />
          </svg>
        </div>
      </div>
    </div>
  );
}
