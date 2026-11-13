import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { COMM_AUDIENCES, COMM_TEMPLATES, fillTemplate, templateByKey } from '../../../../shared/comms';
import { api } from '../../../lib/api';
import { useTitle } from '../../../lib/useTitle';
import { pushToast } from '../../../components/Toast';
import { communicationsTabId } from '../staffSession';
import { ChromeRecords } from '../odoo/chrome';
import type { BackendChromeContext } from '../odoo/OdooBackendLayout';
import { Dropdown } from './record';

const SELECTED_KEY = 'gk_comm_selected';

type Overview = {
  eligible: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  automations: number;
  manuals: number;
  estimatedSpendPaise: number;
  unitCostPaise: number;
  configured: boolean;
  missing: string[];
  campaigns: CampaignRow[];
  automationsRecent: { id: string; type: string; entity: string; created_at: string }[];
  failures: { id: string; to_mobile: string; template_key: string; error_message: string; created_at: string }[];
  activity: { id: string; to_mobile: string; template_key: string; status: string; created_at: string }[];
};

type CampaignRow = {
  id: string;
  name: string;
  kind: string;
  template_key: string;
  category: string;
  audience?: string;
  actor?: string;
  status: string;
  recipient_count: number;
  excluded_count: number;
  created_at: string;
};

type TemplateRow = {
  id: string;
  key: string;
  meta_name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  label?: string;
  localBody?: string;
  synced_at: string | null;
};

type Preview = {
  template: { key: string; label: string; category: string; metaStatus: string; metaName: string; body: string };
  category: string;
  recipientCount: number;
  excludedCount: number;
  estimatedSpendPaise: number;
  unitCostPaise: number;
  configured: boolean;
  missing: string[];
  included: { id: string; name: string; mobile: string; preview: string }[];
  excluded: { id: string; name: string; mobile: string; reason: string }[];
  previews: { id: string; name: string; mobile: string; preview: string }[];
};

type Settings = {
  phoneNumberId: string;
  wabaId: string;
  graphVersion: string;
  webhookPath: string;
  webhookVerifyToken: string;
  webhookVerifyTokenSet: boolean;
  testNumber: string;
  unitCostPaise: number;
  bookingReminderHours: number;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  configured: boolean;
  missing: string[];
  consentWording: string;
};

type MemberRow = {
  id: string;
  name: string;
  mobile: string;
  email: string;
  memberCode: string;
  membershipStatus: string;
  expiresAt: string | null;
  consentStatus?: string;
  lastWhatsAppAt?: string;
  lastWhatsAppStatus?: string;
  coachName?: string;
};

function spend(paise: number, unit: number) {
  if (!unit) return '₹0.00';
  return `₹${(paise / 100).toFixed(2)}`;
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
}

function consentLabel(status?: string) {
  if (status === 'OPT_IN') return 'Opted in';
  if (status === 'OPT_OUT') return 'Opted out';
  return 'Unknown';
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    QUEUED: 'Queued',
    SENDING: 'Sending',
    ACCEPTED: 'Accepted',
    SENT: 'Sent',
    DELIVERED: 'Delivered',
    READ: 'Read',
    FAILED: 'Failed',
    SKIPPED: 'Skipped',
    NOT_SYNCED: 'Not synced',
    APPROVED: 'Approved',
    PENDING: 'Pending',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
  };
  return map[status] || status;
}

function takeSelected(): string[] {
  try {
    const raw = sessionStorage.getItem(SELECTED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function stashSelectedMembers(ids: string[]) {
  sessionStorage.setItem(SELECTED_KEY, JSON.stringify(ids));
}

function Shell({ title, children }: { title: string; children: ReactNode; error?: string }) {
  useTitle(title);
  return (
    <section className="o-track">
      {children}
    </section>
  );
}

export function CommunicationsPage() {
  const { pathname } = useLocation();
  const params = useParams();
  const tab = params.tab || communicationsTabId(pathname);
  if (tab === 'compose') return <ComposeView />;
  if (tab === 'audience') return <AudienceView />;
  if (tab === 'automations') return <AutomationsView />;
  if (tab === 'templates') return <TemplatesView />;
  if (tab === 'history') return <HistoryView />;
  if (tab === 'reports') return params.id ? <ReportView id={params.id} /> : <HistoryView reports />;
  if (tab === 'settings') return <SettingsView />;
  return <OverviewView />;
}

function OverviewView() {
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    try {
      setData(await api<Overview>(`/api/gym/communications/overview?${query.toString()}`));
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load communications.';
      setError(message);
      pushToast(message, 'err');
    }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);
  const kpis = data ? [
    ['Eligible recipients', String(data.eligible)],
    ['Messages sent', String(data.sent)],
    ['Delivered', String(data.delivered)],
    ['Read', String(data.read)],
    ['Failed', String(data.failed)],
    ['Pending', String(data.pending)],
    ['Automations', String(data.automations)],
    ['Manual campaigns', String(data.manuals)],
    ['Estimated spend', spend(data.estimatedSpendPaise, data.unitCostPaise)],
  ] : [];
  return (
    <Shell title="Communications" error={error}>
      <header className="o-track__hello">
        <h2>Overview</h2>
        <div className="gk-comms-dates">
          <label>From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </div>
      </header>
      {data && !data.configured ? (
        <p className="gk-muted gk-comms-warn">WhatsApp is not sending yet. Missing {data.missing.join(', ')}. Set env values and the Settings page. Queued messages stay failed until then.</p>
      ) : null}
      <section className="o-track__kpis o-track__kpis--four">
        {kpis.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{data ? value : '—'}</strong>
          </article>
        ))}
      </section>
      <ChromeRecords
        items={(data?.campaigns ?? []).map((row) => ({ id: row.id, title: row.name, subtitle: `${row.kind} · ${row.template_key}`, meta: statusLabel(row.status), when: row.created_at, href: `/pos/backend/communications/reports/${row.id}` }))}
        empty="No campaigns yet — compose a message from this module"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead><tr><th>Recent campaigns</th><th>Kind</th><th>Recipients</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {page.map((item) => {
                const row = data?.campaigns.find((entry) => entry.id === item.id);
                if (!row) return null;
                return (
                  <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/communications/reports/${row.id}`)}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.kind === 'AUTOMATION' ? 'Automation' : row.kind === 'TEST' ? 'Test' : 'Manual'}</td>
                    <td>{row.recipient_count} sent · {row.excluded_count} excluded</td>
                    <td>{statusLabel(row.status)}</td>
                    <td>{when(row.created_at)}</td>
                  </tr>
                );
              })}
              {!data?.campaigns.length ? <tr><td colSpan={5} className="o-be-table__empty">No campaigns yet — compose a message from this module</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
      <table className="o-be-table gk-table">
        <thead><tr><th>Recent automations</th><th>When</th></tr></thead>
        <tbody>
          {(data?.automationsRecent ?? []).map((row) => (
            <tr key={row.id}><td>{row.type.replaceAll('_', ' ')}</td><td>{when(row.created_at)}</td></tr>
          ))}
          {!data?.automationsRecent.length ? <tr><td colSpan={2} className="o-be-table__empty">No automated notifications yet</td></tr> : null}
        </tbody>
      </table>
      <table className="o-be-table gk-table">
        <thead><tr><th>Failed deliveries</th><th>Template</th><th>Error</th><th>When</th></tr></thead>
        <tbody>
          {(data?.failures ?? []).map((row) => (
            <tr key={row.id}><td>{row.to_mobile}</td><td>{row.template_key}</td><td>{row.error_message || '—'}</td><td>{when(row.created_at)}</td></tr>
          ))}
          {!data?.failures.length ? <tr><td colSpan={4} className="o-be-table__empty">No failed deliveries yet</td></tr> : null}
        </tbody>
      </table>
      <table className="o-be-table gk-table">
        <thead><tr><th>Message activity</th><th>Status</th><th>When</th></tr></thead>
        <tbody>
          {(data?.activity ?? []).map((row) => (
            <tr key={row.id}><td>{row.template_key} · {row.to_mobile}</td><td>{statusLabel(row.status)}</td><td>{when(row.created_at)}</td></tr>
          ))}
          {!data?.activity.length ? <tr><td colSpan={3} className="o-be-table__empty">No messages yet</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

function ComposeView() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState('announcement');
  const [language, setLanguage] = useState('en');
  const [audience, setAudience] = useState(takeSelected().length ? 'selected' : 'eligible');
  const [memberIds, setMemberIds] = useState<string[]>(takeSelected());
  const [sport, setSport] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [headline, setHeadline] = useState('');
  const [details, setDetails] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [trainers, setTrainers] = useState<{ id: string; name: string }[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string; sport: string }[]>([]);
  const def = templateByKey(templateKey);
  useEffect(() => {
    const fromQuery = search.get('members');
    if (fromQuery) setMemberIds(fromQuery.split(',').filter(Boolean));
  }, [search]);
  useEffect(() => {
    void api<{ trainers: { id: string; name: string }[] }>('/api/gym/trainers').then((data) => setTrainers(data.trainers)).catch(() => undefined);
    void api<{ facilities: { id: string; name: string; sport: string }[] }>('/api/gym/facilities').then((data) => setFacilities(data.facilities)).catch(() => undefined);
  }, []);
  const extras = useMemo(() => ({ headline, details }), [headline, details]);
  const sports = Array.from(new Set(facilities.map((row) => row.sport).filter(Boolean))).sort();

  async function runPreview() {
    setBusy(true);
    setError('');
    try {
      const data = await api<Preview>('/api/gym/communications/preview', {
        method: 'POST',
        body: JSON.stringify({ templateKey, language, audience, memberIds, sport, trainerId, facilityId, extras }),
      });
      setPreview(data);
      setConfirming(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not preview.';
      setError(message);
      pushToast(message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!preview) return;
    setBusy(true);
    try {
      const data = await api<{ campaignId: string }>('/api/gym/communications/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: name || preview.template.label,
          templateKey,
          language,
          audience,
          memberIds,
          sport,
          trainerId,
          facilityId,
          extras,
          confirm: true,
        }),
      });
      sessionStorage.removeItem(SELECTED_KEY);
      pushToast('Campaign queued');
      navigate(`/pos/backend/communications/reports/${data.campaignId}`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not send.', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    setBusy(true);
    try {
      await api('/api/gym/communications/test', { method: 'POST', body: JSON.stringify({ templateKey }) });
      pushToast('Test message queued to the saved test number');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Test send failed.', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Compose message" error={error}>
      <header className="o-track__hello">
        <h2>Compose message</h2>
        <div className="gk-head-actions">
          <button type="button" className="gk-btn" disabled={busy} onClick={() => void testSend()}>Send test</button>
          <button type="button" className="gk-btn" disabled={busy} onClick={() => void runPreview()}>{busy ? 'Working…' : 'Preview and confirm'}</button>
        </div>
      </header>
      <div className="gk-comms-form">
        <label>Campaign name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Court closed Friday" /></label>
        <label>Template
          <Dropdown label="Template" value={templateKey} options={COMM_TEMPLATES.map((row) => ({ value: row.key, label: `${row.label} · ${row.category}` }))} onChange={setTemplateKey} />
        </label>
        <p className="gk-muted">Category is {def?.category || '—'}. Marketing and general announcements stay Marketing. Do not reclassify them as Utility.</p>
        <label>Language
          <Dropdown label="Language" value={language} options={[{ value: 'en', label: 'English' }]} onChange={setLanguage} />
        </label>
        <label>Audience
          <Dropdown label="Audience" value={audience} options={COMM_AUDIENCES.map((row) => ({ value: row.id, label: row.label }))} onChange={setAudience} />
        </label>
        {audience === 'sport' ? (
          <label>Sport
            <Dropdown label="Sport" value={sport} options={[{ value: '', label: 'Choose a sport' }, ...sports.map((row) => ({ value: row, label: row }))]} onChange={setSport} />
          </label>
        ) : null}
        {audience === 'trainer' ? (
          <label>Trainer
            <Dropdown label="Trainer" value={trainerId} options={[{ value: '', label: 'Any assigned trainer' }, ...trainers.map((row) => ({ value: row.id, label: row.name }))]} onChange={setTrainerId} />
          </label>
        ) : null}
        {audience === 'maintenance' ? (
          <label>Facility
            <Dropdown label="Facility" value={facilityId} options={[{ value: '', label: 'Any facility in maintenance' }, ...facilities.map((row) => ({ value: row.id, label: row.name }))]} onChange={setFacilityId} />
          </label>
        ) : null}
        {audience === 'selected' ? <p className="gk-muted">{memberIds.length} member{memberIds.length === 1 ? '' : 's'} selected from Active Members.</p> : null}
        {templateKey === 'announcement' ? (
          <>
            <label>Headline<input value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="Badminton courts closed" /></label>
            <label>Details<textarea value={details} onChange={(event) => setDetails(event.target.value)} rows={3} placeholder="Closed Friday 8 Nov for resurfacing." /></label>
          </>
        ) : null}
        {def ? <p className="gk-comms-preview">{fillTemplate(def.body, { name: 'Asha', membership_id: 'GK0001', expiry_date: '8 Nov 2027', new_expiry_date: '8 Nov 2027', amount: '₹4,000', transaction_id: 'abc12345', payment_date: '8 Nov 2026', membership_ref: 'Annual', booking_id: 'bk12', facility: 'Court 1', sport: 'Badminton', booking_date: '9 Nov', start_time: '18:00', end_time: '19:00', refund_status: 'No refund', old_when: '8 Nov 18:00', new_when: '9 Nov 18:00', trainer_name: 'Neha Kapoor', session_date: '9 Nov', location: 'Gym', session_ref: 'ss12', headline: headline || 'Update', details: details || 'Details here' })}</p> : null}
      </div>
      {confirming && preview ? (
        <div className="gk-comms-confirm" role="dialog" aria-label="Confirm send">
          <h3>Confirm send</h3>
          <p>{preview.recipientCount} recipient{preview.recipientCount === 1 ? '' : 's'} · {preview.category} · {preview.template.label}</p>
          <p>Estimated cost {spend(preview.estimatedSpendPaise, preview.unitCostPaise)}{preview.unitCostPaise ? '' : ' (set a unit cost in Settings to estimate).'}</p>
          <p>{preview.excludedCount} excluded (opted out, unknown consent, or invalid phone).</p>
          {!preview.configured ? <p className="gk-comms-warn">Missing {preview.missing.join(', ')}. The queue will record failed sends until credentials are set. No live WhatsApp call will succeed.</p> : null}
          {preview.template.metaStatus !== 'APPROVED' ? <p className="gk-muted">Meta status: {statusLabel(preview.template.metaStatus)}. Sending is blocked once WhatsApp is configured until this template is approved.</p> : null}
          <ul>
            {preview.previews.map((row) => <li key={row.id}><strong>{row.name}</strong> · {row.mobile}<div className="gk-muted">{row.preview}</div></li>)}
          </ul>
          {preview.excluded.slice(0, 8).map((row) => <p key={row.id} className="gk-muted">{row.name} — {row.reason}</p>)}
          <div className="gk-head-actions">
            <button type="button" className="gk-btn" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
            <button type="button" className="gk-btn" disabled={busy || preview.recipientCount === 0} onClick={() => void send()}>Send to {preview.recipientCount}</button>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

function AudienceView() {
  const navigate = useNavigate();
  const chrome = useOutletContext<BackendChromeContext>();
  const [filter, setFilter] = useState('wa_opted_in');
  const [sport, setSport] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [facilities, setFacilities] = useState<{ sport: string }[]>([]);
  const load = useCallback(async () => {
    const query = new URLSearchParams({ filter });
    if (sport) query.set('sport', sport);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    try {
      const data = await api<{ members: MemberRow[] }>(`/api/gym/members?${query.toString()}`);
      setMembers(data.members);
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load members.';
      setError(message);
      pushToast(message, 'err');
    }
  }, [filter, sport, from, to]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void api<{ facilities: { sport: string }[] }>('/api/gym/facilities').then((data) => setFacilities(data.facilities)).catch(() => undefined);
  }, []);
  const sports = Array.from(new Set(facilities.map((row) => row.sport).filter(Boolean))).sort();
  const visible = members.filter((member) => {
    const needle = chrome.search.trim().toLowerCase();
    if (!needle) return true;
    return `${member.name} ${member.mobile} ${member.memberCode}`.toLowerCase().includes(needle);
  });
  const eligible = visible.filter((row) => row.consentStatus === 'OPT_IN' && row.mobile.replace(/\D/g, '').length >= 10);
  function toggle(id: string) {
    setPicked((current) => current.includes(id) ? current.filter((row) => row !== id) : [...current, id]);
  }
  function compose(ids: string[]) {
    stashSelectedMembers(ids);
    navigate('/pos/backend/communications/compose');
  }
  function exportList() {
    const rows = [['Member ID', 'Name', 'Phone', 'Email', 'Status', 'Expires', 'WhatsApp']];
    for (const member of eligible) {
      rows.push([member.memberCode, member.name, member.mobile, member.email, member.membershipStatus, member.expiresAt?.slice(0, 10) || '', consentLabel(member.consentStatus)]);
    }
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gymkhana-whatsapp-recipients.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Shell title="Active members" error={error}>
      <header className="o-track__hello">
        <h2>Audience</h2>
        <div className="gk-head-actions">
          <button type="button" className="gk-btn" onClick={() => { setPicked(eligible.map((row) => row.id)); }}>Select all eligible</button>
          <button type="button" className="gk-btn" disabled={!picked.length} onClick={() => compose(picked)}>Send template</button>
          <button type="button" className="gk-btn" onClick={exportList}>Export eligible</button>
        </div>
      </header>
      <div className="gk-comms-filters">
        <Dropdown
          label="Filter"
          value={filter}
          options={[
            { value: 'all', label: 'All members' },
            { value: 'ACTIVE', label: 'Active memberships' },
            { value: 'expired', label: 'Expired memberships' },
            { value: 'expiring7', label: 'Expiring in 7 days' },
            { value: 'expiring14', label: 'Expiring in 14 days' },
            { value: 'expiring30', label: 'Expiring in 30 days' },
            { value: 'registered_recent', label: 'Recently registered' },
            { value: 'renewed_recent', label: 'Recently renewed' },
            { value: 'upcoming_bookings', label: 'Upcoming bookings' },
            { value: 'no_upcoming', label: 'No upcoming bookings' },
            { value: 'with_trainer', label: 'Assigned to a trainer' },
            { value: 'no_trainer', label: 'No trainer' },
            { value: 'wa_opted_in', label: 'WhatsApp opted in' },
            { value: 'wa_unknown', label: 'Unknown consent' },
            { value: 'wa_opted_out', label: 'Opted out' },
            { value: 'invalid_phone', label: 'Invalid phone' },
          ]}
          onChange={setFilter}
        />
        <Dropdown label="Sport" value={sport} options={[{ value: '', label: 'Any sport' }, ...sports.map((row) => ({ value: row, label: row }))]} onChange={setSport} />
        <label>From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <p className="gk-muted">{eligible.length} eligible opted-in recipients in this view. Opted-out members are never included in sends.</p>
      <ChromeRecords
        items={visible.map((member) => ({
          id: member.id,
          title: member.name,
          subtitle: `${member.mobile} ${member.memberCode}`,
          meta: consentLabel(member.consentStatus),
          href: `/pos/backend/people/${member.id}`,
        }))}
        empty="No members yet — add one from Active users"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead>
              <tr>
                <th />
                <th>Member ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Membership</th>
                <th>Expires</th>
                <th>WhatsApp</th>
                <th>Last message</th>
              </tr>
            </thead>
            <tbody>
              {page.map((item) => {
                const member = visible.find((row) => row.id === item.id);
                if (!member) return null;
                return (
                  <tr key={member.id} className="is-link" onClick={() => navigate(`/pos/backend/people/${member.id}`)}>
                    <td onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={picked.includes(member.id)} aria-label={`Select ${member.name}`} onChange={() => toggle(member.id)} />
                    </td>
                    <td>{member.memberCode || '—'}</td>
                    <td><strong>{member.name}</strong></td>
                    <td>{member.mobile}</td>
                    <td>{member.email || '—'}</td>
                    <td>{member.membershipStatus}</td>
                    <td>{member.expiresAt ? member.expiresAt.slice(0, 10) : '—'}</td>
                    <td>{consentLabel(member.consentStatus)}</td>
                    <td>{member.lastWhatsAppAt ? `${statusLabel(member.lastWhatsAppStatus || '')} · ${when(member.lastWhatsAppAt)}` : '—'}</td>
                  </tr>
                );
              })}
              {!visible.length ? <tr><td colSpan={9} className="o-be-table__empty">No members yet — add one from Active users</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
    </Shell>
  );
}

function AutomationsView() {
  const [events, setEvents] = useState<{ type: string; created_at: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Overview>('/api/gym/communications/overview').then((data) => setEvents(data.automationsRecent)).catch((err) => setError(err instanceof Error ? err.message : 'Could not load.'));
  }, []);
  return (
    <Shell title="Automated notifications" error={error}>
      <header className="o-track__hello"><h2>Automated notifications</h2></header>
      <p className="gk-muted">These fire after a successful membership, booking, payment or trainer change. They are not sent from the screen. Consent and a valid phone are required. The 14-day expiry job runs on Asia/Kolkata.</p>
      <table className="o-be-table gk-table">
        <thead><tr><th>Event</th><th>Template</th><th>Category</th><th>Last recorded</th></tr></thead>
        <tbody>
          {COMM_TEMPLATES.filter((row) => row.event).map((row) => {
            const last = events.find((item) => item.type === row.event);
            return (
              <tr key={row.key}>
                <td>{row.event?.replaceAll('_', ' ')}</td>
                <td>{row.label}</td>
                <td>{row.category}</td>
                <td>{last ? when(last.created_at) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Shell>
  );
}

function TemplatesView() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await api<{ templates: TemplateRow[] }>('/api/gym/communications/templates');
      setRows(data.templates);
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load templates.';
      setError(message);
      pushToast(message, 'err');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function sync() {
    setBusy(true);
    try {
      const data = await api<{ templates: TemplateRow[] }>('/api/gym/communications/templates/sync', { method: 'POST', body: '{}' });
      setRows(data.templates);
      pushToast('Templates synced from Meta');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Sync failed.', 'err');
    } finally {
      setBusy(false);
    }
  }
  async function test(key: string) {
    try {
      await api('/api/gym/communications/test', { method: 'POST', body: JSON.stringify({ templateKey: key }) });
      pushToast('Test queued to the saved test number');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Test send failed.', 'err');
    }
  }
  return (
    <Shell title="Message templates" error={error}>
      <header className="o-track__hello">
        <h2>Message templates</h2>
        <button type="button" className="gk-btn" disabled={busy} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync from Meta'}</button>
      </header>
      <p className="gk-muted">Approval status comes from Meta after sync. A local draft is not treated as approved.</p>
      <table className="o-be-table gk-table">
        <thead><tr><th>Template</th><th>Meta name</th><th>Category</th><th>Status</th><th>Preview</th><th /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.label || row.key}</strong></td>
              <td>{row.meta_name}</td>
              <td>{row.category}</td>
              <td>{statusLabel(row.status)}</td>
              <td className="gk-muted">{row.localBody || row.body}</td>
              <td className="gk-actions"><button type="button" className="gk-btn gk-btn--sm" onClick={() => void test(row.key)}>Test</button></td>
            </tr>
          ))}
          {!rows.length ? <tr><td colSpan={6} className="o-be-table__empty">No templates yet — they appear after the first load</td></tr> : null}
        </tbody>
      </table>
    </Shell>
  );
}

function HistoryView({ reports = false }: { reports?: boolean }) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [messages, setMessages] = useState<{ id: string; customer_id?: string; to_mobile?: string; template_key: string; status: string; error_message?: string; created_at: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ campaigns: CampaignRow[] }>('/api/gym/communications/campaigns').then((data) => setCampaigns(data.campaigns)).catch((err) => setError(err instanceof Error ? err.message : 'Could not load.'));
    void api<{ messages: typeof messages }>('/api/gym/communications/messages').then((data) => setMessages(data.messages)).catch(() => undefined);
  }, []);
  return (
    <Shell title={reports ? 'Delivery reports' : 'Campaign history'} error={error}>
      <header className="o-track__hello"><h2>{reports ? 'Delivery reports' : 'Campaign history'}</h2></header>
      <ChromeRecords
        items={campaigns.map((row) => ({ id: row.id, title: row.name, subtitle: `${row.kind} · ${row.category}`, meta: statusLabel(row.status), when: row.created_at, href: `/pos/backend/communications/reports/${row.id}` }))}
        empty="No campaigns yet — compose a message from this module"
      >
        {(page) => (
          <table className="o-be-table gk-table">
            <thead><tr><th>Campaign</th><th>Kind</th><th>Category</th><th>Recipients</th><th>Status</th><th>When</th></tr></thead>
            <tbody>
              {page.map((item) => {
                const row = campaigns.find((entry) => entry.id === item.id);
                if (!row) return null;
                return (
                  <tr key={row.id} className="is-link" onClick={() => navigate(`/pos/backend/communications/reports/${row.id}`)}>
                    <td><strong>{row.name}</strong><div className="gk-muted">{row.template_key}</div></td>
                    <td>{row.kind}</td>
                    <td>{row.category}</td>
                    <td>{row.recipient_count} / {row.excluded_count} excluded</td>
                    <td>{statusLabel(row.status)}</td>
                    <td>{when(row.created_at)}</td>
                  </tr>
                );
              })}
              {!campaigns.length ? <tr><td colSpan={6} className="o-be-table__empty">No campaigns yet — compose a message from this module</td></tr> : null}
            </tbody>
          </table>
        )}
      </ChromeRecords>
      {!reports ? (
        <table className="o-be-table gk-table">
          <thead><tr><th>Message</th><th>To</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {messages.map((row) => (
              <tr key={row.id}>
                <td>{row.template_key}</td>
                <td>{row.to_mobile || '—'}</td>
                <td>{statusLabel(row.status)}{row.error_message ? ` · ${row.error_message}` : ''}</td>
                <td>{when(row.created_at)}</td>
              </tr>
            ))}
            {!messages.length ? <tr><td colSpan={4} className="o-be-table__empty">No messages yet</td></tr> : null}
          </tbody>
        </table>
      ) : null}
    </Shell>
  );
}

function ReportView({ id }: { id: string }) {
  const [data, setData] = useState<{
    campaign: CampaignRow;
    recipients: { id: string; name: string; mobile: string; status: string; excluded_reason: string }[];
    counts: { queued: number; accepted: number; delivered: number; read: number; failed: number; skipped: number };
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api(`/api/gym/communications/campaigns/${id}`));
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load report.';
      setError(message);
      pushToast(message, 'err');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function cancel() {
    setBusy(true);
    try {
      await api(`/api/gym/communications/campaigns/${id}/cancel`, { method: 'POST', body: '{}' });
      pushToast('Campaign cancelled');
      await load();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not cancel.', 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Delivery report" error={error}>
      <header className="o-track__hello">
        <h2>{data?.campaign.name || 'Delivery report'}</h2>
        {data?.campaign.status === 'QUEUED' ? <button type="button" className="gk-btn" disabled={busy} onClick={() => void cancel()}>Cancel remaining</button> : null}
      </header>
      {data ? (
        <>
          <p className="gk-muted">{data.campaign.kind} · {data.campaign.category} · {statusLabel(data.campaign.status)}. Accepted is not delivered.</p>
          <section className="o-track__kpis o-track__kpis--four">
            <article><span>Queued</span><strong>{data.counts.queued}</strong></article>
            <article><span>Accepted / sent</span><strong>{data.counts.accepted}</strong></article>
            <article><span>Delivered</span><strong>{data.counts.delivered}</strong></article>
            <article><span>Read</span><strong>{data.counts.read}</strong></article>
            <article><span>Failed</span><strong>{data.counts.failed}</strong></article>
            <article><span>Skipped</span><strong>{data.counts.skipped}</strong></article>
          </section>
          <table className="o-be-table gk-table">
            <thead><tr><th>Recipient</th><th>Phone</th><th>Status</th></tr></thead>
            <tbody>
              {data.recipients.map((row) => (
                <tr key={row.id}>
                  <td>{row.name || '—'}</td>
                  <td>{row.mobile}</td>
                  <td>{statusLabel(row.status)}{row.excluded_reason ? ` · ${row.excluded_reason}` : ''}</td>
                </tr>
              ))}
              {!data.recipients.length ? <tr><td colSpan={3} className="o-be-table__empty">No recipients on this campaign</td></tr> : null}
            </tbody>
          </table>
        </>
      ) : null}
    </Shell>
  );
}

function SettingsView() {
  const [data, setData] = useState<Settings | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [graphVersion, setGraphVersion] = useState('v21.0');
  const [verifyToken, setVerifyToken] = useState('');
  const [testNumber, setTestNumber] = useState('');
  const [unit, setUnit] = useState('0');
  const [hours, setHours] = useState('24');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Settings>('/api/gym/communications/settings').then((row) => {
      setData(row);
      setPhoneNumberId(row.phoneNumberId);
      setWabaId(row.wabaId);
      setGraphVersion(row.graphVersion);
      setVerifyToken(row.webhookVerifyToken);
      setTestNumber(row.testNumber);
      setUnit(String(row.unitCostPaise));
      setHours(String(row.bookingReminderHours));
    }).catch((err) => setError(err instanceof Error ? err.message : 'Managers only.'));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const row = await api<Settings>('/api/gym/communications/settings', {
        method: 'POST',
        body: JSON.stringify({
          phoneNumberId,
          wabaId,
          graphVersion,
          webhookVerifyToken: verifyToken || undefined,
          testNumber,
          unitCostPaise: Number(unit) || 0,
          bookingReminderHours: Number(hours) || 24,
        }),
      });
      setData(row);
      setVerifyToken('');
      pushToast('WhatsApp settings saved');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not save.', 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="WhatsApp settings" error={error}>
      <header className="o-track__hello"><h2>WhatsApp settings</h2></header>
      {data ? (
        <form className="gk-comms-form" onSubmit={(event) => void save(event)}>
          <p className="gk-muted">{data.consentWording}</p>
          {data.missing.length ? <p className="gk-comms-warn">Still missing: {data.missing.join(', ')}. Access token and app secret stay in server env only.</p> : <p>Cloud API credentials are present.</p>}
          <p className="gk-muted">Access token: {data.hasAccessToken ? 'set in env' : 'missing WHATSAPP_ACCESS_TOKEN'}. App secret: {data.hasAppSecret ? 'set in env' : 'missing WHATSAPP_APP_SECRET'}.</p>
          <label>Phone number ID<input value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} autoComplete="off" /></label>
          <label>WhatsApp Business Account ID<input value={wabaId} onChange={(event) => setWabaId(event.target.value)} autoComplete="off" /></label>
          <label>Graph API version<input value={graphVersion} onChange={(event) => setGraphVersion(event.target.value)} /></label>
          <label>
            Callback URL
            <input readOnly value={`${window.location.origin}${data.webhookPath || '/api/webhooks/whatsapp'}`} onFocus={(event) => event.currentTarget.select()} />
          </label>
          <p className="gk-muted">Paste that into Meta → Callback URL. Meta needs a public https URL, not localhost. On Vercel use the live site origin with the same path.</p>
          <label>Verify token<input value={verifyToken} onChange={(event) => setVerifyToken(event.target.value)} placeholder="Same value as Meta Verify token" autoComplete="off" /></label>
          <p className="gk-muted">Paste the same verify token into Meta. Leave client certificate off.</p>
          <label>Authorized test number<input value={testNumber} onChange={(event) => setTestNumber(event.target.value)} placeholder="10-digit mobile" /></label>
          <label>Estimated cost per message (paise)<input value={unit} inputMode="numeric" onChange={(event) => setUnit(event.target.value)} /></label>
          <label>Booking reminder hours<input value={hours} inputMode="numeric" onChange={(event) => setHours(event.target.value)} /></label>
          <button type="submit" className="gk-btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      ) : null}
    </Shell>
  );
}
