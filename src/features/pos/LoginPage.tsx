import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/useTitle';
import {
  clearStaffSession,
  DESK_HOMES,
  deskModeFromRole,
  hasStaffSession,
  markStaffSession,
  setDeskMode,
} from './staffSession';

/** Demo counter PIN — signs in as the seeded staff user (see server env defaults). */
const DEMO_PIN = '2580';
const DEMO_EMAIL = 'admin@habs.cafe';
const DEMO_PASSWORD = 'habsos-admin';
const TRAINER_EMAIL = 'neha.kapoor@gymkhana.local';

type TrainerOption = { id: string; name: string; specialization: string; isActive?: boolean };

export function LoginPage() {
  useTitle('Gymkhana');
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<'desk' | 'trainer'>('desk');
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [picked, setPicked] = useState('');

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const me = await api<{ user: { id: string; role: string } }>('/api/auth/me');
        if (cancel) return;
        markStaffSession();
        const desk = deskModeFromRole(me.user.role);
        if (desk === 'trainer') {
          const linked = await api<{ trainer: { id: string } | null }>('/api/gym/me/trainer');
          if (linked.trainer?.id) {
            setDeskMode('trainer');
            navigate(DESK_HOMES.trainer, { replace: true });
            return;
          }
          await openTrainerPicker();
          setChecking(false);
          return;
        }
        setDeskMode(desk);
        navigate(DESK_HOMES[desk], { replace: true });
      } catch {
        if (cancel) return;
        if (hasStaffSession()) clearStaffSession();
        setChecking(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [navigate]);

  function openDesk(role?: string) {
    markStaffSession();
    const desk = deskModeFromRole(role);
    setDeskMode(desk);
    navigate(DESK_HOMES[desk], { replace: true });
  }

  async function loginWith(emailValue: string, passwordValue: string) {
    const user = await api<{ id: string; role: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: emailValue, password: passwordValue }),
    });
    return user;
  }

  async function openTrainerPicker() {
    markStaffSession();
    setDeskMode('trainer');
    const data = await api<{ trainers: TrainerOption[] }>('/api/gym/trainers');
    const list = data.trainers.filter((row) => row.isActive !== false);
    setTrainers(list);
    setPicked(list[0]?.id ?? '');
    setStep('trainer');
  }

  async function startTrainerDesk() {
    setBusy(true);
    setError(null);
    try {
      await loginWith(TRAINER_EMAIL, DEMO_PASSWORD);
      await openTrainerPicker();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Trainer sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmTrainer() {
    if (!picked) {
      setError('Choose who you are.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/api/gym/me/trainer/claim', { method: 'POST', body: JSON.stringify({ trainerId: picked }) });
      setDeskMode('trainer');
      navigate(DESK_HOMES.trainer, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that trainer desk.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPin(event: FormEvent) {
    event.preventDefault();
    if (pin.length < 4) {
      setError('Enter your 4-digit PIN.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (pin === DEMO_PIN) {
        const user = await loginWith(DEMO_EMAIL, DEMO_PASSWORD);
        openDesk(user.role);
        return;
      }
      setError('Wrong PIN.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await loginWith(email, password);
      if (deskModeFromRole(user.role) === 'trainer') {
        await openTrainerPicker();
        return;
      }
      openDesk(user.role);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="odoo-pos o-login">
        <div className="o-login__card o-login__card--busy">
          <img src="/ui/gymkhana-mark.png" alt="" className="o-login__logo" width={48} height={48} />
          <div className="o-loading-bar"><span /></div>
          <p>Opening Gymkhana…</p>
        </div>
      </main>
    );
  }

  if (step === 'trainer') {
    return (
      <main className="odoo-pos o-login">
        <div className="o-login__card">
          <div className="o-login__brand">
            <img src="/ui/gymkhana-mark.png" alt="" className="o-login__logo" width={48} height={48} />
            <div>
              <p className="o-login__eyebrow">Trainer desk</p>
              <h1>Who are you?</h1>
            </div>
          </div>
          <p className="o-login__hint">Requests you approve are assigned to the trainer you pick.</p>
          <fieldset className="o-login__who">
            <legend>Trainer</legend>
            <div className="o-login__who-row o-login__who-row--trainers">
              {trainers.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`o-login__who-btn${picked === row.id ? ' is-on' : ''}`}
                  onClick={() => setPicked(row.id)}
                >
                  <strong>{row.name}</strong>
                  <span>{row.specialization || 'Trainer'}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {error ? <p className="o-login__error" role="alert">{error}</p> : null}
          <button type="button" className="o-btn o-btn--primary o-login__submit" disabled={busy || !picked} onClick={() => void confirmTrainer()}>
            {busy ? 'Opening…' : 'Continue'}
          </button>
          <button type="button" className="o-login__toggle" disabled={busy} onClick={() => { setStep('desk'); setError(null); }}>
            Back to register login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="odoo-pos o-login">
      <form className="o-login__card" onSubmit={(event) => void submitPin(event)}>
        <div className="o-login__brand">
          <img src="/ui/gymkhana-mark.png" alt="" className="o-login__logo" width={48} height={48} />
          <div>
            <p className="o-login__eyebrow">Gymkhana</p>
            <h1>Sign in</h1>
          </div>
        </div>
        <label className="o-login__field">
          <span>PIN</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            maxLength={6}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••"
          />
        </label>
        {error ? <p className="o-login__error" role="alert">{error}</p> : null}
        <button type="submit" className="o-btn o-btn--primary o-login__submit" disabled={busy} aria-busy={busy}>
          {busy ? 'Opening register…' : 'Enter register'}
        </button>
        <button type="button" className="o-login__toggle" disabled={busy} onClick={() => void startTrainerDesk()}>
          Open trainer desk
        </button>
        <button type="button" className="o-login__toggle" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? 'Hide email sign-in' : 'Email & password instead'}
        </button>
      </form>

      {showAdvanced ? (
        <form className="o-login__card o-login__card--advanced" onSubmit={(event) => void submitEmail(event)}>
          <label className="o-login__field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="o-login__field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit" className="o-btn o-login__submit" disabled={busy}>
            Sign in with email
          </button>
        </form>
      ) : null}

      <p className="o-login__foot">
        First sign-in needs internet. After that, the register works offline.
      </p>
    </main>
  );
}
