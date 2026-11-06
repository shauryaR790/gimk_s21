import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import ball from './assets/ball.png';
import curtains from './assets/curtains.jpg';
import './register.css';

function Eye({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.6 10.7a2.2 2.2 0 0 0 3 3M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a16.7 16.7 0 0 1-3.3 4.1M6.5 6.6C4 8.5 2 12 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.1-.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    document.title = 'Login · Gymkhana';
    document.documentElement.classList.add('gkf-page');
    document.body.classList.add('gkf-page');
    return () => {
      document.documentElement.classList.remove('gkf-page');
      document.body.classList.remove('gkf-page');
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNote('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Enter a valid email.');
      return;
    }
    if (password.length < 4 || password.length > 120) {
      setError('Enter a password of at least 4 characters.');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ ok: boolean; pending?: boolean }>('/api/portal/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (data.pending) {
        setNote('Your registration is still being confirmed. We will write to this email when it is ready.');
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="gkf is-login" style={{ backgroundImage: `url(${curtains})` }}>
      <div className="gkf-sheet">
        <header className="gkf-head">
          <Link to="/" className="gkf-mark">GYMKHANA</Link>
          <h1>LOGIN</h1>
          <img className="gkf-orb" src={ball} alt="" />
        </header>
        <form className="gkf-form" onSubmit={(event) => void submit(event)} noValidate>
          <label className="gkf-field">
            <span>Email</span>
            <input type="email" value={email} autoComplete="email" onChange={(event) => { setError(''); setEmail(event.target.value); }} />
          </label>

          <label className="gkf-field">
            <span>Password</span>
            <span className="gkf-secret">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                onChange={(event) => { setError(''); setPassword(event.target.value); }}
              />
              <button
                type="button"
                className="gkf-secret__eye"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowPassword((open) => !open)}
              >
                <Eye open={showPassword} />
              </button>
            </span>
          </label>

          {error ? <p className="gkf-error" role="alert">{error}</p> : null}
          {note ? <p className="gkf-error" role="status">{note}</p> : null}

          <div className="gkf-foot">
            <button type="submit" className="gkf-confirm" disabled={busy}>{busy ? 'SIGNING IN' : 'CONFIRM'}</button>
          </div>
        </form>
      </div>
    </main>
  );
}
