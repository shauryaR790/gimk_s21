import { useEffect, useRef, type KeyboardEvent } from 'react';
import { SLOT_DAYS, SLOT_HOURS, normalizeSlots, slotKey, summarizeSlots } from '../../../../shared/slots';

export type HeldSlot = { slot: string; name: string; requestId: string };

function endOf(hour: string) {
  return `${String(Number(hour.slice(0, 2)) + 1).padStart(2, '0')}:00`;
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
}

export function SlotGrid({ value, onChange, held = [] }: { value: string[]; onChange: (next: string[]) => void; held?: HeldSlot[] }) {
  const paint = useRef<'add' | 'remove' | null>(null);
  const latest = useRef(value);
  latest.current = value;
  const free = new Set(value);
  const holders = new Map(held.map((row) => [row.slot, row]));

  useEffect(() => {
    const stop = () => {
      paint.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  function apply(slots: string[], mode: 'add' | 'remove') {
    const next = new Set(latest.current);
    for (const slot of slots) {
      if (holders.has(slot)) continue;
      if (mode === 'add') next.add(slot);
      else next.delete(slot);
    }
    latest.current = normalizeSlots([...next]);
    onChange(latest.current);
  }

  function toggleGroup(slots: string[]) {
    const open = slots.filter((slot) => !holders.has(slot));
    apply(open, open.every((slot) => free.has(slot)) ? 'remove' : 'add');
  }

  function onKey(event: KeyboardEvent, slot: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    apply([slot], free.has(slot) ? 'remove' : 'add');
  }

  const summary = summarizeSlots(value);
  return (
    <div className="gk-slots">
      <div className="gk-slots__bar">
        <strong>{value.length} free {value.length === 1 ? 'hour' : 'hours'} a week</strong>
        <span>{summary || 'No free slots yet — click or drag across the grid'}</span>
        <span className="gk-slots__legend"><i className="is-free" /> Free <i className="is-held" /> Taken by a member</span>
        <button type="button" className="gk-btn gk-btn--sm" disabled={!value.length || value.every((slot) => holders.has(slot))} onClick={() => apply(value, 'remove')}>Clear</button>
      </div>
      <div className="gk-slots__scroll">
        <table className="gk-slots__grid" onPointerLeave={() => { paint.current = null; }}>
          <thead>
            <tr>
              <th aria-hidden />
              {SLOT_DAYS.map((day) => (
                <th key={day}>
                  <button type="button" title={`Toggle all of ${day}`} onClick={() => toggleGroup(SLOT_HOURS.map((hour) => slotKey(day, hour)))}>{day}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOT_HOURS.map((hour) => (
              <tr key={hour}>
                <th scope="row">
                  <button type="button" title={`Toggle ${hour} every day`} onClick={() => toggleGroup(SLOT_DAYS.map((day) => slotKey(day, hour)))}>{hour}</button>
                </th>
                {SLOT_DAYS.map((day) => {
                  const slot = slotKey(day, hour);
                  const holder = holders.get(slot);
                  const on = free.has(slot) || Boolean(holder);
                  return (
                    <td key={slot}>
                      <button
                        type="button"
                        className={`gk-slot${on ? ' is-free' : ''}${holder ? ' is-held' : ''}`}
                        aria-pressed={on}
                        aria-label={`${day} ${hour} to ${endOf(hour)}${holder ? `, taken by ${holder.name}` : on ? ', free' : ''}`}
                        title={holder ? `${holder.name} · approved request` : `${day} ${hour}–${endOf(hour)}`}
                        disabled={Boolean(holder)}
                        onPointerDown={(event) => {
                          if (holder || event.button !== 0) return;
                          event.preventDefault();
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                          paint.current = free.has(slot) ? 'remove' : 'add';
                          apply([slot], paint.current);
                        }}
                        onPointerEnter={() => {
                          if (paint.current && !holder) apply([slot], paint.current);
                        }}
                        onKeyDown={(event) => onKey(event, slot)}
                      >
                        {holder ? initials(holder.name) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
