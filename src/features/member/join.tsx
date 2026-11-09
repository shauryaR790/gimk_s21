import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ImagePlus, X } from 'lucide-react';
import { formatINR } from '../../../shared/domain';
import { normalizeGovtId } from '../../../shared/govtId';
import { SLOT_DAYS, slotLabel } from '../../../shared/slots';
import { api } from '../../lib/api';
import { readIdImage } from '../../lib/idImage';
import { saveMemberPass } from '../../lib/memberPass';
import { openRazorpayCheckout, type RazorpayResult } from '../../lib/razorpayCheckout';
import { useTitle } from '../../lib/useTitle';
import './join.css';

type Plan = {
  id: string;
  name: string;
  durationDays: number;
  price: number;
  description: string;
  discountBps: number;
  guestPasses: number;
  freezeDays: number;
  charge: { subtotal: number; tax: number; total: number };
};

type Trainer = { id: string; name: string; sport: string; offers: string; availability: string; freeSlots: string[] };

type Options = {
  sports: { sport: string; facilities: string[]; trainers: number }[];
  plans: Plan[];
  trainers: Trainer[];
  idTypes: string[];
  onlinePayment: boolean;
};

type PublicRequest = {
  id: string;
  ref: string;
  sport: string;
  firstName: string;
  planName: string;
  planDays: number;
  amount: number;
  paymentStatus: string;
  paymentMethod: string;
  status: string;
  wantsTrainer: boolean;
  trainerName: string;
  preferredSlotLabel: string;
  onlinePayment: boolean;
};

type Checkout = {
  requestId: string;
  amount: number;
  currency: string;
  razorpayOrderId: string;
  razorpayKeyId: string;
  venue: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
};

type Draft = {
  sport: string;
  name: string;
  mobile: string;
  email: string;
  dob: string;
  idType: string;
  idNumber: string;
  idPhoto: string;
  wantsTrainer: boolean | null;
  trainerId: string;
  slot: string;
  planId: string;
};

const EMPTY: Draft = {
  sport: '',
  name: '',
  mobile: '',
  email: '',
  dob: '',
  idType: 'Aadhaar',
  idNumber: '',
  idPhoto: '',
  wantsTrainer: null,
  trainerId: '',
  slot: '',
  planId: '',
};

const KEY = 'gk-join-draft';

function readDraft(): Draft {
  try {
    return { ...EMPTY, ...(JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}') as Partial<Draft>) };
  } catch {
    return EMPTY;
  }
}

function useDraft() {
  const [draft, setDraft] = useState<Draft>(readDraft);
  const latest = useRef(draft);
  const update = useCallback((patch: Partial<Draft>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked; the flow still works in memory */
    }
    setDraft(next);
  }, []);
  return [draft, update] as const;
}

let cachedOptions: Options | null = null;

function useOptions() {
  const [options, setOptions] = useState<Options | null>(cachedOptions);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      cachedOptions = await api<Options>('/api/portal/join');
      setOptions(cachedOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load memberships.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { options, error, reload: load };
}

function todayYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function ageFrom(dob: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = todayYmd().split('-').map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

function detailErrors(draft: Draft) {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (draft.name.trim().replace(/\s+/g, ' ').length < 2) errors.name = 'Enter your full name.';
  if (draft.mobile.replace(/\D/g, '').length < 10) errors.mobile = 'Enter a 10-digit mobile number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(draft.email.trim())) errors.email = 'Enter a valid email address.';
  const age = ageFrom(draft.dob);
  if (age === null || draft.dob >= todayYmd()) errors.dob = 'Enter your date of birth.';
  else if (age < 3 || age > 100) errors.dob = 'Members must be between 3 and 100.';
  if (!draft.idType) errors.idType = 'Choose an ID type.';
  else {
    const parsed = normalizeGovtId(draft.idType, draft.idNumber);
    if ('error' in parsed) errors.idNumber = parsed.error;
  }
  if (draft.wantsTrainer === null) errors.wantsTrainer = 'Choose whether you want a trainer.';
  return errors;
}

function sameSport(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const STEPS = ['Sport', 'Your details', 'Plan & payment'];

function JoinFrame({ step, title, children, aside, back }: { step: number; title: string; children: ReactNode; aside?: ReactNode; back?: { to: string; label: string } }) {
  useTitle(title);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  return (
    <div className="gkj">
      <header className="gkj-top">
        <Link className="gkj-brand" to="/">
          <img src="/ui/gymkhana-mark.png" alt="" width={26} height={26} />
          Gymkhana
        </Link>
        <Link className="gkj-top__link" to="/member/profile">Member sign in</Link>
      </header>
      {step > 0 ? (
        <ol className="gkj-steps" aria-label="Progress">
          {STEPS.map((label, index) => {
            const number = index + 1;
            const state = number < step ? 'is-done' : number === step ? 'is-current' : '';
            return (
              <li key={label} className={state} aria-current={number === step ? 'step' : undefined}>
                <span className="gkj-steps__dot">{number < step ? <Check size={13} strokeWidth={3} /> : number}</span>
                <span className="gkj-steps__label">{label}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      <main className={`gkj-main${aside ? '' : ' gkj-main--single'}`}>
        <section className="gkj-body">
          {back ? (
            <Link className="gkj-back" to={back.to}>
              <ArrowLeft size={15} /> {back.label}
            </Link>
          ) : null}
          <h1 className="gkj-title">{title}</h1>
          {children}
        </section>
        {aside ? <aside className="gkj-summary">{aside}</aside> : null}
      </main>
    </div>
  );
}

function LoadState({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (!error) return <p className="gkj-muted gkj-loading">Loading…</p>;
  return (
    <div className="gkj-alert" role="alert">
      <span>{error}</span>
      <button type="button" className="gkj-btn gkj-btn--ghost" onClick={onRetry}>Try again</button>
    </div>
  );
}

function Summary({ draft, options, plan, children }: { draft: Draft; options: Options | null; plan?: Plan; children?: ReactNode }) {
  const trainer = options?.trainers.find((row) => row.id === draft.trainerId);
  return (
    <div className="gkj-card gkj-sum">
      <h2>Your membership</h2>
      <dl>
        <div><dt>Sport</dt><dd>{draft.sport || '—'}</dd></div>
        <div>
          <dt>Trainer</dt>
          <dd>{draft.wantsTrainer === null ? '—' : draft.wantsTrainer ? trainer?.name ?? 'Any trainer' : 'No trainer'}</dd>
        </div>
        {draft.wantsTrainer ? <div><dt>Preferred time</dt><dd>{draft.slot ? slotLabel(draft.slot) : 'No preference'}</dd></div> : null}
        {draft.name.trim() ? <div><dt>Name</dt><dd>{draft.name.trim()}</dd></div> : null}
        {plan ? (
          <>
            <div><dt>Plan</dt><dd>{plan.name} · {plan.durationDays} days</dd></div>
            <div><dt>Price</dt><dd>{formatINR(plan.charge.subtotal)}</dd></div>
            {plan.charge.tax ? <div><dt>Tax</dt><dd>{formatINR(plan.charge.tax)}</dd></div> : null}
            <div className="gkj-sum__total"><dt>Total</dt><dd>{formatINR(plan.charge.total)}</dd></div>
          </>
        ) : null}
      </dl>
      {children}
    </div>
  );
}

export function JoinSportPage() {
  const navigate = useNavigate();
  const [draft, update] = useDraft();
  const { options, error, reload } = useOptions();
  return (
    <JoinFrame step={1} title="Choose your sport">
      <p className="gkj-lead">Your membership covers every facility. The sport tells us which trainer and courts to set you up with.</p>
      {!options ? <LoadState error={error} onRetry={() => void reload()} /> : (
        <div className="gkj-sports">
          {options.sports.map((row, index) => (
            <button
              key={row.sport}
              type="button"
              className={`gkj-sport${sameSport(row.sport, draft.sport) ? ' is-on' : ''}`}
              style={{ animationDelay: `${index * 40}ms` }}
              onClick={() => {
                const keepTrainer = sameSport(row.sport, draft.sport);
                update({ sport: row.sport, ...(keepTrainer ? {} : { trainerId: '', slot: '' }) });
                navigate('/join/details');
              }}
            >
              <span className="gkj-sport__name">{row.sport}</span>
              <span className="gkj-sport__meta">{row.facilities.join(' · ')}</span>
              <span className="gkj-sport__foot">
                <span>{row.trainers ? `${row.trainers} ${row.trainers === 1 ? 'trainer' : 'trainers'}` : 'Desk matches a trainer'}</span>
                <ArrowRight size={16} aria-hidden />
              </span>
            </button>
          ))}
          {!options.sports.length ? <p className="gkj-muted">No sports are open for membership yet. Call the desk.</p> : null}
        </div>
      )}
    </JoinFrame>
  );
}

function Input({ label, error, hint, group, children }: { label: string; error?: string; hint?: string; group?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span className="gkj-field__label">{label}</span>
      {children}
      {error ? <span className="gkj-field__error">{error}</span> : hint ? <span className="gkj-field__hint">{hint}</span> : null}
    </>
  );
  const className = `gkj-field${error ? ' has-error' : ''}`;
  return group
    ? <div className={className} role="group" aria-label={label}>{body}</div>
    : <label className={className}>{body}</label>;
}

export function JoinDetailsPage() {
  const navigate = useNavigate();
  const [draft, update] = useDraft();
  const { options, error, reload } = useOptions();
  const [tried, setTried] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const errors: Partial<Record<keyof Draft, string>> = tried ? detailErrors(draft) : {};

  const sportTrainers = useMemo(
    () => (options?.trainers ?? []).filter((row) => sameSport(row.sport, draft.sport)),
    [options, draft.sport],
  );
  const trainer = sportTrainers.find((row) => row.id === draft.trainerId);
  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const slot of trainer?.freeSlots ?? []) {
      const [day, hour] = slot.split(' ');
      map.set(day, [...(map.get(day) ?? []), hour]);
    }
    return SLOT_DAYS.filter((day) => map.has(day)).map((day) => ({ day, hours: map.get(day) ?? [] }));
  }, [trainer]);

  useEffect(() => {
    if (!options || !draft.trainerId) return;
    const current = options.trainers.find((row) => row.id === draft.trainerId);
    if (!current || !sameSport(current.sport, draft.sport)) update({ trainerId: '', slot: '' });
    else if (draft.slot && !current.freeSlots.includes(draft.slot)) update({ slot: '' });
  }, [options, draft.trainerId, draft.slot, draft.sport, update]);

  if (!draft.sport) return <Navigate to="/join" replace />;

  function next() {
    setTried(true);
    if (Object.keys(detailErrors(draft)).length) {
      window.requestAnimationFrame(() => document.querySelector('.gkj-field.has-error input, .gkj-field.has-error select, .gkj-choice.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    navigate('/join/plan');
  }

  return (
    <JoinFrame
      step={2}
      title="Your details"
      back={{ to: '/join', label: 'Change sport' }}
      aside={(
        <Summary draft={draft} options={options}>
          <button type="button" className="gkj-btn gkj-btn--block gkj-desktop" onClick={next}>Continue to plans <ArrowRight size={16} /></button>
        </Summary>
      )}
    >
      {!options ? <LoadState error={error} onRetry={() => void reload()} /> : null}
      <div className="gkj-card">
        <div className="gkj-grid">
          <div className="gkj-span">
            <Input label="Full name" error={errors.name}>
              <input value={draft.name} autoComplete="name" placeholder="As on your ID" onChange={(event) => update({ name: event.target.value })} />
            </Input>
          </div>
          <Input label="Mobile number" error={errors.mobile}>
            <span className="gkj-prefix">
              <b>+91</b>
              <input value={draft.mobile} inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" maxLength={14} onChange={(event) => update({ mobile: event.target.value })} />
            </span>
          </Input>
          <Input label="Email" error={errors.email}>
            <input type="email" value={draft.email} autoComplete="email" placeholder="you@example.com" onChange={(event) => update({ email: event.target.value })} />
          </Input>
          <Input label="Date of birth" error={errors.dob}>
            <input type="date" value={draft.dob} max={todayYmd()} autoComplete="bday" onChange={(event) => update({ dob: event.target.value })} />
          </Input>
          <Input label="Government ID" group error={errors.idType || errors.idNumber} hint={draft.idType === 'Aadhaar' ? 'We keep only the last 4 digits.' : undefined}>
            <span className="gkj-idrow">
              <select value={draft.idType} aria-label="ID type" onChange={(event) => update({ idType: event.target.value })}>
                {(options?.idTypes ?? ['Aadhaar']).map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input value={draft.idNumber} aria-label="ID number" autoComplete="off" placeholder={draft.idType === 'Aadhaar' ? '1234 5678 9012' : 'ID number'} onChange={(event) => update({ idNumber: event.target.value })} />
            </span>
          </Input>
          <div className="gkj-span">
            <span className="gkj-field__label">Photo of this ID</span>
            {draft.idPhoto ? (
              <div className="gkj-photo">
                <img src={draft.idPhoto} alt="Your government ID" />
                <button type="button" className="gkj-btn gkj-btn--ghost" onClick={() => update({ idPhoto: '' })}><X size={15} /> Remove</button>
              </div>
            ) : (
              <label className="gkj-drop">
                <ImagePlus size={18} aria-hidden />
                <span>Upload a photo — the desk checks the original when you visit</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    setPhotoError('');
                    void readIdImage(file)
                      .then((url) => update({ idPhoto: url }))
                      .catch((err: unknown) => setPhotoError(err instanceof Error ? err.message : 'Could not read that photo.'));
                  }}
                />
              </label>
            )}
            {photoError ? <span className="gkj-field__error">{photoError}</span> : null}
          </div>
        </div>
      </div>

      <h2 className="gkj-section">Coaching</h2>
      <div className={`gkj-choice${errors.wantsTrainer ? ' has-error' : ''}`} role="radiogroup" aria-label="Do you want a trainer?">
        <button type="button" role="radio" aria-checked={draft.wantsTrainer === true} className={draft.wantsTrainer === true ? 'is-on' : ''} onClick={() => update({ wantsTrainer: true })}>
          <strong>Yes, with a trainer</strong>
          <span>Your request goes to the trainers. They call you to plan sessions.</span>
        </button>
        <button type="button" role="radio" aria-checked={draft.wantsTrainer === false} className={draft.wantsTrainer === false ? 'is-on' : ''} onClick={() => update({ wantsTrainer: false, trainerId: '', slot: '' })}>
          <strong>No, on my own</strong>
          <span>The front desk approves your membership and calls if they need anything.</span>
        </button>
      </div>
      {errors.wantsTrainer ? <p className="gkj-field__error">{errors.wantsTrainer}</p> : null}

      {draft.wantsTrainer ? (
        <div className="gkj-card gkj-trainers">
          <h3>Pick a {draft.sport.toLowerCase()} trainer</h3>
          <div className="gkj-options" role="radiogroup" aria-label="Trainer">
            {sportTrainers.map((row) => (
              <button key={row.id} type="button" role="radio" aria-checked={draft.trainerId === row.id} className={`gkj-option${draft.trainerId === row.id ? ' is-on' : ''}`} onClick={() => update({ trainerId: row.id, slot: '' })}>
                <span className="gkj-option__dot" aria-hidden />
                <span className="gkj-option__text">
                  <strong>{row.name}</strong>
                  <span>{row.availability || 'Hours on request'}</span>
                </span>
                <span className="gkj-option__side">{row.freeSlots.length ? `${row.freeSlots.length} free hours a week` : 'Fully booked'}</span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={!draft.trainerId} className={`gkj-option${!draft.trainerId ? ' is-on' : ''}`} onClick={() => update({ trainerId: '', slot: '' })}>
              <span className="gkj-option__dot" aria-hidden />
              <span className="gkj-option__text">
                <strong>Any trainer</strong>
                <span>{sportTrainers.length ? 'The trainers decide who takes you.' : `No ${draft.sport.toLowerCase()} trainer is listed yet. The desk will match you.`}</span>
              </span>
            </button>
          </div>

          {trainer ? (
            <>
              <h3>When suits you? <em>optional</em></h3>
              {slotsByDay.length ? (
                <div className="gkj-slots">
                  <button type="button" className={`gkj-chip gkj-chip--wide${!draft.slot ? ' is-on' : ''}`} aria-pressed={!draft.slot} onClick={() => update({ slot: '' })}>No preference</button>
                  {slotsByDay.map((row) => (
                    <div key={row.day} className="gkj-slots__day">
                      <span>{row.day}</span>
                      <div>
                        {row.hours.map((hour) => {
                          const slot = `${row.day} ${hour}`;
                          return (
                            <button key={slot} type="button" className={`gkj-chip${draft.slot === slot ? ' is-on' : ''}`} aria-pressed={draft.slot === slot} aria-label={slotLabel(slot)} onClick={() => update({ slot })}>
                              {hour}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="gkj-muted">{trainer.name} has no free hours right now. Send the request and they will call you.</p>}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="gkj-actions gkj-actions--mobile">
        <button type="button" className="gkj-btn gkj-btn--block" onClick={next}>Continue to plans <ArrowRight size={16} /></button>
      </div>
    </JoinFrame>
  );
}

function perks(plan: Plan) {
  return [
    plan.discountBps ? `${plan.discountBps / 100}% off court bookings` : '',
    plan.guestPasses ? `${plan.guestPasses} guest ${plan.guestPasses === 1 ? 'pass' : 'passes'}` : '',
    plan.freezeDays ? `Freeze up to ${plan.freezeDays} days` : '',
  ].filter(Boolean);
}

export function JoinPlanPage() {
  const navigate = useNavigate();
  const [draft, update] = useDraft();
  const { options, error, reload } = useOptions();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const plan = options?.plans.find((row) => row.id === draft.planId);

  useEffect(() => {
    if (options && draft.planId && !options.plans.some((row) => row.id === draft.planId)) update({ planId: '' });
  }, [options, draft.planId, update]);

  if (!draft.sport) return <Navigate to="/join" replace />;
  if (Object.keys(detailErrors(draft)).length) return <Navigate to="/join/details" replace />;

  async function send(online: boolean) {
    if (!plan) {
      setFailure('Choose a plan first.');
      return;
    }
    setBusy(true);
    setFailure('');
    let requestId = '';
    try {
      const { request, memberToken } = await api<{ request: PublicRequest; memberToken?: string }>('/api/portal/join', {
        method: 'POST',
        body: JSON.stringify({
          sport: draft.sport,
          name: draft.name,
          mobile: draft.mobile,
          email: draft.email,
          dob: draft.dob,
          govtIdType: draft.idType,
          govtIdNumber: draft.idNumber,
          govtIdUrl: draft.idPhoto,
          wantsTrainer: draft.wantsTrainer === true,
          trainerId: draft.trainerId,
          preferredSlot: draft.slot,
          planId: plan.id,
        }),
      });
      requestId = request.id;
      saveMemberPass(memberToken);
      if (online) {
        const session = await api<Checkout>(`/api/portal/join/${request.id}/pay`, { method: 'POST', body: '{}' });
        const result: RazorpayResult = await openRazorpayCheckout({
          key: session.razorpayKeyId,
          amount: session.amount,
          currency: session.currency,
          orderId: session.razorpayOrderId,
          name: session.venue,
          description: session.description,
          prefill: session.prefill,
        });
        await api(`/api/portal/join/${request.id}/verify`, { method: 'POST', body: JSON.stringify(result) });
      }
      window.sessionStorage.removeItem(KEY);
      navigate(`/join/done/${request.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setFailure(requestId && online
        ? `${message} Your request is saved — try paying again, or pay at reception.`
        : message);
    } finally {
      setBusy(false);
    }
  }

  const online = options?.onlinePayment ?? false;
  return (
    <JoinFrame
      step={3}
      title="Pick a plan"
      back={{ to: '/join/details', label: 'Edit details' }}
      aside={(
        <Summary draft={draft} options={options} plan={plan}>
          {failure ? <p className="gkj-alert gkj-alert--inline" role="alert">{failure}</p> : null}
          {online ? (
            <>
              <button type="button" className="gkj-btn gkj-btn--block" disabled={busy || !plan} onClick={() => void send(true)}>
                {busy ? 'Opening payment…' : plan ? `Pay ${formatINR(plan.charge.total)}` : 'Choose a plan'}
              </button>
              <button type="button" className="gkj-btn gkj-btn--ghost gkj-btn--block" disabled={busy || !plan} onClick={() => void send(false)}>Pay at reception instead</button>
              <p className="gkj-fine">Card, UPI and netbanking through Razorpay. Your plan starts once the club approves it.</p>
            </>
          ) : (
            <>
              <button type="button" className="gkj-btn gkj-btn--block" disabled={busy || !plan} onClick={() => void send(false)}>
                {busy ? 'Sending…' : 'Send request'}
              </button>
              <p className="gkj-fine">Online payment is not switched on yet. Pay at reception by cash, UPI or card when the club confirms.</p>
            </>
          )}
        </Summary>
      )}
    >
      {!options ? <LoadState error={error} onRetry={() => void reload()} /> : (
        <div className="gkj-plans" role="radiogroup" aria-label="Membership plan">
          {options.plans.map((row, index) => {
            const list = perks(row);
            return (
              <button
                key={row.id}
                type="button"
                role="radio"
                aria-checked={draft.planId === row.id}
                className={`gkj-plan${draft.planId === row.id ? ' is-on' : ''}`}
                style={{ animationDelay: `${index * 40}ms` }}
                onClick={() => update({ planId: row.id })}
              >
                <span className="gkj-option__dot" aria-hidden />
                <span className="gkj-plan__main">
                  <strong>{row.name}</strong>
                  <span className="gkj-plan__days">{row.durationDays} days</span>
                  {row.description ? <span className="gkj-plan__desc">{row.description}</span> : null}
                  {list.length ? <span className="gkj-plan__perks">{list.join(' · ')}</span> : null}
                </span>
                <span className="gkj-plan__price">
                  <strong>{formatINR(row.charge.subtotal)}</strong>
                  {row.charge.tax ? <span>{formatINR(row.charge.total)} with tax</span> : null}
                </span>
              </button>
            );
          })}
          {!options.plans.length ? <p className="gkj-muted">No plans are on sale right now. Call the desk.</p> : null}
        </div>
      )}
    </JoinFrame>
  );
}

export function JoinDonePage() {
  const { id = '' } = useParams();
  const [request, setRequest] = useState<PublicRequest | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setRequest((await api<{ request: PublicRequest }>(`/api/portal/join/${id}`)).request);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your request.');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const paid = request?.paymentStatus === 'PAID';
  const online = request?.paymentMethod === 'Online';
  const amount = request ? formatINR(request.amount) : '';
  const payment = !request ? null
    : request.paymentStatus === 'REFUNDED' ? { title: `${amount} refund recorded`, body: 'The front desk will confirm when it reaches you.' }
    : paid ? { title: online ? `Paid ${amount} online` : `Paid ${amount} at the desk`, body: online ? 'Your receipt is with the front desk.' : `${request.paymentMethod || 'Desk'} payment, receipt on your bill.` }
    : { title: `Pay ${amount} at reception`, body: 'Cash, UPI or card. Bring your government ID.' };
  const plan = !request ? null
    : request.status === 'APPROVED' ? { title: `${request.planName} membership is active`, body: `It runs for ${request.planDays} days from approval.` }
    : request.status === 'DECLINED' ? { title: 'Request closed', body: 'The club could not take this request. Call the front desk if you have questions.' }
    : { title: `${request.planName} membership starts`, body: `As soon as the club approves your request. It runs for ${request.planDays} days.` };
  return (
    <JoinFrame step={0} title={request ? `Request ${request.ref} received` : 'Request received'}>
      {!request ? <LoadState error={error} onRetry={() => void load()} /> : (
        <div className="gkj-card gkj-done">
          <span className="gkj-done__mark" aria-hidden><Check size={22} strokeWidth={3} /></span>
          <p className="gkj-done__lead">Thanks, {request.firstName}. Here is what happens next.</p>
          <ol className="gkj-next">
            <li>
              <strong>{request.wantsTrainer ? (request.trainerName ? `${request.trainerName} calls you` : 'A trainer calls you') : 'The front desk calls you'}</strong>
              <span>
                {request.wantsTrainer
                  ? `To plan your ${request.sport.toLowerCase()} sessions${request.preferredSlotLabel ? `, starting with ${request.preferredSlotLabel}` : ''}.`
                  : `To confirm your ${request.sport.toLowerCase()} membership.`}
              </span>
            </li>
            <li>
              <strong>{payment?.title}</strong>
              <span>{payment?.body}</span>
            </li>
            <li>
              <strong>{plan?.title}</strong>
              <span>{plan?.body}</span>
            </li>
          </ol>
          <div className="gkj-done__actions">
            <Link className="gkj-btn" to="/member">Go to member portal</Link>
            <Link className="gkj-btn gkj-btn--ghost" to="/">Back to home</Link>
          </div>
        </div>
      )}
    </JoinFrame>
  );
}
