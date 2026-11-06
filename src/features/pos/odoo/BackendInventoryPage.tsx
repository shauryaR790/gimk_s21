import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChromeRecords } from './chrome';
import { formatOdooINR, type InventoryItem } from '../../../../shared/domain';
import { api } from '../../../lib/api';
import { useTitle } from '../../../lib/useTitle';

function qtyLabel(qty: number, unit: string) {
  const rounded = Math.abs(qty) >= 10 ? qty.toFixed(1).replace(/\.0$/, '') : qty.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${rounded} ${unit}`;
}

export function BackendInventoryPage() {
  useTitle('Inventory');
  const navigate = useNavigate();
  const [data, setData] = useState<{ items: InventoryItem[] } | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<{ items: InventoryItem[] }>('/api/inventory'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inventory');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (data?.items ?? []).filter((item) => item.category === 'Training');
    if (!needle) return list;
    return list.filter((item) => item.name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle));
  }, [data, query]);
  const stockValue = items.reduce((sum, item) => sum + item.qty * item.costPerUnit, 0);
  const lowStock = items.filter((item) => item.lowStock).length;

  return (
    <section className="o-track">
      <header className="o-track__hello">
        <h2>Inventory</h2>
        <div className="gk-head-actions">
          <input className="gk-input" placeholder="Search stock" aria-label="Search stock" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className="gk-btn" onClick={() => navigate('/pos/backend/inventory/new')}>Add item</button>
        </div>
      </header>

      {error ? <p className="o-track__error">{error}</p> : null}

      <section className="o-track__status">
        <article className="o-track__stat o-track__stat--plain"><span>Pieces tracked</span><strong>{items.reduce((sum, item) => sum + item.qty, 0)}</strong><em>In the store</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Lines</span><strong>{items.length}</strong><em>Kinds of equipment</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Low stock</span><strong>{lowStock}</strong><em>At or under reorder</em></article>
        <article className="o-track__stat o-track__stat--plain"><span>Stock value</span><strong>{formatOdooINR(stockValue)}</strong><em>At cost</em></article>
      </section>

      <ChromeRecords
        items={items.map((item) => ({
          id: item.id,
          title: item.name,
          subtitle: item.sku || qtyLabel(item.qty, item.unit),
          meta: item.lowStock ? 'Low stock' : item.supplier || 'In store',
          href: `/pos/backend/inventory/${item.id}`,
        }))}
        empty="No equipment yet — add an item from this page"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead>
              <tr><th>Equipment</th><th>SKU</th><th>On hand</th><th>Reorder at</th><th>Cost per piece</th><th>Supplier</th></tr>
            </thead>
            <tbody>
              {page.map((card) => {
                const item = items.find((row) => row.id === card.id);
                if (!item) return null;
                return (
                  <tr key={item.id} className={`is-link${item.lowStock ? ' is-low' : ''}`} onClick={() => navigate(`/pos/backend/inventory/${item.id}`)}>
                    <td><strong>{item.name}</strong></td>
                    <td>{item.sku || '—'}</td>
                    <td>{qtyLabel(item.qty, item.unit)}</td>
                    <td>{qtyLabel(item.reorderLevel, item.unit)}</td>
                    <td>{formatOdooINR(item.costPerUnit)}</td>
                    <td>{item.supplier || '—'}</td>
                  </tr>
                );
              })}
              {!items.length ? <tr><td colSpan={6} className="o-be-table__empty">No equipment yet — add an item from this page</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
    </section>
  );
}
