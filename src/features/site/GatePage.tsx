import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ARENA_SPORTS, sportFromSlug } from '../../../shared/activities';
import { ApiError, api } from '../../lib/api';
import { readMemberPass, saveMemberPass } from '../../lib/memberPass';
import { SilkFilm } from './silk';
import './register.css';

type GateState =
  | { kind: 'working' }
  | { kind: 'auth'; sport: string; door: boolean }
  | { kind: 'error'; message: string };

type GateResult = {
  ok: boolean;
  already?: boolean;
  name: string;
  sport: string;
  activity?: string;
  facility?: string;
  door?: boolean;
  memberToken?: string;
};

const gateScan = new Map<string, Promise<GateResult>>();

async function restorePass() {
  if (readMemberPass()) return readMemberPass();
  try {
    const session = await api<{ memberToken?: string | null }>('/api/portal/session');
    saveMemberPass(session.memberToken);
  } catch {
    /* stay signed out */
  }
  return readMemberPass();
}

function scanGate(activity: string) {
  const key = activity || 'door';
  const open = gateScan.get(key);
  if (open) return open;
  const request = api<GateResult>('/api/portal/gate', {
    method: 'POST',
    body: JSON.stringify({ activity, memberToken: readMemberPass() }),
  }).then((data) => {
    saveMemberPass(data.memberToken);
    return data;
  }).finally(() => {
    window.setTimeout(() => gateScan.delete(key), 1500);
  });
  gateScan.set(key, request);
  return request;
}

export function GatePage() {
  const navigate = useNavigate();
  const { sport: slug = '' } = useParams();
  const sport = sportFromSlug(slug) || ARENA_SPORTS.find((name) => name.toLowerCase() === slug.toLowerCase()) || '';
  const door = !slug;
  const [state, setState] = useState<GateState>({ kind: 'working' });
  const next = '/member';

  useEffect(() => {
    document.title = door ? 'Door · Gymkhana' : sport ? `${sport} · Gymkhana` : 'Gate · Gymkhana';
    document.documentElement.classList.add('gkf-page');
    document.body.classList.add('gkf-page');
    return () => {
      document.documentElement.classList.remove('gkf-page');
      document.body.classList.remove('gkf-page');
    };
  }, [door, sport]);

  useEffect(() => {
    if (!door && !sport) {
      setState({ kind: 'error', message: 'This gate is not an activity.' });
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        await restorePass();
        await scanGate(sport);
        if (cancel) return;
        navigate('/member', { replace: true });
      } catch (err) {
        if (cancel) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'auth', sport: sport || '', door });
          return;
        }
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not check you in.' });
      }
    })();
    return () => {
      cancel = true;
    };
  }, [door, navigate, sport]);

  return (
    <main className="gkf is-login">
      <SilkFilm className="gkf-film" />
      <div className="gkf-sheet gkg">
        <header className="gkf-head">
          <Link to="/" className="gkf-mark">GYMKHANA</Link>
          <h1>{door ? 'DOOR' : sport || 'GATE'}</h1>
        </header>
        {state.kind === 'working' ? <p className="gkg-copy">Checking you in…</p> : null}
        {state.kind === 'auth' ? (
          <>
            <p className="gkg-copy">
              Register once on this phone. After that, scan the door QR with your camera.
            </p>
            <div className="gkg-actions gkg-actions--foot">
              <Link className="gkg-alt" to={`/login?next=${encodeURIComponent(next)}`}>Already registered? Login</Link>
              <Link
                className="gkf-confirm"
                to={`/register?${state.sport ? `activity=${encodeURIComponent(state.sport)}&` : ''}next=${encodeURIComponent(next)}`}
              >
                Register once
              </Link>
            </div>
          </>
        ) : null}
        {state.kind === 'error' ? <p className="gkg-copy">{state.message}</p> : null}
      </div>
    </main>
  );
}
