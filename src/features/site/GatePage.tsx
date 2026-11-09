import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ARENA_SPORTS, arenaSlug, sportFromSlug } from '../../../shared/activities';
import { ApiError, api } from '../../lib/api';
import { readMemberPass, saveMemberPass } from '../../lib/memberPass';
import curtains from './assets/curtains.jpg';
import './register.css';

type GateState =
  | { kind: 'working' }
  | { kind: 'in'; name: string; sport: string; already: boolean }
  | { kind: 'auth'; sport: string }
  | { kind: 'error'; message: string };

const gateScan = new Map<string, Promise<{ ok: boolean; already?: boolean; name: string; sport: string }>>();

function scanGate(sport: string) {
  const open = gateScan.get(sport);
  if (open) return open;
  const request = api<{ ok: boolean; already?: boolean; name: string; sport: string; memberToken?: string }>('/api/portal/gate', {
    method: 'POST',
    body: JSON.stringify({ activity: sport, memberToken: readMemberPass() }),
  }).then((data) => {
    saveMemberPass(data.memberToken);
    return data;
  }).finally(() => {
    window.setTimeout(() => gateScan.delete(sport), 1500);
  });
  gateScan.set(sport, request);
  return request;
}

export function GatePage() {
  const { sport: slug = '' } = useParams();
  const sport = sportFromSlug(slug) || ARENA_SPORTS.find((name) => name.toLowerCase() === slug.toLowerCase()) || '';
  const [state, setState] = useState<GateState>({ kind: 'working' });
  const next = `/in/${sport ? arenaSlug(sport) : slug}`;

  useEffect(() => {
    document.title = sport ? `${sport} · Gymkhana` : 'Gate · Gymkhana';
    document.documentElement.classList.add('gkf-page');
    document.body.classList.add('gkf-page');
    return () => {
      document.documentElement.classList.remove('gkf-page');
      document.body.classList.remove('gkf-page');
    };
  }, [sport]);

  useEffect(() => {
    if (!sport) {
      setState({ kind: 'error', message: 'This gate is not an activity.' });
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        const data = await scanGate(sport);
        if (cancel) return;
        setState({ kind: 'in', name: data.name, sport: data.sport, already: Boolean(data.already) });
      } catch (err) {
        if (cancel) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'auth', sport });
          return;
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check you in.' });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [sport]);

  return (
    <main className="gkf is-login" style={{ backgroundImage: `url(${curtains})` }}>
      <div className="gkf-sheet gkg">
        <header className="gkf-head">
          <Link to="/" className="gkf-mark">GYMKHANA</Link>
          <h1>{sport || 'GATE'}</h1>
        </header>
        {state.kind === 'working' ? <p className="gkg-copy">Checking you in…</p> : null}
        {state.kind === 'in' ? (
          <p className="gkg-copy">
            {state.already ? `${state.name}, you are already in ${state.sport}.` : `${state.name}, you are in ${state.sport}.`}
            {' '}Your box is green on the activities board.
          </p>
        ) : null}
        {state.kind === 'auth' ? (
          <>
            <p className="gkg-copy">First time on this phone, register once. After that, open the camera and scan — you are in. No login.</p>
            <div className="gkg-actions">
              <Link className="gkf-confirm" to={`/register?activity=${encodeURIComponent(state.sport)}&next=${encodeURIComponent(next)}`}>Register</Link>
              <Link className="gkg-alt" to={`/login?next=${encodeURIComponent(next)}`}>Different phone?</Link>
            </div>
          </>
        ) : null}
        {state.kind === 'error' ? <p className="gkg-copy">{state.message}</p> : null}
      </div>
    </main>
  );
}
