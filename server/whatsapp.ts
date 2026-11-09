import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env';
import { get } from './db';
import { CAFE_ID } from './ids';

export type WhatsAppSendResult =
  | { ok: true; messageId: string }
  | { ok: false; permanent: boolean; status: number; error: string; retryAfterMs?: number };

type SettingsRow = {
  phone_number_id: string;
  waba_id: string;
  graph_version: string;
  webhook_verify_token: string;
};

function settings() {
  return get<SettingsRow>(
    'SELECT phone_number_id, waba_id, graph_version, webhook_verify_token FROM whatsapp_settings WHERE cafe_id = ?',
    [CAFE_ID],
  );
}

export function whatsappMissing(): string[] {
  const row = settings();
  const missing: string[] = [];
  if (!env.whatsappAccessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!(env.whatsappPhoneNumberId || row?.phone_number_id)) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!(env.whatsappWabaId || row?.waba_id)) missing.push('WHATSAPP_WABA_ID');
  if (!env.whatsappAppSecret) missing.push('WHATSAPP_APP_SECRET');
  if (!(env.whatsappVerifyToken || row?.webhook_verify_token)) missing.push('WHATSAPP_VERIFY_TOKEN');
  return missing;
}

export function whatsappReady() {
  return whatsappMissing().length === 0;
}

function graphBase() {
  const row = settings();
  const version = (row?.graph_version || env.whatsappGraphVersion || 'v21.0').replace(/^\/*/, '');
  return `https://graph.facebook.com/${version}`;
}

function phoneNumberId() {
  return env.whatsappPhoneNumberId || settings()?.phone_number_id || '';
}

function wabaId() {
  return env.whatsappWabaId || settings()?.waba_id || '';
}

function verifyToken() {
  return env.whatsappVerifyToken || settings()?.webhook_verify_token || '';
}

export function toWhatsAppNumber(mobile: string) {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length > 10) return digits;
  return '';
}

export async function sendWhatsAppTemplate(input: {
  to: string;
  templateName: string;
  language: string;
  parameters: string[];
}): Promise<WhatsAppSendResult> {
  const missing = whatsappMissing();
  if (missing.length) {
    return { ok: false, permanent: true, status: 0, error: `WhatsApp is not configured (${missing.join(', ')}).` };
  }
  const to = toWhatsAppNumber(input.to);
  if (!to) return { ok: false, permanent: true, status: 0, error: 'Invalid phone number.' };
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.language || 'en' },
      components: input.parameters.length
        ? [{ type: 'body', parameters: input.parameters.map((text) => ({ type: 'text', text: text || '-' })) }]
        : [],
    },
  };
  const response = await fetch(`${graphBase()}/${phoneNumberId()}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsappAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  };
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const permanent = response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404;
    return {
      ok: false,
      permanent,
      status: response.status,
      error: payload.error?.message || `WhatsApp API ${response.status}`,
      retryAfterMs: response.status === 429 ? Math.max(1, retryAfter) * 1000 : undefined,
    };
  }
  const messageId = payload.messages?.[0]?.id || '';
  if (!messageId) return { ok: false, permanent: false, status: response.status, error: 'WhatsApp accepted the request without a message id.' };
  return { ok: true, messageId };
}

export async function fetchWhatsAppTemplates() {
  const missing = whatsappMissing();
  if (missing.length) {
    throw new Error(`WhatsApp is not configured (${missing.join(', ')}).`);
  }
  const url = `${graphBase()}/${wabaId()}/message_templates?limit=200`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.whatsappAccessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as {
    data?: { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] }[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `WhatsApp API ${response.status}`);
  return payload.data ?? [];
}

export function verifyWhatsAppWebhookToken(mode: string, token: string, challenge: string) {
  if (mode !== 'subscribe') return null;
  if (!token || token !== verifyToken()) return null;
  return challenge;
}

export function verifyWhatsAppSignature(rawBody: Buffer | string, header: string | undefined) {
  if (!env.whatsappAppSecret) return false;
  const expected = 'sha256=' + createHmac('sha256', env.whatsappAppSecret).update(rawBody).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(header || '');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type WhatsAppStatusUpdate = {
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string;
  errorMessage: string;
};

export function parseWhatsAppWebhook(body: unknown): WhatsAppStatusUpdate[] {
  const root = body as {
    entry?: { changes?: { value?: { statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string }[] }[] } }[] }[];
  };
  const out: WhatsAppStatusUpdate[] = [];
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        const raw = String(status.status || '').toLowerCase();
        if (raw !== 'sent' && raw !== 'delivered' && raw !== 'read' && raw !== 'failed') continue;
        const err = status.errors?.[0];
        out.push({
          waMessageId: String(status.id || ''),
          status: raw,
          errorCode: err?.code != null ? String(err.code) : '',
          errorMessage: err?.title || '',
        });
      }
    }
  }
  return out;
}
