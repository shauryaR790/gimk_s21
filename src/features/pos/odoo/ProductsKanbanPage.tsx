import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatOdooINR } from '../../../../shared/domain';
import { fitProductImage } from '../../../lib/fitProductImage';
import { useTitle } from '../../../lib/useTitle';
import { usePos } from '../PosContext';
import { ActivityBoard, useChromeBoard } from './chrome';

function ProductThumb({ src }: { src: string }) {
  const [fitted, setFitted] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFitted(null);
    fitProductImage(src).then((url) => {
      if (live) setFitted(url);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return <img src={fitted ?? src} alt="" data-fit={fitted ? 'ready' : 'pending'} />;
}

const SPORTS = new Set([
  'cat_facility',
  'cat_membership',
  'cat_classes',
  'cat_coaching',
  'cat_rentals',
  'cat_merch',
  'cat_other_services',
]);

export function ProductsKanbanPage() {
  useTitle('Services & Products');
  const navigate = useNavigate();
  const { items } = usePos();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const seen = new Set<string>();
    return items
      .filter((item) => item.isAvailable && SPORTS.has(item.categoryId))
      .filter((item) => {
        const img = item.imageUrl ?? '';
        if (/\.(jpe?g|webp)(\?|$)/i.test(img) || img.includes('/studio/')) return false;
        if (img && seen.has(img)) return false;
        if (img) seen.add(img);
        return !needle || item.name.toLowerCase().includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, q]);
  const board = list.map((item) => ({
    id: item.id,
    title: item.name,
    subtitle: formatOdooINR(item.price),
    href: `/pos/backend/products/${item.id}`,
  }));
  const { view, pageItems } = useChromeBoard(board);
  const pageList = pageItems.map((card) => list.find((item) => item.id === card.id)).filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <button type="button" className="o-btn o-btn--primary" onClick={() => navigate('/pos/backend/products/new')}>New</button>
        <h2 style={{ margin: 0, flex: 1 }}>Services & Products</h2>
        <label className="o-search" style={{ minWidth: 240 }}>
          <span>⌕</span>
          <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {view === 'activity' ? (
        <ActivityBoard items={pageItems} empty="No services yet" />
      ) : view === 'list' ? (
        <table className="o-be-table gk-table">
          <thead><tr><th>Service</th><th>Price</th></tr></thead>
          <tbody>
            {pageList.map((item) => (
              <tr key={item.id} className="is-link" onClick={() => navigate(`/pos/backend/products/${item.id}`)}>
                <td><strong>{item.name}</strong></td>
                <td>{formatOdooINR(item.price)}</td>
              </tr>
            ))}
            {!list.length ? <tr><td colSpan={2} className="o-be-table__empty">No services yet</td></tr> : null}
          </tbody>
        </table>
      ) : (
        <div className="o-kanban">
          {pageList.map((item) => (
            <button
              key={item.id}
              type="button"
              className="o-kanban-card"
              onClick={() => navigate(`/pos/backend/products/${item.id}`)}
            >
              <div className="o-kanban-card__copy">
                <div className="o-kanban-card__name">{item.name}</div>
                <div className="o-kanban-card__price">{formatOdooINR(item.price)}</div>
              </div>
              {item.imageUrl ? <ProductThumb src={item.imageUrl} /> : <span className="o-kanban-card__photo" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
