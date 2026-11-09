import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { gateNext, matchActivity, SIGNUP_ACTIVITIES } from '../../../shared/activities';
import { api } from '../../lib/api';
import { readIdImage } from '../../lib/idImage';
import { saveMemberPass } from '../../lib/memberPass';
import { Dropdown } from '../pos/gym/record';
import ball from './assets/ball.png';
import curtains from './assets/curtains.jpg';
import dumbbells from './assets/dumbbells.png';
import star from './assets/star.png';
import { makeDemoMember } from './demoMember';
import { readFile } from './photo';
import './register.css';

type Filed = {
  ref: string;
  wantsTrainer: boolean;
};

type Slot = 'portrait' | 'id';

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ') || firstName;
  return { firstName, lastName };
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = gateNext(params.get('next'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mobile, setMobile] = useState('');
  const [activity, setActivity] = useState(() => matchActivity(params.get('activity') ?? ''));
  const [trainer, setTrainer] = useState<'yes' | 'no' | ''>('');
  const [portrait, setPortrait] = useState('');
  const [portraitName, setPortraitName] = useState('');
  const [idPhoto, setIdPhoto] = useState('');
  const [idName, setIdName] = useState('');
  const [over, setOver] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filed, setFiled] = useState<Filed | null>(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    document.title = 'Registration · Gymkhana';
    document.documentElement.classList.add('gkf-page');
    document.body.classList.add('gkf-page');
    return () => {
      document.documentElement.classList.remove('gkf-page');
      document.body.classList.remove('gkf-page');
    };
  }, []);

  const takeFile = useCallback(async (slot: Slot, file?: File | null) => {
    if (!file) return;
    try {
      setError('');
      if (slot === 'portrait') {
        if (!file.type.startsWith('image/')) throw new Error('Photograph is your personal photo.');
        const url = await readFile(file);
        setPortrait(url);
        setPortraitName(file.name);
        return;
      }
      if (!file.type.startsWith('image/')) throw new Error('Upload a photo of the ID, nothing else.');
      const shot = await readIdImage(file);
      setIdPhoto(shot);
      setIdName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take that file.');
    }
  }, []);

  function drop(slot: Slot, event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(null);
    void takeFile(slot, event.dataTransfer.files[0]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const { firstName, lastName } = splitName(fullName);
    if (!firstName || !lastName) {
      setError('Enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('Enter a valid email.');
      return;
    }
    if (password.length < 4 || password.length > 120) {
      setError('Enter a password of at least 4 characters.');
      return;
    }
    if (mobile.replace(/\D/g, '').length < 10) {
      setError('Enter a 10-digit contact number.');
      return;
    }
    if (!activity) {
      setError('Select an activity.');
      return;
    }
    if (!trainer) {
      setError('Say if you want a trainer.');
      return;
    }
    if (!portrait) {
      setError('Upload a photograph of yourself.');
      return;
    }
    if (!idPhoto) {
      setError('Upload a photo of your government ID.');
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ request: { ref: string; wantsTrainer: boolean }; memberToken?: string }>('/api/portal/join', {
        method: 'POST',
        body: JSON.stringify({
          signup: true,
          firstName,
          lastName,
          email,
          password,
          mobile,
          sport: activity,
          photoUrl: portrait,
          govtIdUrl: idPhoto,
          wantsTrainer: trainer === 'yes',
          demo,
        }),
      });
      saveMemberPass(data.memberToken);
      if (next) {
        navigate(next, { replace: true });
        return;
      }
      setFiled({ ref: data.request.ref, wantsTrainer: data.request.wantsTrainer });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file this.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`gkf${filed ? ' is-done' : ''}`} style={{ backgroundImage: `url(${curtains})` }}>
      {filed ? (
        <section className="gkf-done" aria-live="polite">
          <header className="gkf-done__head">
            <Link to="/" className="gkf-done__mark">GYMKHANA</Link>
            <p className="gkf-done__sector">SECTOR 19</p>
          </header>
          <img className="gkf-done__star" src={star} alt="" />
          <p className="gkf-done__copy">
            Your registration process has been completed. You will receive the final confirmation with login credentials on your registered mail ID.
          </p>
        </section>
      ) : (
      <div className="gkf-sheet">
        <header className="gkf-head">
          <Link to="/" className="gkf-mark">GYMKHANA</Link>
          <h1>REGISTRATION</h1>
          <img className="gkf-orb" src={ball} alt="" />
        </header>
          <form className="gkf-form" onSubmit={(event) => void submit(event)} noValidate>
            <button
              type="button"
              className="gkf-demo"
              onClick={() => {
                const pack = makeDemoMember(activity || 'Badminton');
                setError('');
                setDemo(true);
                setFullName(pack.name);
                setEmail(pack.email);
                setPassword(pack.password);
                setShowPassword(true);
                setMobile(pack.mobile);
                if (!activity) setActivity('Badminton');
                setTrainer('no');
                setPortrait(pack.portrait);
                setPortraitName('demo-photo.jpg');
                setIdPhoto(pack.idPhoto);
                setIdName('demo-member-id.jpg');
              }}
            >
              Use demo member
            </button>

            <label className="gkf-field">
              <span>Full Name</span>
              <input value={fullName} autoComplete="name" onChange={(event) => { setError(''); setDemo(false); setFullName(event.target.value); }} />
            </label>

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
                  autoComplete="new-password"
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
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      <path d="M10.6 10.7a2.2 2.2 0 0 0 3 3M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a16.7 16.7 0 0 1-3.3 4.1M6.5 6.6C4 8.5 2 12 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.1-.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  )}
                </button>
              </span>
            </label>

            <label className="gkf-field">
              <span>Contact Number</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={mobile}
                onChange={(event) => { setError(''); setMobile(event.target.value.replace(/\D/g, '').slice(0, 10)); }}
              />
            </label>

            <div className="gkf-split">
              <div className="gkf-field">
                <span>Activity</span>
                <Dropdown
                  label="Activity"
                  placeholder="Select"
                  value={activity}
                  options={SIGNUP_ACTIVITIES.map((name) => ({ value: name, label: name }))}
                  onChange={(value) => { setError(''); setActivity(value); }}
                />
              </div>
              <div className="gkf-field">
                <span>Trainer</span>
                <Dropdown
                  label="Trainer"
                  placeholder="Select"
                  value={trainer}
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                  onChange={(value) => { setError(''); setTrainer(value as 'yes' | 'no'); }}
                />
              </div>
            </div>

            <div className="gkf-field">
              <span>Photograph</span>
              <label
                className={`gkf-drop${over === 'portrait' ? ' is-over' : ''}${portrait ? ' is-held' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setOver('portrait'); }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => drop('portrait', event)}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="gkf-file"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void takeFile('portrait', event.target.files?.[0])}
                />
                {portrait ? (
                  <span className="gkf-drop__held">
                    <img src={portrait} alt="" />
                    <em>{portraitName || 'Your photo'}</em>
                  </span>
                ) : (
                  <em>Your photo</em>
                )}
              </label>
            </div>

            <div className="gkf-field">
              <span>Valid Government ID</span>
              <label
                className={`gkf-drop${over === 'id' ? ' is-over' : ''}${idPhoto ? ' is-held' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setOver('id'); }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => drop('id', event)}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="gkf-file"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void takeFile('id', event.target.files?.[0])}
                />
                {idPhoto ? (
                  <span className="gkf-drop__held">
                    <img src={idPhoto} alt="" />
                    <em>{idName || 'ID attached'}</em>
                  </span>
                ) : (
                  <em>Upload ID photo</em>
                )}
              </label>
            </div>

            {error ? <p className="gkf-error" role="alert">{error}</p> : null}

            <div className="gkf-foot">
              <img className="gkf-iron" src={dumbbells} alt="" />
              <button type="submit" className="gkf-confirm" disabled={busy}>{busy ? 'FILING' : 'CONFIRM'}</button>
            </div>
          </form>
      </div>
      )}
    </main>
  );
}
