import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { BackendChromeContext } from './OdooBackendLayout';

export const PAGE_SIZE = 20;

export type BoardItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  href?: string;
  when?: string;
  onOpen?: () => void;
};

export function useChromeBoard(items: BoardItem[]) {
  const { search, view, setPagerLabel, setPager } = useOutletContext<BackendChromeContext>();
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => `${item.title} ${item.subtitle ?? ''} ${item.meta ?? ''}`.toLowerCase().includes(needle));
  }, [items, search]);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
  const safePage = Math.min(page, pages - 1);
  const start = total ? safePage * PAGE_SIZE : 0;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);
  const from = total ? start + 1 : 0;
  const to = start + pageItems.length;

  useEffect(() => {
    setPage(0);
  }, [search, items.length]);

  useEffect(() => {
    setPagerLabel(total ? `${from}-${to} / ${total}` : '0-0 / 0');
    setPager({
      canPrev: safePage > 0,
      canNext: total > 0 && safePage < pages - 1,
      onPrev: () => setPage((value) => Math.max(0, value - 1)),
      onNext: () => setPage((value) => value + 1),
    });
    return () => setPager(null);
  }, [from, to, total, safePage, pages, setPager, setPagerLabel]);

  return { view, pageItems, total };
}

export function ChromeRecords({
  items,
  empty,
  children,
}: {
  items: BoardItem[];
  empty?: string;
  children: (page: BoardItem[]) => ReactNode;
}) {
  const { view, pageItems } = useChromeBoard(items);
  if (view === 'kanban') return <KanbanBoard items={pageItems} empty={empty} />;
  if (view === 'activity') return <ActivityBoard items={pageItems} empty={empty} />;
  return <>{children(pageItems)}</>;
}

function openItem(item: BoardItem, navigate: ReturnType<typeof useNavigate>) {
  if (item.onOpen) item.onOpen();
  else if (item.href) navigate(item.href);
}

function canOpen(item: BoardItem) {
  return Boolean(item.onOpen || item.href);
}

function KanbanBoard({ items, empty }: { items: BoardItem[]; empty?: string }) {
  const navigate = useNavigate();
  if (!items.length) return <p className="o-be-table__empty gk-empty-line">{empty || 'Nothing to show'}</p>;
  return (
    <div className="gk-board">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="gk-board-card"
          disabled={!canOpen(item)}
          onClick={() => openItem(item, navigate)}
        >
          <strong>{item.title}</strong>
          {item.subtitle ? <span>{item.subtitle}</span> : null}
          {item.meta ? <em>{item.meta}</em> : null}
        </button>
      ))}
    </div>
  );
}

export function ActivityBoard({ items, empty }: { items: BoardItem[]; empty?: string }) {
  const navigate = useNavigate();
  const groups = useMemo(() => groupByDay(items), [items]);
  if (!items.length) return <p className="o-be-table__empty gk-empty-line">{empty || 'Nothing to show'}</p>;
  return (
    <div className="gk-agenda">
      {groups.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <button type="button" disabled={!canOpen(item)} onClick={() => openItem(item, navigate)}>
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span>{item.subtitle}</span> : null}
                  {item.meta ? <em>{item.meta}</em> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function groupByDay(items: BoardItem[]) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const groups = new Map<string, BoardItem[]>();
  for (const item of items) {
    const label = dayLabel(item.when, today);
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  return [...groups.entries()].map(([label, rows]) => ({ label, items: rows }));
}

function dayLabel(when: string | undefined, today: string) {
  if (!when) return 'Unscheduled';
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(when)) {
      if (when === today) return 'Today';
      return new Date(`${when}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    }
    return when;
  }
  const ymd = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (ymd === today) return 'Today';
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
