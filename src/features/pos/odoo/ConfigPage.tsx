import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { useTitle } from '../../../lib/useTitle';
import { ChromeRecords } from './chrome';

export function ConfigPage() {
  useTitle('Configuration');
  const [posName, setPosName] = useState('Gymkhana');

  useEffect(() => {
    void api<{ config: { name: string } }>('/api/pos/dashboard')
      .then((dash) => setPosName(dash.config?.name || 'Gymkhana'))
      .catch(() => undefined);
  }, []);

  return (
    <ChromeRecords items={[{ id: 'config', title: posName || 'Gymkhana', subtitle: 'Point of sale', meta: 'Settings' }]}>
      {() => (
        <div className="gk-config">
          <h2>POS Configuration</h2>
          <div className="o-field">
            <label>Point of Sale</label>
            <input value={posName} readOnly />
          </div>
          <div className="o-field">
            <label>Payment methods</label>
            <input defaultValue="Cash, Card, Customer Account" readOnly />
          </div>
          <p>Full Odoo settings panels (tips, bill splitting, printers) land in the parity pass.</p>
        </div>
      )}
    </ChromeRecords>
  );
}
