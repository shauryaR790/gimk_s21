import { randomUUID } from 'node:crypto';
import { AppError } from './appError';
import { all, get, run, tx } from './db';
import { env } from './env';
import { CAFE_ID } from './ids';
import { COMM_TEMPLATES, fillTemplate, templateByEvent, templateByKey, type CommCategory } from '../shared/comms';
import {
  fetchWhatsAppTemplates,
  parseWhatsAppWebhook,
  sendWhatsAppTemplate,
  toWhatsAppNumber,
  verifyWhatsAppSignature,
  verifyWhatsAppWebhookToken,
  whatsappMissing,
  whatsappReady,
} from './whatsapp';

const CONSENT_WORDING = 'Gymkhana may send membership, booking and club updates on WhatsApp.';
const DEFAULT_VERIFY_TOKEN = 'gymkhana-whatsapp-verify';
export const WHATSAPP_WEBHOOK_PATH = '/api/webhooks/whatsapp';

function nowIso() {
  return new Date().toISOString();
}

function kolkataYmd(value: Date | string = new Date()) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function kolkataTime(value: string) {
  return new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function rupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

function digits(mobile: string) {
  const clean = mobile.replace(/\D/g, '');
  if (clean.length < 10) return '';
  return clean.slice(-10);
}

function ensureSettings() {
  const row = get<{ id: string; webhook_verify_token: string }>('SELECT id, webhook_verify_token FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID]);
  const verify = env.whatsappVerifyToken || DEFAULT_VERIFY_TOKEN;
  if (!row) {
    run(
      `INSERT INTO whatsapp_settings (id, cafe_id, phone_number_id, waba_id, graph_version, webhook_verify_token, test_number, unit_cost_paise, booking_reminder_hours, updated_at)
       VALUES (?, ?, '', '', ?, ?, '', 0, 24, ?)`,
      [CAFE_ID, CAFE_ID, env.whatsappGraphVersion, verify, nowIso()],
    );
  } else if (!row.webhook_verify_token && !env.whatsappVerifyToken) {
    run('UPDATE whatsapp_settings SET webhook_verify_token = ?, updated_at = ? WHERE cafe_id = ?', [DEFAULT_VERIFY_TOKEN, nowIso(), CAFE_ID]);
  }
  for (const def of COMM_TEMPLATES) {
    const exists = get('SELECT id FROM whatsapp_templates WHERE cafe_id = ? AND key = ? AND language = ?', [CAFE_ID, def.key, 'en']);
    if (exists) continue;
    run(
      `INSERT INTO whatsapp_templates (id, cafe_id, key, meta_name, language, category, status, body, variables_json, synced_at)
       VALUES (?, ?, ?, ?, 'en', ?, 'NOT_SYNCED', ?, ?, NULL)`,
      [randomUUID(), CAFE_ID, def.key, def.metaName, def.category, def.body, JSON.stringify(def.variables.map((item) => item.key))],
    );
  }
}

type MemberLite = {
  id: string;
  name: string;
  mobile: string;
  member_code: string;
  membership_status: string;
  membership_expires_at: string | null;
  created_at: string;
  plan_id: string | null;
  coach_id: string | null;
  access_interest: string;
  email: string;
};

function memberRow(customerId: string) {
  return get<MemberLite>(
    `SELECT id, name, mobile, member_code, membership_status, membership_expires_at, created_at, plan_id, coach_id, IFNULL(access_interest,'') AS access_interest, IFNULL(email,'') AS email
     FROM customers WHERE id = ? AND cafe_id = ?`,
    [customerId, CAFE_ID],
  );
}

export function consentFor(customerId: string) {
  ensureSettings();
  const row = get<{ status: string; marketing_status: string; source: string; wording: string; consented_at: string | null; revoked_at: string | null; updated_at: string }>(
    'SELECT status, marketing_status, source, wording, consented_at, revoked_at, updated_at FROM communication_consent WHERE cafe_id = ? AND customer_id = ?',
    [CAFE_ID, customerId],
  );
  return row ?? {
    status: 'UNKNOWN',
    marketing_status: 'UNKNOWN',
    source: '',
    wording: '',
    consented_at: null,
    revoked_at: null,
    updated_at: null,
  };
}

export function setConsent(customerId: string, input: { status: string; marketingStatus?: string; source: string }, actor: string) {
  const member = memberRow(customerId);
  if (!member) throw new AppError(404, 'MEMBER', 'Member not found.');
  const status = input.status === 'OPT_IN' || input.status === 'OPT_OUT' ? input.status : 'UNKNOWN';
  const marketing = input.marketingStatus === 'OPT_IN' || input.marketingStatus === 'OPT_OUT' ? input.marketingStatus : status;
  const existing = get<{ id: string }>('SELECT id FROM communication_consent WHERE cafe_id = ? AND customer_id = ?', [CAFE_ID, customerId]);
  const now = nowIso();
  if (existing) {
    run(
      `UPDATE communication_consent SET status = ?, marketing_status = ?, source = ?, wording = ?, consented_at = ?, revoked_at = ?, updated_at = ? WHERE id = ?`,
      [status, marketing, input.source || actor, CONSENT_WORDING, status === 'OPT_IN' ? now : null, status === 'OPT_OUT' ? now : null, now, existing.id],
    );
  } else {
    run(
      `INSERT INTO communication_consent (id, cafe_id, customer_id, status, marketing_status, source, wording, consented_at, revoked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), CAFE_ID, customerId, status, marketing, input.source || actor, CONSENT_WORDING, status === 'OPT_IN' ? now : null, status === 'OPT_OUT' ? now : null, now],
    );
  }
  return consentFor(customerId);
}

function eligibleFor(category: CommCategory, customerId: string, mobile: string) {
  const phone = digits(mobile);
  if (!phone || !toWhatsAppNumber(phone)) return { ok: false, reason: 'Invalid phone number' };
  const consent = consentFor(customerId);
  if (consent.status === 'OPT_OUT') return { ok: false, reason: 'Opted out' };
  if (category === 'MARKETING') {
    if (consent.marketing_status !== 'OPT_IN') return { ok: false, reason: 'No marketing consent' };
  } else if (consent.status !== 'OPT_IN') {
    return { ok: false, reason: 'WhatsApp consent missing' };
  }
  return { ok: true, reason: '', phone };
}

type AudienceInput = {
  audience: string;
  memberIds?: string[];
  sport?: string;
  trainerId?: string;
  facilityId?: string;
};

function loadAudience(input: AudienceInput): MemberLite[] {
  const base = all<MemberLite>(
    `SELECT id, name, mobile, member_code, membership_status, membership_expires_at, created_at, plan_id, coach_id, IFNULL(access_interest,'') AS access_interest, IFNULL(email,'') AS email
     FROM customers WHERE cafe_id = ? AND (member_code != '' OR IFNULL(access_interest,'') != '')`,
    [CAFE_ID],
  );
  const now = Date.now();
  const days = (n: number) => now + n * 24 * 60 * 60 * 1000;
  const upcoming = new Set(
    all<{ customer_id: string }>(
      `SELECT DISTINCT customer_id FROM bookings WHERE cafe_id = ? AND status IN ('CONFIRMED','CHECKED_IN') AND start_at >= ? AND customer_id IS NOT NULL AND customer_id != ''`,
      [CAFE_ID, nowIso()],
    ).map((row) => row.customer_id),
  );
  const sportBooked = input.sport
    ? new Set(
      all<{ customer_id: string }>(
        `SELECT DISTINCT customer_id FROM bookings WHERE cafe_id = ? AND status IN ('CONFIRMED','CHECKED_IN') AND start_at >= ? AND sport = ? AND customer_id IS NOT NULL`,
        [CAFE_ID, nowIso(), input.sport],
      ).map((row) => row.customer_id),
    )
    : null;
  const maintenance = input.facilityId
    ? new Set(
      all<{ customer_id: string }>(
        `SELECT DISTINCT customer_id FROM bookings WHERE cafe_id = ? AND facility_id = ? AND status IN ('CONFIRMED','CHECKED_IN') AND start_at >= ? AND customer_id IS NOT NULL`,
        [CAFE_ID, input.facilityId, nowIso()],
      ).map((row) => row.customer_id),
    )
    : new Set(
      all<{ customer_id: string }>(
        `SELECT DISTINCT b.customer_id FROM bookings b JOIN facilities f ON f.id = b.facility_id
         WHERE b.cafe_id = ? AND f.maintenance_status = 'MAINTENANCE' AND b.status IN ('CONFIRMED','CHECKED_IN') AND b.start_at >= ? AND b.customer_id IS NOT NULL`,
        [CAFE_ID, nowIso()],
      ).map((row) => row.customer_id),
    );
  const selected = new Set(input.memberIds ?? []);
  return base.filter((row) => {
    const expires = row.membership_expires_at ? new Date(row.membership_expires_at).getTime() : 0;
    switch (input.audience) {
      case 'selected':
        return selected.has(row.id);
      case 'expiring7':
        return row.membership_status === 'ACTIVE' && expires > now && expires <= days(7);
      case 'expiring14':
        return row.membership_status === 'ACTIVE' && expires > now && expires <= days(14);
      case 'expiring30':
        return row.membership_status === 'ACTIVE' && expires > now && expires <= days(30);
      case 'booked':
        return upcoming.has(row.id);
      case 'sport':
        return Boolean(sportBooked?.has(row.id));
      case 'trainer':
        return input.trainerId ? row.coach_id === input.trainerId : Boolean(row.coach_id);
      case 'maintenance':
        return maintenance.has(row.id);
      case 'renewed_recent': {
        const recent = all<{ customer_id: string }>(
          `SELECT DISTINCT customer_id FROM memberships WHERE cafe_id = ? AND created_at >= ?`,
          [CAFE_ID, new Date(days(-30)).toISOString()],
        ).some((item) => item.customer_id === row.id);
        return recent;
      }
      case 'eligible':
      default:
        return row.membership_status === 'ACTIVE';
    }
  });
}

function varsFor(key: string, member: MemberLite, extra: Record<string, string> = {}) {
  const def = templateByKey(key);
  const bag: Record<string, string> = {
    name: member.name,
    membership_id: member.member_code || member.id.slice(0, 8),
    expiry_date: member.membership_expires_at ? kolkataYmd(member.membership_expires_at) : '—',
    new_expiry_date: extra.new_expiry_date || (member.membership_expires_at ? kolkataYmd(member.membership_expires_at) : '—'),
    amount: extra.amount || '—',
    transaction_id: extra.transaction_id || '—',
    payment_date: extra.payment_date || kolkataYmd(),
    membership_ref: extra.membership_ref || member.member_code || '—',
    booking_id: extra.booking_id || '—',
    facility: extra.facility || '—',
    sport: extra.sport || member.access_interest || '—',
    booking_date: extra.booking_date || '—',
    start_time: extra.start_time || '—',
    end_time: extra.end_time || '—',
    refund_status: extra.refund_status || '—',
    old_when: extra.old_when || '—',
    new_when: extra.new_when || '—',
    trainer_name: extra.trainer_name || '—',
    session_date: extra.session_date || '—',
    location: extra.location || '—',
    session_ref: extra.session_ref || '—',
    headline: extra.headline || '—',
    details: extra.details || '—',
    ...extra,
  };
  return (def?.variables ?? []).map((item) => bag[item.key] || '—');
}

function previewBody(key: string, member: MemberLite, extra: Record<string, string> = {}) {
  const def = templateByKey(key);
  if (!def) return '';
  const pairs = Object.fromEntries(def.variables.map((item, index) => [item.key, varsFor(key, member, extra)[index] || '—']));
  return fillTemplate(def.body, pairs);
}

export function commsOverview(from?: string, to?: string) {
  ensureSettings();
  const start = from ? `${from}T00:00:00+05:30` : '1970-01-01T00:00:00.000Z';
  const end = to ? `${to}T23:59:59.999+05:30` : '9999-12-31T23:59:59.999Z';
  const count = (sql: string, params: (string | number)[] = []) => get<{ n: number }>(sql, params)?.n ?? 0;
  const eligible = all<{ id: string; mobile: string }>(
    `SELECT c.id, c.mobile FROM customers c
     LEFT JOIN communication_consent cc ON cc.customer_id = c.id AND cc.cafe_id = c.cafe_id
     WHERE c.cafe_id = ? AND (c.member_code != '' OR IFNULL(c.access_interest,'') != '') AND IFNULL(cc.status,'UNKNOWN') = 'OPT_IN'`,
    [CAFE_ID],
  ).filter((row) => digits(row.mobile)).length;
  const sent = count(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE cafe_id = ? AND created_at >= ? AND created_at <= ? AND status IN ('ACCEPTED','SENT','DELIVERED','READ')`, [CAFE_ID, start, end]);
  const delivered = count(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE cafe_id = ? AND created_at >= ? AND created_at <= ? AND status IN ('DELIVERED','READ')`, [CAFE_ID, start, end]);
  const read = count(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE cafe_id = ? AND created_at >= ? AND created_at <= ? AND status = 'READ'`, [CAFE_ID, start, end]);
  const failed = count(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE cafe_id = ? AND created_at >= ? AND created_at <= ? AND status = 'FAILED'`, [CAFE_ID, start, end]);
  const pending = count(`SELECT COUNT(*) AS n FROM notification_queue WHERE cafe_id = ? AND status IN ('QUEUED','SENDING')`, [CAFE_ID]);
  const automations = count(`SELECT COUNT(*) AS n FROM whatsapp_campaigns WHERE cafe_id = ? AND kind = 'AUTOMATION' AND created_at >= ? AND created_at <= ?`, [CAFE_ID, start, end]);
  const manuals = count(`SELECT COUNT(*) AS n FROM whatsapp_campaigns WHERE cafe_id = ? AND kind = 'MANUAL' AND created_at >= ? AND created_at <= ?`, [CAFE_ID, start, end]);
  const unit = get<{ unit_cost_paise: number }>('SELECT unit_cost_paise FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID])?.unit_cost_paise ?? 0;
  const conversations = count(`SELECT COUNT(*) AS n FROM whatsapp_messages WHERE cafe_id = ? AND created_at >= ? AND created_at <= ? AND status IN ('ACCEPTED','SENT','DELIVERED','READ')`, [CAFE_ID, start, end]);
  return {
    eligible,
    sent,
    delivered,
    read,
    failed,
    pending,
    automations,
    manuals,
    estimatedSpendPaise: unit > 0 ? unit * conversations : 0,
    unitCostPaise: unit,
    configured: whatsappReady(),
    missing: whatsappMissing(),
    campaigns: all(
      `SELECT id, name, kind, template_key, category, status, recipient_count, excluded_count, created_at
       FROM whatsapp_campaigns WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 20`,
      [CAFE_ID],
    ),
    automationsRecent: all(
      `SELECT id, type, entity, entity_id, customer_id, created_at FROM notification_events WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 20`,
      [CAFE_ID],
    ),
    failures: all(
      `SELECT id, customer_id, to_mobile, template_key, status, error_message, created_at
       FROM whatsapp_messages WHERE cafe_id = ? AND status = 'FAILED' ORDER BY created_at DESC LIMIT 30`,
      [CAFE_ID],
    ),
    activity: all(
      `SELECT id, customer_id, to_mobile, template_key, status, created_at FROM whatsapp_messages WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 40`,
      [CAFE_ID],
    ),
  };
}

export function previewCampaign(input: {
  templateKey: string;
  category?: string;
  language?: string;
  audience: string;
  memberIds?: string[];
  sport?: string;
  trainerId?: string;
  facilityId?: string;
  extras?: Record<string, string>;
  all?: boolean;
}) {
  ensureSettings();
  const def = templateByKey(input.templateKey);
  if (!def) throw new AppError(400, 'TEMPLATE', 'Unknown template.');
  const category = (input.category as CommCategory) || def.category;
  const members = loadAudience(input);
  const included: { id: string; name: string; mobile: string; preview: string }[] = [];
  const excluded: { id: string; name: string; mobile: string; reason: string }[] = [];
  for (const member of members) {
    const check = eligibleFor(category, member.id, member.mobile);
    if (!check.ok) {
      excluded.push({ id: member.id, name: member.name, mobile: member.mobile, reason: check.reason });
      continue;
    }
    included.push({
      id: member.id,
      name: member.name,
      mobile: member.mobile,
      preview: previewBody(def.key, member, input.extras ?? {}),
    });
  }
  const unit = get<{ unit_cost_paise: number }>('SELECT unit_cost_paise FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID])?.unit_cost_paise ?? 0;
  const tpl = get<{ status: string; meta_name: string; category: string }>(
    'SELECT status, meta_name, category FROM whatsapp_templates WHERE cafe_id = ? AND key = ? AND language = ?',
    [CAFE_ID, def.key, input.language || 'en'],
  );
  const cap = input.all ? included.length : 200;
  return {
    template: { ...def, metaStatus: tpl?.status ?? 'NOT_SYNCED', metaName: tpl?.meta_name ?? def.metaName, metaCategory: tpl?.category ?? def.category },
    category,
    recipientCount: included.length,
    excludedCount: excluded.length,
    estimatedSpendPaise: unit * included.length,
    unitCostPaise: unit,
    configured: whatsappReady(),
    missing: whatsappMissing(),
    included: included.slice(0, cap),
    excluded: excluded.slice(0, cap),
    previews: included.slice(0, 5),
  };
}

function enqueueRow(input: {
  campaignId: string | null;
  customerId: string;
  mobile: string;
  templateKey: string;
  language: string;
  category: string;
  variables: string[];
  dedupeKey: string;
}) {
  const existing = get<{ id: string; status: string }>('SELECT id, status FROM notification_queue WHERE cafe_id = ? AND dedupe_key = ?', [CAFE_ID, input.dedupeKey]);
  if (existing && existing.status !== 'FAILED') return existing.id;
  const id = randomUUID();
  run(
    `INSERT INTO notification_queue (id, cafe_id, campaign_id, customer_id, to_mobile, template_key, language, category, variables_json, dedupe_key, status, attempts, next_attempt_at, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, '', ?)`,
    [id, CAFE_ID, input.campaignId, input.customerId, input.mobile, input.templateKey, input.language, input.category, JSON.stringify(input.variables), input.dedupeKey, nowIso(), nowIso()],
  );
  run(
    `INSERT INTO whatsapp_messages (id, cafe_id, campaign_id, queue_id, customer_id, to_mobile, template_key, category, language, wa_message_id, status, error_code, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'QUEUED', '', '', ?, ?)`,
    [id, CAFE_ID, input.campaignId, id, input.customerId, input.mobile, input.templateKey, input.category, input.language, nowIso(), nowIso()],
  );
  return id;
}

export function createCampaign(input: {
  name: string;
  templateKey: string;
  category?: string;
  language?: string;
  audience: string;
  memberIds?: string[];
  sport?: string;
  trainerId?: string;
  facilityId?: string;
  extras?: Record<string, string>;
  confirm: boolean;
  actor: string;
  kind?: 'MANUAL' | 'AUTOMATION' | 'TEST';
}) {
  if (!input.confirm) throw new AppError(400, 'CONFIRM', 'Confirm before sending.');
  const preview = previewCampaign({ ...input, all: true });
  if (preview.template.metaStatus !== 'APPROVED' && whatsappReady()) {
    throw new AppError(409, 'TEMPLATE', `Meta has not approved ${preview.template.metaName}. Sync templates and use an approved name.`);
  }
  const campaignId = randomUUID();
  const language = input.language || 'en';
  tx(() => {
    run(
      `INSERT INTO whatsapp_campaigns (id, cafe_id, name, kind, template_key, category, language, audience, actor, status, recipient_count, excluded_count, created_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, NULL)`,
      [campaignId, CAFE_ID, input.name.trim() || preview.template.label, input.kind || 'MANUAL', preview.template.key, preview.category, language, input.audience, input.actor, preview.recipientCount, preview.excludedCount, nowIso()],
    );
    for (const row of preview.included) {
      const member = memberRow(row.id);
      if (!member) continue;
      const variables = varsFor(preview.template.key, member, input.extras ?? {});
      const queueId = enqueueRow({
        campaignId,
        customerId: row.id,
        mobile: row.mobile,
        templateKey: preview.template.key,
        language,
        category: preview.category,
        variables,
        dedupeKey: `${input.kind || 'MANUAL'}:${campaignId}:${row.id}`,
      });
      run(
        `INSERT INTO whatsapp_recipients (id, campaign_id, customer_id, mobile, name, status, excluded_reason, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'QUEUED', '', ?, ?)`,
        [randomUUID(), campaignId, row.id, row.mobile, row.name, queueId, nowIso()],
      );
    }
    for (const row of preview.excluded) {
      run(
        `INSERT INTO whatsapp_recipients (id, campaign_id, customer_id, mobile, name, status, excluded_reason, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'SKIPPED', ?, '', ?)`,
        [randomUUID(), campaignId, row.id, row.mobile, row.name, row.reason, nowIso()],
      );
    }
  });
  kickQueue();
  return { campaignId, ...preview };
}

export function sendTestMessage(templateKey: string, actor: string) {
  ensureSettings();
  const settings = get<{ test_number: string }>('SELECT test_number FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID]);
  const mobile = digits(settings?.test_number || '');
  if (!mobile) throw new AppError(400, 'TEST', 'Save an authorized test number in WhatsApp settings first.');
  const def = templateByKey(templateKey);
  if (!def) throw new AppError(400, 'TEMPLATE', 'Unknown template.');
  const sample: MemberLite = {
    id: 'test',
    name: 'Test member',
    mobile,
    member_code: 'GK0000',
    membership_status: 'ACTIVE',
    membership_expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    created_at: nowIso(),
    plan_id: null,
    coach_id: null,
    access_interest: 'Badminton',
    email: '',
  };
  const campaignId = randomUUID();
  run(
    `INSERT INTO whatsapp_campaigns (id, cafe_id, name, kind, template_key, category, language, audience, actor, status, recipient_count, excluded_count, created_at, cancelled_at)
     VALUES (?, ?, ?, 'TEST', ?, ?, 'en', 'test', ?, 'QUEUED', 1, 0, ?, NULL)`,
    [campaignId, CAFE_ID, `Test · ${def.label}`, def.key, def.category, actor, nowIso()],
  );
  enqueueRow({
    campaignId,
    customerId: '',
    mobile,
    templateKey: def.key,
    language: 'en',
    category: def.category,
    variables: varsFor(def.key, sample, { headline: 'Test', details: 'Authorized test send from Gymkhana POS.' }),
    dedupeKey: `TEST:${campaignId}:${mobile}:${Date.now()}`,
  });
  kickQueue();
  return { ok: true, to: mobile, template: def.key };
}

export function cancelCampaign(id: string, actor: string) {
  const row = get<{ status: string }>('SELECT status FROM whatsapp_campaigns WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
  if (!row) throw new AppError(404, 'CAMPAIGN', 'Campaign not found.');
  run(`UPDATE whatsapp_campaigns SET status = 'CANCELLED', cancelled_at = ? WHERE id = ?`, [nowIso(), id]);
  run(`UPDATE notification_queue SET status = 'SKIPPED', last_error = ? WHERE campaign_id = ? AND status IN ('QUEUED','SENDING')`, [`Cancelled by ${actor}`, id]);
  run(`UPDATE whatsapp_messages SET status = 'SKIPPED', error_message = 'Cancelled', updated_at = ? WHERE campaign_id = ? AND status = 'QUEUED'`, [nowIso(), id]);
  return { ok: true };
}

export function listCampaigns() {
  return all(
    `SELECT id, name, kind, template_key, category, audience, actor, status, recipient_count, excluded_count, created_at, cancelled_at
     FROM whatsapp_campaigns WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 100`,
    [CAFE_ID],
  );
}

export function campaignReport(id: string) {
  const campaign = get('SELECT * FROM whatsapp_campaigns WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
  if (!campaign) throw new AppError(404, 'CAMPAIGN', 'Campaign not found.');
  const recipients = all('SELECT * FROM whatsapp_recipients WHERE campaign_id = ? ORDER BY created_at', [id]);
  const messages = all('SELECT * FROM whatsapp_messages WHERE campaign_id = ? ORDER BY created_at', [id]);
  const counts = {
    queued: messages.filter((row) => (row as { status: string }).status === 'QUEUED').length,
    accepted: messages.filter((row) => ['ACCEPTED', 'SENT'].includes((row as { status: string }).status)).length,
    delivered: messages.filter((row) => ['DELIVERED', 'READ'].includes((row as { status: string }).status)).length,
    read: messages.filter((row) => (row as { status: string }).status === 'READ').length,
    failed: messages.filter((row) => (row as { status: string }).status === 'FAILED').length,
    skipped: messages.filter((row) => (row as { status: string }).status === 'SKIPPED').length,
  };
  return { campaign, recipients, messages, counts };
}

export function messageHistory(customerId?: string) {
  if (customerId) {
    return all(
      `SELECT id, template_key, category, status, error_message, created_at, wa_message_id FROM whatsapp_messages WHERE cafe_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 100`,
      [CAFE_ID, customerId],
    );
  }
  return all(
    `SELECT id, customer_id, to_mobile, template_key, category, status, error_message, created_at FROM whatsapp_messages WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 200`,
    [CAFE_ID],
  );
}

export function listLocalTemplates() {
  ensureSettings();
  return all(
    `SELECT id, key, meta_name, language, category, status, body, variables_json, synced_at FROM whatsapp_templates WHERE cafe_id = ? ORDER BY key`,
    [CAFE_ID],
  ).map((row) => {
    const def = templateByKey(String((row as { key: string }).key));
    return { ...row, label: def?.label ?? (row as { key: string }).key, localBody: def?.body ?? (row as { body: string }).body };
  });
}

export async function syncTemplates() {
  ensureSettings();
  const remote = await fetchWhatsAppTemplates();
  const now = nowIso();
  for (const def of COMM_TEMPLATES) {
    const match = remote.find((item) => item.name === def.metaName);
    const status = match ? String(match.status || 'PENDING').toUpperCase() : 'NOT_SYNCED';
    const category = match ? String(match.category || def.category).toUpperCase() : def.category;
    const language = match?.language || 'en';
    const body = match?.components?.find((item) => item.type === 'BODY')?.text || def.body;
    run(
      `UPDATE whatsapp_templates SET meta_name = ?, language = ?, category = ?, status = ?, body = ?, synced_at = ? WHERE cafe_id = ? AND key = ?`,
      [def.metaName, language, category, status, body, now, CAFE_ID, def.key],
    );
  }
  return listLocalTemplates();
}

export function getSettingsPublic() {
  ensureSettings();
  const row = get<{
    phone_number_id: string;
    waba_id: string;
    graph_version: string;
    webhook_verify_token: string;
    test_number: string;
    unit_cost_paise: number;
    booking_reminder_hours: number;
    updated_at: string;
  }>('SELECT phone_number_id, waba_id, graph_version, webhook_verify_token, test_number, unit_cost_paise, booking_reminder_hours, updated_at FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID]);
  const missing = whatsappMissing();
  return {
    phoneNumberId: row?.phone_number_id || env.whatsappPhoneNumberId,
    wabaId: row?.waba_id || env.whatsappWabaId,
    graphVersion: row?.graph_version || env.whatsappGraphVersion,
    webhookPath: WHATSAPP_WEBHOOK_PATH,
    webhookVerifyToken: env.whatsappVerifyToken || row?.webhook_verify_token || DEFAULT_VERIFY_TOKEN,
    webhookVerifyTokenSet: Boolean(env.whatsappVerifyToken || row?.webhook_verify_token || DEFAULT_VERIFY_TOKEN),
    testNumber: row?.test_number || '',
    unitCostPaise: row?.unit_cost_paise ?? 0,
    bookingReminderHours: row?.booking_reminder_hours ?? 24,
    hasAccessToken: Boolean(env.whatsappAccessToken),
    hasAppSecret: Boolean(env.whatsappAppSecret),
    configured: missing.length === 0,
    missing,
    updatedAt: row?.updated_at ?? null,
    consentWording: CONSENT_WORDING,
  };
}

export function saveSettings(input: {
  phoneNumberId?: string;
  wabaId?: string;
  graphVersion?: string;
  webhookVerifyToken?: string;
  testNumber?: string;
  unitCostPaise?: number;
  bookingReminderHours?: number;
}) {
  ensureSettings();
  const current = getSettingsPublic();
  const stored = get<{ webhook_verify_token: string }>('SELECT webhook_verify_token FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID]);
  run(
    `UPDATE whatsapp_settings SET phone_number_id = ?, waba_id = ?, graph_version = ?, webhook_verify_token = ?, test_number = ?, unit_cost_paise = ?, booking_reminder_hours = ?, updated_at = ? WHERE cafe_id = ?`,
    [
      (input.phoneNumberId ?? current.phoneNumberId).trim(),
      (input.wabaId ?? current.wabaId).trim(),
      (input.graphVersion ?? current.graphVersion).trim() || 'v21.0',
      input.webhookVerifyToken !== undefined ? input.webhookVerifyToken.trim() : (stored?.webhook_verify_token ?? ''),
      digits(input.testNumber ?? current.testNumber),
      Math.max(0, Math.round(input.unitCostPaise ?? current.unitCostPaise)),
      Math.min(168, Math.max(1, Math.round(input.bookingReminderHours ?? current.bookingReminderHours))),
      nowIso(),
      CAFE_ID,
    ],
  );
  return getSettingsPublic();
}

export function emitGymEvent(type: string, input: {
  entity?: string;
  entityId?: string;
  customerId?: string;
  extra?: Record<string, string>;
}) {
  ensureSettings();
  const eventId = randomUUID();
  if (input.customerId && input.entityId) {
    const already = get<{ id: string }>(
      'SELECT id FROM notification_queue WHERE cafe_id = ? AND dedupe_key = ?',
      [CAFE_ID, `${type}:${input.entityId}:${input.customerId}`],
    );
    if (already) return already.id;
  }
  run(
    `INSERT INTO notification_events (id, cafe_id, type, entity, entity_id, customer_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId, CAFE_ID, type, input.entity ?? '', input.entityId ?? '', input.customerId ?? '', JSON.stringify(input.extra ?? {}), nowIso()],
  );
  if (!input.customerId) return eventId;
  const member = memberRow(input.customerId);
  if (!member) return eventId;
  const def = templateByEvent(type);
  if (!def) return eventId;
  const dedupeKey = `${type}:${input.entityId || eventId}:${member.id}`;
  const check = eligibleFor(def.category, member.id, member.mobile);
  if (!check.ok) return eventId;
  const campaignId = randomUUID();
  run(
    `INSERT INTO whatsapp_campaigns (id, cafe_id, name, kind, template_key, category, language, audience, actor, status, recipient_count, excluded_count, created_at, cancelled_at)
     VALUES (?, ?, ?, 'AUTOMATION', ?, ?, 'en', ?, 'system', 'QUEUED', 1, 0, ?, NULL)`,
    [campaignId, CAFE_ID, def.label, def.key, def.category, type, nowIso()],
  );
  enqueueRow({
    campaignId,
    customerId: member.id,
    mobile: member.mobile,
    templateKey: def.key,
    language: 'en',
    category: def.category,
    variables: varsFor(def.key, member, input.extra ?? {}),
    dedupeKey,
  });
  kickQueue();
  return eventId;
}

export function emitToMembers(type: string, customerIds: string[], extra: Record<string, string> = {}, entityId = '') {
  for (const id of customerIds) emitGymEvent(type, { entity: extra.facility || '', entityId: entityId || id, customerId: id, extra });
}

function kickQueue() {
  if (env.nodeEnv === 'test') return;
  void processQueue();
}

let processing = false;

export async function processQueue(limit = 8) {
  if (processing) return { processed: 0 };
  processing = true;
  let processed = 0;
  try {
    ensureSettings();
    const rows = all<{
      id: string;
      campaign_id: string | null;
      customer_id: string;
      to_mobile: string;
      template_key: string;
      language: string;
      variables_json: string;
      attempts: number;
    }>(
      `SELECT id, campaign_id, customer_id, to_mobile, template_key, language, variables_json, attempts
       FROM notification_queue WHERE cafe_id = ? AND status IN ('QUEUED','SENDING') AND next_attempt_at <= ? ORDER BY created_at LIMIT ?`,
      [CAFE_ID, nowIso(), limit],
    );
    for (const row of rows) {
      const cancelled = row.campaign_id
        ? get<{ status: string }>('SELECT status FROM whatsapp_campaigns WHERE id = ?', [row.campaign_id])
        : null;
      if (cancelled?.status === 'CANCELLED') {
        run(`UPDATE notification_queue SET status = 'SKIPPED', last_error = 'Cancelled' WHERE id = ?`, [row.id]);
        run(`UPDATE whatsapp_messages SET status = 'SKIPPED', updated_at = ? WHERE queue_id = ?`, [nowIso(), row.id]);
        continue;
      }
      const def = templateByKey(row.template_key);
      const tpl = get<{ meta_name: string; status: string }>(
        'SELECT meta_name, status FROM whatsapp_templates WHERE cafe_id = ? AND key = ?',
        [CAFE_ID, row.template_key],
      );
      run(`UPDATE notification_queue SET status = 'SENDING', attempts = attempts + 1 WHERE id = ?`, [row.id]);
      const parameters = JSON.parse(row.variables_json || '[]') as string[];
      const result = await sendWhatsAppTemplate({
        to: row.to_mobile,
        templateName: tpl?.meta_name || def?.metaName || row.template_key,
        language: row.language,
        parameters,
      });
      processed += 1;
      if (result.ok) {
        run(`UPDATE notification_queue SET status = 'ACCEPTED', last_error = '' WHERE id = ?`, [row.id]);
        run(
          `UPDATE whatsapp_messages SET status = 'ACCEPTED', wa_message_id = ?, updated_at = ? WHERE queue_id = ?`,
          [result.messageId, nowIso(), row.id],
        );
        if (row.campaign_id) {
          run(`UPDATE whatsapp_recipients SET status = 'ACCEPTED', message_id = ? WHERE campaign_id = ? AND customer_id = ?`, [result.messageId, row.campaign_id, row.customer_id]);
          run(`UPDATE whatsapp_campaigns SET status = 'SENDING' WHERE id = ? AND status = 'QUEUED'`, [row.campaign_id]);
        }
        continue;
      }
      const attempts = row.attempts + 1;
      const permanent = result.permanent || attempts >= 5;
      const wait = result.retryAfterMs ?? Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempts - 1)));
      if (permanent) {
        run(`UPDATE notification_queue SET status = 'FAILED', last_error = ? WHERE id = ?`, [result.error, row.id]);
        run(
          `UPDATE whatsapp_messages SET status = 'FAILED', error_code = ?, error_message = ?, updated_at = ? WHERE queue_id = ?`,
          [String(result.status), result.error, nowIso(), row.id],
        );
        if (row.campaign_id) run(`UPDATE whatsapp_recipients SET status = 'FAILED' WHERE campaign_id = ? AND customer_id = ?`, [row.campaign_id, row.customer_id]);
      } else {
        run(
          `UPDATE notification_queue SET status = 'QUEUED', next_attempt_at = ?, last_error = ? WHERE id = ?`,
          [new Date(Date.now() + wait).toISOString(), result.error, row.id],
        );
      }
    }
  } finally {
    processing = false;
  }
  return { processed };
}

export function applyWebhook(body: unknown, raw: Buffer | string, signature: string | undefined) {
  if (env.whatsappAppSecret && !verifyWhatsAppSignature(raw, signature)) {
    throw new AppError(401, 'WEBHOOK', 'Invalid WhatsApp signature.');
  }
  const updates = parseWhatsAppWebhook(body);
  run(
    `INSERT INTO whatsapp_webhook_events (id, cafe_id, wa_message_id, payload_json, received_at) VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), CAFE_ID, updates[0]?.waMessageId ?? '', JSON.stringify(body).slice(0, 20_000), nowIso()],
  );
  for (const update of updates) {
    if (!update.waMessageId) continue;
    const mapped = update.status === 'sent' ? 'SENT' : update.status === 'delivered' ? 'DELIVERED' : update.status === 'read' ? 'READ' : 'FAILED';
    const current = get<{ status: string }>('SELECT status FROM whatsapp_messages WHERE wa_message_id = ?', [update.waMessageId]);
    if (!current) continue;
    const rank = { QUEUED: 0, ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5, SKIPPED: 5 };
    const nextRank = rank[mapped as keyof typeof rank] ?? 0;
    const prevRank = rank[current.status as keyof typeof rank] ?? 0;
    if (mapped !== 'FAILED' && nextRank < prevRank) continue;
    run(
      `UPDATE whatsapp_messages SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE wa_message_id = ?`,
      [mapped, update.errorCode, update.errorMessage, nowIso(), update.waMessageId],
    );
  }
  return { ok: true, updates: updates.length };
}

export function webhookChallenge(mode: string, token: string, challenge: string) {
  return verifyWhatsAppWebhookToken(mode, token, challenge);
}

export function lastMessageByCustomer() {
  const rows = all<{ customer_id: string; created_at: string; status: string }>(
    `SELECT customer_id, created_at, status FROM whatsapp_messages WHERE cafe_id = ? AND customer_id != '' ORDER BY created_at DESC`,
    [CAFE_ID],
  );
  const map = new Map<string, { lastWhatsAppAt: string; lastWhatsAppStatus: string }>();
  for (const row of rows) {
    if (map.has(row.customer_id)) continue;
    map.set(row.customer_id, { lastWhatsAppAt: row.created_at, lastWhatsAppStatus: row.status });
  }
  return map;
}

export function consentMap() {
  const rows = all<{ customer_id: string; status: string }>(
    'SELECT customer_id, status FROM communication_consent WHERE cafe_id = ?',
    [CAFE_ID],
  );
  return new Map(rows.map((row) => [row.customer_id, row.status]));
}

export function runDueJobs() {
  ensureSettings();
  const hours = get<{ booking_reminder_hours: number }>('SELECT booking_reminder_hours FROM whatsapp_settings WHERE cafe_id = ?', [CAFE_ID])?.booking_reminder_hours ?? 24;
  const today = kolkataYmd();
  const in14 = kolkataYmd(new Date(Date.now() + 14 * 86400000));
  const expiring = all<MemberLite & { membership_id: string }>(
    `SELECT c.id, c.name, c.mobile, c.member_code, c.membership_status, c.membership_expires_at, c.created_at, c.plan_id, c.coach_id, IFNULL(c.access_interest,'') AS access_interest, IFNULL(c.email,'') AS email, m.id AS membership_id
     FROM customers c JOIN memberships m ON m.customer_id = c.id
     WHERE c.cafe_id = ? AND m.status = 'ACTIVE' AND c.membership_status = 'ACTIVE' AND m.expires_at IS NOT NULL`,
    [CAFE_ID],
  );
  for (const member of expiring) {
    const day = member.membership_expires_at ? kolkataYmd(member.membership_expires_at) : '';
    if (day === in14) {
      emitGymEvent('MEMBERSHIP_EXPIRY_14D', {
        entity: 'membership',
        entityId: member.membership_id,
        customerId: member.id,
        extra: { expiry_date: day, membership_id: member.member_code },
      });
    }
    if (day && day < today) {
      emitGymEvent('MEMBERSHIP_EXPIRED', {
        entity: 'membership',
        entityId: member.membership_id,
        customerId: member.id,
        extra: { membership_id: member.member_code },
      });
    }
  }
  const from = new Date(Date.now() + (hours - 0.5) * 3600000).toISOString();
  const to = new Date(Date.now() + (hours + 0.5) * 3600000).toISOString();
  const bookings = all<{
    id: string;
    customer_id: string;
    member_name: string;
    facility: string;
    start_at: string;
  }>(
    `SELECT b.id, b.customer_id, b.member_name, f.name AS facility, b.start_at
     FROM bookings b JOIN facilities f ON f.id = b.facility_id
     WHERE b.cafe_id = ? AND b.status = 'CONFIRMED' AND b.customer_id IS NOT NULL AND b.customer_id != '' AND b.start_at >= ? AND b.start_at < ?`,
    [CAFE_ID, from, to],
  );
  for (const booking of bookings) {
    emitGymEvent('BOOKING_REMINDER', {
      entity: 'booking',
      entityId: booking.id,
      customerId: booking.customer_id,
      extra: {
        facility: booking.facility,
        booking_date: kolkataYmd(booking.start_at),
        start_time: kolkataTime(booking.start_at),
      },
    });
  }
  return { ok: true, date: today };
}

let worker: ReturnType<typeof setInterval> | null = null;

export function startCommsWorker() {
  if (worker || env.nodeEnv === 'test') return;
  void processQueue();
  void runDueJobs();
  worker = setInterval(() => { void processQueue(); }, 5000);
  setInterval(() => { void runDueJobs(); }, 15 * 60 * 1000);
}

export function memberMatchesFilter(
  member: {
    id: string;
    membershipStatus: string;
    expiresAt: string | null;
    registeredAt?: string;
    coachId?: string;
    mobile: string;
    consentStatus?: string;
    hasUpcoming?: boolean;
  },
  filter: string,
) {
  const now = Date.now();
  const expires = member.expiresAt ? new Date(member.expiresAt).getTime() : 0;
  const consent = member.consentStatus || 'UNKNOWN';
  const phone = digits(member.mobile);
  switch (filter) {
    case 'expired':
      return member.membershipStatus !== 'ACTIVE' || (expires > 0 && expires < now);
    case 'expiring7':
      return member.membershipStatus === 'ACTIVE' && expires > now && expires <= now + 7 * 86400000;
    case 'expiring14':
    case 'expiring':
      return member.membershipStatus === 'ACTIVE' && expires > now && expires <= now + 14 * 86400000;
    case 'expiring30':
      return member.membershipStatus === 'ACTIVE' && expires > now && expires <= now + 30 * 86400000;
    case 'registered_recent':
      return Boolean(member.registeredAt && new Date(member.registeredAt).getTime() >= now - 14 * 86400000);
    case 'renewed_recent':
      return member.membershipStatus === 'ACTIVE' && Boolean(member.registeredAt && new Date(member.registeredAt).getTime() >= now - 30 * 86400000);
    case 'upcoming_bookings':
      return Boolean(member.hasUpcoming);
    case 'no_upcoming':
      return !member.hasUpcoming;
    case 'with_trainer':
      return Boolean(member.coachId);
    case 'no_trainer':
      return !member.coachId;
    case 'wa_opted_in':
      return consent === 'OPT_IN';
    case 'wa_unknown':
      return consent === 'UNKNOWN';
    case 'wa_opted_out':
      return consent === 'OPT_OUT';
    case 'invalid_phone':
      return !phone;
    default:
      return true;
  }
}

export { rupees, kolkataYmd, kolkataTime, digits as commDigits };

export function registerCommsRoutes(
  app: import('express').Express,
  deps: {
    allow: (...roles: string[]) => import('express').RequestHandler;
    allowAdmin: () => import('express').RequestHandler;
    wrap: (fn: (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown) => import('express').RequestHandler;
    actor: (req: import('express').Request) => { name: string; role: string };
  },
) {
  const { allow, allowAdmin, wrap, actor } = deps;
  const staff = allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER');
  app.get('/api/gym/communications/overview', staff, wrap((req, res) => {
    kickQueue();
    res.json(commsOverview(String(req.query.from ?? ''), String(req.query.to ?? '') || undefined));
  }));
  app.get('/api/gym/communications/templates', staff, wrap((_req, res) => {
    res.json({ templates: listLocalTemplates(), catalog: COMM_TEMPLATES });
  }));
  app.post('/api/gym/communications/templates/sync', allow('MANAGER'), wrap(async (_req, res) => {
    res.json({ templates: await syncTemplates() });
  }));
  app.post('/api/gym/communications/preview', staff, wrap((req, res) => {
    res.json(previewCampaign(req.body));
  }));
  app.post('/api/gym/communications/campaigns', allow('RECEPTIONIST', 'CASHIER', 'COACH'), wrap((req, res) => {
    const role = actor(req).role;
    const def = templateByKey(String(req.body?.templateKey ?? ''));
    if (role === 'CASHIER' && def && !def.key.startsWith('payment') && def.key !== 'membership_renewed' && def.key !== 'membership_welcome') {
      throw new AppError(403, 'FORBIDDEN', 'Cashiers can send payment and membership receipts only.');
    }
    if (role === 'COACH' && def && !def.key.startsWith('session') && def.key !== 'trainer_assigned') {
      throw new AppError(403, 'FORBIDDEN', 'Trainers can send coaching messages only.');
    }
    res.json(createCampaign({ ...req.body, actor: actor(req).name, confirm: Boolean(req.body?.confirm) }));
  }));
  app.get('/api/gym/communications/campaigns', staff, wrap((_req, res) => {
    res.json({ campaigns: listCampaigns() });
  }));
  app.get('/api/gym/communications/campaigns/:id', staff, wrap((req, res) => {
    res.json(campaignReport(String(req.params.id)));
  }));
  app.post('/api/gym/communications/campaigns/:id/cancel', allow('MANAGER'), wrap((req, res) => {
    res.json(cancelCampaign(String(req.params.id), actor(req).name));
  }));
  app.get('/api/gym/communications/messages', staff, wrap((req, res) => {
    res.json({ messages: messageHistory(req.query.customerId ? String(req.query.customerId) : undefined) });
  }));
  app.post('/api/gym/communications/test', allowAdmin(), wrap((req, res) => {
    res.json(sendTestMessage(String(req.body?.templateKey ?? 'announcement'), actor(req).name));
  }));
  app.get('/api/gym/communications/settings', allowAdmin(), wrap((_req, res) => {
    res.json(getSettingsPublic());
  }));
  app.post('/api/gym/communications/settings', allowAdmin(), wrap((req, res) => {
    res.json(saveSettings(req.body ?? {}));
  }));
  app.post('/api/gym/members/:id/consent', allow('RECEPTIONIST', 'MANAGER'), wrap((req, res) => {
    res.json({ consent: setConsent(String(req.params.id), { status: String(req.body?.status ?? 'UNKNOWN'), marketingStatus: req.body?.marketingStatus, source: actor(req).name }, actor(req).name) });
  }));
  app.get('/api/gym/members/:id/messages', staff, wrap((req, res) => {
    res.json({ messages: messageHistory(String(req.params.id)), consent: consentFor(String(req.params.id)) });
  }));
  app.post('/api/gym/communications/tick', allow('MANAGER'), wrap(async (_req, res) => {
    const jobs = runDueJobs();
    const queue = await processQueue(20);
    res.json({ jobs, queue });
  }));
  app.get('/api/webhooks/whatsapp', wrap((req, res) => {
    const challenge = webhookChallenge(String(req.query['hub.mode'] ?? ''), String(req.query['hub.verify_token'] ?? ''), String(req.query['hub.challenge'] ?? ''));
    if (challenge == null) {
      res.status(403).type('text/plain').send('Forbidden');
      return;
    }
    res.status(200).type('text/plain').send(challenge);
  }));
  app.post('/api/webhooks/whatsapp', wrap((req, res) => {
    const raw = (req as { rawBody?: Buffer }).rawBody || Buffer.from(JSON.stringify(req.body ?? {}));
    res.json(applyWebhook(req.body, raw, req.header('x-hub-signature-256')));
  }));
}
