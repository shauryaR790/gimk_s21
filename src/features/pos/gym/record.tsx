import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import type { BackendChromeContext } from '../odoo/OdooBackendLayout';
import { api } from '../../../lib/api';
import { readIdImage } from '../../../lib/idImage';
import { useTitle } from '../../../lib/useTitle';
import { usePos } from '../PosContext';

export type Option = { value: string; label: string };

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Dropdown({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose',
  variant = 'box',
  disabled,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  variant?: 'box' | 'field';
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom || '1') || 1;
    const rect = wrap.current.getBoundingClientRect();
    const height = Math.min(296, options.length * 31 + 14) * zoom;
    const roomBelow = window.innerHeight - rect.bottom;
    const top = roomBelow < height + 12 && rect.top > height + 12 ? rect.top - height - 4 : rect.bottom + 4;
    setPlace({ top: top / zoom, left: rect.left / zoom, width: rect.width / zoom });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrap.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onMove(event: Event) {
      if (menu.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  return (
    <div ref={wrap} className={`gk-dd gk-dd--${variant}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="gk-dd__btn"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={current ? 'gk-dd__value' : 'gk-dd__value is-placeholder'}>{current?.label ?? placeholder}</span>
        <Chevron />
      </button>
      {open && place ? (
        <div
          ref={menu}
          role="listbox"
          aria-label={label}
          className="o-be-dropdown gk-dd__menu"
          style={{ top: place.top, left: place.left, minWidth: Math.max(place.width, 188) }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`o-be-dropdown__item${option.value === value ? ' is-on' : ''}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
          {!options.length ? <p className="gk-dd__none">Nothing to choose yet</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export { readIdImage };

export type Pager = { index: number; total: number; prev?: string; next?: string };

export function pagerFor(ids: string[], id: string | undefined, base: string): Pager | undefined {
  if (!id || id === 'new') return undefined;
  const index = ids.indexOf(id);
  if (index < 0) return undefined;
  return {
    index,
    total: ids.length,
    prev: index > 0 ? `${base}/${ids[index - 1]}` : undefined,
    next: index < ids.length - 1 ? `${base}/${ids[index + 1]}` : undefined,
  };
}

export const BOOKING_STAGES = [
  { id: 'CONFIRMED', label: 'Booked' },
  { id: 'CHECKED_IN', label: 'Active' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'CANCELLED', label: 'Cancelled' },
] as const;

export const BOOKING_STATUS: Record<string, string> = {
  CONFIRMED: 'Booked',
  CHECKED_IN: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export function bookingStageClass(status: string) {
  if (status === 'CONFIRMED') return 'is-booked';
  if (status === 'CHECKED_IN') return 'is-active';
  if (status === 'COMPLETED') return 'is-completed';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'is-cancelled';
  return '';
}

export function BookingStages({
  status,
  onPick,
}: {
  status: string;
  onPick?: (next: string) => void;
}) {
  const current = status === 'NO_SHOW' ? 'CANCELLED' : status;
  return (
    <div className="gk-stages" role="group" aria-label="Booking status">
      {BOOKING_STAGES.map((stage) => {
        const on = current === stage.id;
        const pickable = Boolean(onPick) && !on;
        if (!onPick) {
          return (
            <span key={stage.id} className={`gk-pill ${bookingStageClass(stage.id)}${on ? ' is-on' : ''}`}>
              {stage.label}
            </span>
          );
        }
        return (
          <button
            key={stage.id}
            type="button"
            className={`gk-pill ${bookingStageClass(stage.id)}${on ? ' is-on' : ''}${pickable ? ' is-pick' : ''}`}
            disabled={!pickable}
            aria-current={on ? 'step' : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (pickable) onPick(stage.id);
            }}
          >
            {stage.label}
          </button>
        );
      })}
    </div>
  );
}

const ACTION_TEXT: Record<string, string> = {
  CREATE_BOOKING: 'Booking created',
  RESCHEDULE: 'Booking updated',
  CANCELLED: 'Booking cancelled',
  CHECKED_IN: 'Checked in',
  COMPLETED: 'Marked done',
  NO_SHOW: 'Marked no-show',
  ADD_MEMBER: 'Visitor added',
  EDIT_MEMBER: 'Details updated',
  ASSIGN_PLAN: 'Plan assigned',
  MEMBER_PAYMENT: 'Payment taken',
  SHIFT_START: 'Shift started',
  SHIFT_EDIT: 'Shift updated',
  SHIFT_END: 'Clocked out',
  ADD_TRAINER: 'Trainer added',
  EDIT_TRAINER: 'Trainer updated',
  MAINTENANCE: 'Task raised',
  EDIT_TASK: 'Task updated',
  TASK_DONE: 'Task done',
  ADD_CLASS: 'Class created',
  JOIN_REQUEST: 'Request received',
  JOIN_UPDATED: 'Applicant updated the request',
  JOIN_EDIT: 'Details updated',
  JOIN_PAID: 'Paid',
  JOIN_CONTACTED: 'Contacted',
  JOIN_APPROVED: 'Approved',
  JOIN_DECLINED: 'Declined',
  NOTE: 'Note',
  MESSAGE: 'Message',
  ACTIVITY: 'Activity',
};

export function describeAction(action: string, message: string) {
  const base = ACTION_TEXT[action] ?? action.toLowerCase().replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  return message ? `${base} · ${message}` : base;
}

export function whenText(iso: string) {
  const date = new Date(iso);
  const zone = 'Asia/Kolkata';
  const day = date.toLocaleDateString('en-CA', { timeZone: zone });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: zone });
  const time = date.toLocaleTimeString('en-IN', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  if (day === today) return `today ${time}`;
  return `${date.toLocaleDateString('en-IN', { timeZone: zone, day: '2-digit', month: 'short' })} ${time}`;
}

type Entry = { id: string; actor: string; action: string; message: string; created_at: string };

function Chatter({ kind, recordId, refreshKey }: { kind: string; recordId?: string; refreshKey: number }) {
  const pos = usePos();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<'MESSAGE' | 'NOTE' | 'ACTIVITY'>('MESSAGE');
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    if (!recordId) {
      setEntries([]);
      return;
    }
    const data = await api<{ entries: Entry[] }>(`/api/gym/audit/${recordId}`);
    setEntries(data.entries);
  }, [recordId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load, refreshKey]);

  async function post() {
    if (!recordId || !text.trim()) return;
    await api(`/api/gym/audit/${recordId}`, { method: 'POST', body: JSON.stringify({ action: mode, message: text.trim(), entity: kind.toLowerCase() }) });
    setText('');
    setComposing(false);
    await load();
  }

  const initial = (pos.user?.name ?? 'S').trim().charAt(0).toUpperCase() || 'S';
  return (
    <aside className="o-prod__chatter" aria-label="Activity">
      <div className="o-prod__chatter-actions">
        {(['MESSAGE', 'NOTE', 'ACTIVITY'] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={mode === entry ? 'is-on' : ''}
            onClick={() => {
              setMode(entry);
              setComposing(Boolean(recordId));
            }}
          >
            {entry === 'MESSAGE' ? 'Send message' : entry === 'NOTE' ? 'Log note' : 'Activity'}
          </button>
        ))}
      </div>
      {composing ? (
        <div className="gk-composer">
          <textarea
            value={text}
            autoFocus
            placeholder={mode === 'MESSAGE' ? 'Write a message...' : mode === 'NOTE' ? 'Log an internal note...' : 'What needs doing, and when?'}
            onChange={(event) => setText(event.target.value)}
          />
          <div>
            <button type="button" className="gk-btn gk-btn--sm" onClick={() => void post()}>{mode === 'MESSAGE' ? 'Send' : mode === 'NOTE' ? 'Log' : 'Schedule'}</button>
            <button type="button" className="gk-btn gk-btn--sm" onClick={() => setComposing(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
      {entries.length ? entries.map((entry) => (
        <article key={entry.id} className="o-prod__note">
          <span className="o-prod__avatar">{entry.actor.trim().charAt(0).toUpperCase() || 'S'}</span>
          <div>
            <header>
              <strong>{entry.actor}</strong>
              <time>{whenText(entry.created_at)}</time>
            </header>
            <p>{describeAction(entry.action, entry.message)}</p>
          </div>
        </article>
      )) : (
        <article className="o-prod__note">
          <span className="o-prod__avatar">{initial}</span>
          <div>
            <header>
              <strong>{pos.user?.name ?? 'Staff'}</strong>
              <time>today</time>
            </header>
            <p>{recordId ? `${kind} created` : 'Creating a new record...'}</p>
          </div>
        </article>
      )}
    </aside>
  );
}

function CameraIcon() {
  return (
    <span className="o-prod__camera" aria-hidden>
      <svg viewBox="0 0 48 48" width="42" height="42">
        <path fill="currentColor" d="M16 10h16l3 4h7a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3h7l3-4zm8 8a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10z" />
      </svg>
      <i>+</i>
    </span>
  );
}

export type RecordTab = { id: string; label: string; content: ReactNode };

export function RecordForm({
  kind,
  recordId,
  crumb,
  name,
  onName,
  namePlaceholder,
  flags,
  photo,
  documents = 0,
  pager,
  tabs,
  below,
  notes,
  error,
  busy,
  saveLabel = 'Save',
  onSave,
  onDiscard,
  actions,
  refreshKey = 0,
}: {
  kind: string;
  recordId?: string;
  crumb: { label: string; to: string };
  name: string;
  onName: (value: string) => void;
  namePlaceholder: string;
  flags?: { label: string; checked: boolean; onChange: (checked: boolean) => void }[];
  photo?: { url: string; label: string; onChange: (url: string, fileName: string) => void };
  documents?: number;
  pager?: Pager;
  tabs: RecordTab[];
  below?: ReactNode;
  notes?: { value: string; onChange: (value: string) => void; placeholder?: string };
  error?: string;
  busy?: boolean;
  saveLabel?: string;
  onSave: () => void;
  onDiscard: () => void;
  actions?: ReactNode;
  refreshKey?: number;
}) {
  const navigate = useNavigate();
  const { setListPath, setPager, setPagerLabel } = useOutletContext<BackendChromeContext>();
  useTitle(name.trim() || `New ${kind.toLowerCase()}`);
  const [tab, setTab] = useState(tabs[0]?.id ?? 'general');
  const starKey = `gk-star:${kind}:${recordId ?? 'new'}`;
  const [starred, setStarred] = useState(false);
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    setStarred(Boolean(recordId) && window.localStorage.getItem(starKey) === '1');
  }, [recordId, starKey]);

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab(tabs[0]?.id ?? 'general');
  }, [tabs, tab]);

  useEffect(() => {
    setListPath(crumb.to);
    if (pager) {
      setPagerLabel(`${pager.index + 1} / ${pager.total}`);
      setPager({
        canPrev: Boolean(pager.prev),
        canNext: Boolean(pager.next),
        onPrev: () => pager.prev && navigate(pager.prev),
        onNext: () => pager.next && navigate(pager.next),
      });
    } else {
      setPagerLabel('1-1 / 1');
      setPager(null);
    }
    return () => {
      setListPath(null);
      setPager(null);
    };
  }, [crumb.to, navigate, pager, setListPath, setPager, setPagerLabel]);

  const active = tabs.find((entry) => entry.id === tab) ?? tabs[0];

  return (
    <div className="o-prod">
      <div className="o-prod__top">
        <div className="gk-rec__lead">
          <nav className="o-prod__crumb" aria-label="Breadcrumb">
            <Link to={crumb.to}>{crumb.label}</Link>
            <span>/</span>
            <strong>{recordId ? (name.trim() || kind) : 'New'}</strong>
          </nav>
          <div className="gk-rec__actions">
            <button type="button" className="gk-btn" disabled={busy} onClick={onSave}>{busy ? 'Saving...' : saveLabel}</button>
            <button type="button" className="gk-btn" disabled={busy} onClick={onDiscard}>Discard</button>
            {actions}
          </div>
        </div>
        <button type="button" className="o-prod__doc" disabled>
          <span aria-hidden>▤</span> Documents <em>{documents}</em>
        </button>
        <div className="o-prod__pager">
          {pager ? (
            <>
              <span>{`${pager.index + 1} / ${pager.total}`}</span>
              <button type="button" aria-label={`Previous ${kind.toLowerCase()}`} disabled={!pager.prev} onClick={() => pager.prev && navigate(pager.prev)}>‹</button>
              <button type="button" aria-label={`Next ${kind.toLowerCase()}`} disabled={!pager.next} onClick={() => pager.next && navigate(pager.next)}>›</button>
            </>
          ) : null}
        </div>
      </div>

      {error || photoError ? <p className="gk-rec__error" role="alert">{error || photoError}</p> : null}

      <div className="o-prod__sheet">
        <section className="o-prod__main">
          <header className="o-prod__head">
            <div className="o-prod__identity">
              <div className="o-prod__title-row">
                <button
                  type="button"
                  className={`o-prod__star${starred ? ' is-on' : ''}`}
                  aria-label={starred ? 'Unstar' : 'Star'}
                  onClick={() => {
                    const next = !starred;
                    setStarred(next);
                    if (recordId) window.localStorage.setItem(starKey, next ? '1' : '0');
                  }}
                >
                  ★
                </button>
                <input
                  className="o-prod__title"
                  value={name}
                  placeholder={namePlaceholder}
                  aria-label={`${kind} name`}
                  onChange={(event) => onName(event.target.value)}
                />
              </div>
              {flags?.length ? (
                <div className="o-prod__flags">
                  {flags.map((flag) => (
                    <label key={flag.label}>
                      <input type="checkbox" checked={flag.checked} onChange={(event) => flag.onChange(event.target.checked)} /> {flag.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            {photo ? (
              <label className="o-prod__photo" title={photo.label}>
                {photo.url ? <img src={photo.url} alt={photo.label} /> : <CameraIcon />}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={photo.label}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    setPhotoError('');
                    void readIdImage(file)
                      .then((url) => photo.onChange(url, file.name))
                      .catch((err: unknown) => setPhotoError(err instanceof Error ? err.message : 'Could not read that photo.'));
                  }}
                />
              </label>
            ) : null}
          </header>

          <div className="o-prod__tabs" role="tablist">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={tab === entry.id ? 'is-on' : ''}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="gk-rec__tab" key={active?.id}>{active?.content}</div>

          {below}

          {notes ? (
            <div className="o-prod__notes">
              <h3>Internal notes</h3>
              <textarea
                value={notes.value}
                placeholder={notes.placeholder ?? 'This note is only for internal purposes.'}
                onChange={(event) => notes.onChange(event.target.value)}
              />
            </div>
          ) : null}
        </section>

        <Chatter kind={kind} recordId={recordId} refreshKey={refreshKey} />
      </div>
    </div>
  );
}

export function Grid({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="o-prod__grid">
      <div className="o-prod__col">{left}</div>
      <div className="o-prod__col">{right}</div>
    </div>
  );
}

export function Field({ label, required, suffix, children }: { label: string; required?: boolean; suffix?: string; children: ReactNode }) {
  return (
    <div className="o-prod__field">
      <span>{label}{required ? <> <i className="o-prod__req">*</i></> : null}</span>
      {children}
      {suffix ? <em>{suffix}</em> : null}
    </div>
  );
}

export function Choice({
  label,
  required,
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  required?: boolean;
  name: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="o-prod__field o-prod__field--row">
      <span>{label}{required ? <> <i className="o-prod__req">*</i></> : null}</span>
      {options.map((option) => (
        <label key={option.value}>
          <input type="radio" name={name} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

export function Check({ label, required, checked, onChange }: { label: string; required?: boolean; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="o-prod__field o-prod__field--row">
      <span>{label}{required ? <> <i className="o-prod__req">*</i></> : null}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

export function Money({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <span className="o-prod__money">
      <b>₹</b>
      <input value={value} inputMode="decimal" aria-label={label} onChange={(event) => onChange(event.target.value)} />
    </span>
  );
}

export function TabTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="gk-tabtable">
      <table className="o-be-table">
        <thead><tr>{head.map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((cells, index) => <tr key={index}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
          {!rows.length ? <tr><td colSpan={head.length} className="o-be-table__empty">{empty}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

export function toNumber(value: string) {
  const next = Number(String(value).replace(/[₹,\s]/g, ''));
  return Number.isFinite(next) ? next : NaN;
}
