import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { AppError } from './appError';
import { hashPassword, verifyPassword } from './auth';
import { env, exposeDevOtp, isProduction, razorpayEnabled } from './env';
import { CAFE_ID } from './ids';
import { all, get, run, tx } from './db';
import { createStaffOrder, loadCatalog, markPaid, retimeOrder } from './logic';
import { priceCart } from '../shared/domain';
import { createRazorpayOrder, publicRazorpayKey, RazorpayError, verifyRazorpayPayment } from './razorpay';
import { ARENA_SPORTS, arenaSlug, listedArenas, matchActivity, matchArena, SIGNUP_ACTIVITIES, sportFromSlug } from '../shared/activities';
import { GOVT_ID_TYPES, normalizeGovtId } from '../shared/govtId';
import { normalizeSlots, slotLabel, slotsBetween, summarizeSlots } from '../shared/slots';
import { TASK_CATEGORIES, TASK_PRIORITIES } from '../shared/maintenance';
import * as comms from './comms';

export const STAFF_ROLES = [
  'SUPER_ADMIN',
  'MANAGER',
  'RECEPTIONIST',
  'CASHIER',
  'COACH',
  'FACILITY_MANAGER',
  'INVENTORY_MANAGER',
] as const;

const OPEN_BOOKING = ['CONFIRMED', 'CHECKED_IN'];
const BOOKING_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;

type Actor = { id: string; name: string; role: string };

function nowIso() {
  return new Date().toISOString();
}

function audit(actor: string, action: string, entity: string, entityId: string, message: string) {
  run(
    'INSERT INTO audit_logs (id, cafe_id, actor, action, entity, entity_id, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), CAFE_ID, actor, action, entity, entityId, message, nowIso()],
  );
}

function notify(audience: string, title: string, body: string) {
  run(
    'INSERT INTO notifications (id, cafe_id, audience, title, body, read_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    [randomUUID(), CAFE_ID, audience, title, body, nowIso()],
  );
}

function sign(body: string) {
  return createHmac('sha256', env.sessionSecret).update(body).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const MEMBER_MAX_AGE_SEC = 400 * 24 * 60 * 60;

export function memberPass(customerId: string) {
  const exp = Date.now() + MEMBER_MAX_AGE_SEC * 1000;
  const body = `m1.${customerId}.${exp}`;
  return `${body}.${sign(body)}`;
}

export function memberCookie(customerId: string, pass = memberPass(customerId)) {
  const secure = isProduction() ? '; Secure' : '';
  return `gym_member=${encodeURIComponent(pass)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MEMBER_MAX_AGE_SEC}${secure}`;
}

export function readMemberPass(token: string | undefined | null) {
  if (!token) return null;
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'm1') return null;
  const [, customerId, expStr, sig] = parts;
  const body = `m1.${customerId}.${expStr}`;
  if (!safeEqual(sign(body), sig)) return null;
  if (Number(expStr) < Date.now()) return null;
  return customerId;
}

export function readMemberId(header: string | undefined, pass?: string | null) {
  const fromPass = readMemberPass(pass);
  if (fromPass) return fromPass;
  if (!header) return null;
  const parts = header.split(';').map((part) => part.trim());
  for (const name of ['gym_member=', 'gk_member_client=']) {
    const match = parts.find((part) => part.startsWith(name));
    if (!match) continue;
    const id = readMemberPass(decodeURIComponent(match.slice(name.length)));
    if (id) return id;
  }
  return null;
}

function memberIdFrom(req: Request) {
  const header = req.headers['x-member-pass'];
  const pass = Array.isArray(header) ? header[0] : header;
  return readMemberId(req.headers.cookie, pass);
}

function facilityForSport(sport: string) {
  const facilities = listFacilities();
  const needle = sport.trim().toLowerCase();
  return facilities.find((row) => row.sport.trim().toLowerCase() === needle)
    ?? facilities.find((row) => listedArenas(row.sport).some((name) => name.toLowerCase() === needle))
    ?? facilities.find((row) => listedArenas(row.name).some((name) => name.toLowerCase() === needle));
}

function requestSlotLabel(slot: string) {
  if (!slot) return '';
  const ms = Date.parse(slot);
  if (!Number.isNaN(ms)) {
    return new Date(ms).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return slotLabel(slot);
}

function digits(mobile: string) {
  const clean = mobile.replace(/\D/g, '');
  if (clean.length < 10) return '';
  return clean.slice(-10);
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function memberCode(n: number) {
  return `GK${String(n).padStart(4, '0')}`;
}

type PlanRow = {
  id: string;
  name: string;
  duration_days: number;
  price: number;
  description: string;
  facility_access: string;
  booking_privileges: string;
  discount_bps: number;
  guest_passes: number;
  renewal_days: number;
  freeze_days: number;
  is_active: number;
};

function mapPlan(row: PlanRow) {
  return {
    id: row.id,
    name: row.name,
    durationDays: row.duration_days,
    price: row.price,
    description: row.description,
    facilityAccess: row.facility_access,
    bookingPrivileges: row.booking_privileges,
    discountBps: row.discount_bps,
    guestPasses: row.guest_passes,
    renewalDays: row.renewal_days,
    freezeDays: row.freeze_days,
    isActive: row.is_active === 1,
  };
}

type FacilityRow = {
  id: string;
  name: string;
  sport: string;
  image_url: string;
  location: string;
  description: string;
  capacity: number;
  opens_at: string;
  closes_at: string;
  slot_minutes: number;
  member_price: number;
  guest_price: number;
  is_available: number;
  maintenance_status: string;
  access_rule: string;
};

function mapFacility(row: FacilityRow) {
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    imageUrl: row.image_url,
    location: row.location,
    description: row.description,
    capacity: row.capacity,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    slotMinutes: row.slot_minutes,
    memberPrice: row.member_price,
    guestPrice: row.guest_price,
    isAvailable: row.is_available === 1,
    maintenanceStatus: row.maintenance_status,
    accessRule: row.access_rule,
  };
}

function activeMembership(customerId: string) {
  const row = get<{
    status: string;
    expires_at: string | null;
    frozen_until: string | null;
    plan_id: string | null;
    discount_bps: number | null;
    plan_name: string | null;
  }>(
    `SELECT c.membership_status AS status, c.membership_expires_at AS expires_at, c.frozen_until, c.plan_id,
            p.discount_bps, p.name AS plan_name
     FROM customers c LEFT JOIN membership_plans p ON p.id = c.plan_id
     WHERE c.id = ? AND c.cafe_id = ?`,
    [customerId, CAFE_ID],
  );
  if (!row) return null;
  const expired = Boolean(row.expires_at && new Date(row.expires_at).getTime() < Date.now());
  const frozen = Boolean(row.frozen_until && new Date(row.frozen_until).getTime() > Date.now());
  const active = row.status === 'ACTIVE' && !expired && !frozen;
  return {
    status: expired && row.status === 'ACTIVE' ? 'EXPIRED' : row.status,
    expiresAt: row.expires_at,
    frozenUntil: row.frozen_until,
    planId: row.plan_id,
    planName: row.plan_name,
    discountBps: row.discount_bps ?? 0,
    active,
  };
}

export function listFacilities() {
  return all<FacilityRow>('SELECT * FROM facilities WHERE cafe_id = ? ORDER BY name', [CAFE_ID]).map(mapFacility);
}

export function listPlans(includeInactive = true) {
  const rows = all<PlanRow>(
    `SELECT * FROM membership_plans WHERE cafe_id = ? ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY price`,
    [CAFE_ID],
  );
  return rows.map(mapPlan);
}

export function listMembers(filter = 'all', query = '', extra: { sport?: string; from?: string; to?: string } = {}) {
  const rows = all<{
    id: string;
    name: string;
    mobile: string;
    email: string;
    member_code: string;
    membership_status: string;
    membership_expires_at: string | null;
    created_at: string;
    plan_name: string | null;
    photo_url: string;
    emergency_contact: string;
    access_interest: string;
    govt_id_label: string;
    govt_id_url: string;
    coach_name: string | null;
    coach_id: string | null;
    plan_id: string | null;
    notes: string;
    notify_prefs: string;
  }>(
    `SELECT c.id, c.name, c.mobile, c.email, c.member_code, c.membership_status, c.membership_expires_at, c.created_at,
            p.name AS plan_name, c.photo_url, c.emergency_contact, c.access_interest, c.govt_id_label, c.govt_id_url,
            t.name AS coach_name, c.coach_id, c.plan_id, c.notes, c.notify_prefs
     FROM customers c
     LEFT JOIN membership_plans p ON p.id = c.plan_id
     LEFT JOIN trainers t ON t.id = c.coach_id
     WHERE c.cafe_id = ? AND (c.member_code != '' OR IFNULL(c.access_interest, '') != '')
     ORDER BY c.name`,
    [CAFE_ID],
  );
  const needle = query.trim().toLowerCase();
  const soon = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const openBy = new Map(
    all<{ customer_id: string; facility_name: string; checked_in_at: string }>(
      'SELECT customer_id, facility_name, checked_in_at FROM check_ins WHERE cafe_id = ? AND checked_out_at IS NULL AND customer_id IS NOT NULL',
      [CAFE_ID],
    ).map((row) => [row.customer_id, row]),
  );
  const tapBy = new Map(
    all<{ customer_id: string; last_in: string; visits: number }>(
      'SELECT customer_id, MAX(checked_in_at) AS last_in, COUNT(*) AS visits FROM check_ins WHERE cafe_id = ? AND customer_id IS NOT NULL GROUP BY customer_id',
      [CAFE_ID],
    ).map((row) => [row.customer_id, row]),
  );
  const consentBy = comms.consentMap();
  const lastWa = comms.lastMessageByCustomer();
  const upcomingBy = new Set(
    all<{ customer_id: string }>(
      `SELECT DISTINCT customer_id FROM bookings WHERE cafe_id = ? AND status IN ('CONFIRMED','CHECKED_IN') AND start_at >= ? AND customer_id IS NOT NULL AND customer_id != ''`,
      [CAFE_ID, nowIso()],
    ).map((row) => row.customer_id),
  );
  return rows
    .map((row) => {
      const membership = activeMembership(row.id);
      const status = membership?.status ?? row.membership_status;
      const open = openBy.get(row.id);
      const tap = tapBy.get(row.id);
      const hereNow = open?.facility_name ?? '';
      return {
        id: row.id,
        name: row.name,
        mobile: row.mobile,
        email: row.email,
        memberCode: row.member_code,
        membershipStatus: status,
        planName: row.plan_name ?? '',
        expiresAt: row.membership_expires_at,
        registeredAt: row.created_at,
        photoUrl: row.photo_url,
        emergencyContact: row.emergency_contact,
        discountBps: membership?.discountBps ?? 0,
        accessInterest: row.access_interest ?? '',
        govtIdLabel: row.govt_id_label ?? '',
        govtIdUrl: row.govt_id_url ?? '',
        coachName: row.coach_name ?? '',
        coachId: row.coach_id ?? '',
        planId: row.plan_id ?? '',
        notes: row.notes ?? '',
        notifyPrefs: row.notify_prefs ?? '',
        isMember: status === 'ACTIVE',
        hereNow,
        hereSport: hereNow ? matchArena(hereNow) || hereNow : '',
        lastInAt: tap?.last_in ?? '',
        visits: tap?.visits ?? 0,
        tappedToday: Boolean(tap?.last_in && new Date(tap.last_in).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today),
        consentStatus: consentBy.get(row.id) ?? 'UNKNOWN',
        lastWhatsAppAt: lastWa.get(row.id)?.lastWhatsAppAt ?? '',
        lastWhatsAppStatus: lastWa.get(row.id)?.lastWhatsAppStatus ?? '',
        hasUpcoming: upcomingBy.has(row.id),
      };
    })
    .filter((member) => {
      if (needle) {
        const hay = `${member.name} ${member.mobile} ${member.memberCode} ${member.email} ${member.accessInterest} ${member.coachName} ${member.govtIdLabel} ${member.hereNow}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (extra.sport) {
        const hay = `${member.accessInterest} ${member.hereSport}`.toLowerCase();
        if (!hay.includes(extra.sport.trim().toLowerCase())) return false;
      }
      if (extra.from && member.registeredAt && member.registeredAt.slice(0, 10) < extra.from) return false;
      if (extra.to && member.registeredAt && member.registeredAt.slice(0, 10) > extra.to) return false;
      if (filter === 'all') return true;
      if (filter === 'in' || filter === 'inside') return Boolean(member.hereNow);
      if (filter === 'expiring') {
        return member.membershipStatus === 'ACTIVE' && Boolean(member.expiresAt) && new Date(member.expiresAt!).getTime() <= soon;
      }
      if ([
        'expired', 'expiring7', 'expiring14', 'expiring30', 'registered_recent', 'renewed_recent',
        'upcoming_bookings', 'no_upcoming', 'with_trainer', 'no_trainer', 'wa_opted_in', 'wa_unknown', 'wa_opted_out', 'invalid_phone',
      ].includes(filter)) {
        return comms.memberMatchesFilter({
          id: member.id,
          membershipStatus: member.membershipStatus,
          expiresAt: member.expiresAt,
          registeredAt: member.registeredAt,
          coachId: member.coachId,
          mobile: member.mobile,
          consentStatus: member.consentStatus,
          hasUpcoming: member.hasUpcoming,
        }, filter);
      }
      return member.membershipStatus === filter.toUpperCase();
    });
}

export function memberProfile(customerId: string) {
  const member = listMembers('all').find((row) => row.id === customerId);
  if (!member) throw new AppError(404, 'MEMBER', 'Member not found.');
  const bookings = all(
    `SELECT b.id, b.sport, f.name AS facility, b.start_at, b.end_at, b.amount, b.payment_status, b.status, b.participants
     FROM bookings b JOIN facilities f ON f.id = b.facility_id
     WHERE b.customer_id = ? ORDER BY b.start_at DESC LIMIT 200`,
    [customerId],
  );
  const payments = all(
    `SELECT o.id, o.order_number, o.total, o.payment_status, o.created_at, o.notes
     FROM orders o WHERE o.customer_id = ? AND o.status NOT IN ('DRAFT','OTP_PENDING') ORDER BY o.created_at DESC LIMIT 200`,
    [customerId],
  );
  const checkIns = all(
    'SELECT id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at FROM check_ins WHERE customer_id = ? ORDER BY checked_in_at DESC LIMIT 500',
    [customerId],
  );
  const period = get<{ starts_at: string; expires_at: string }>(
    `SELECT starts_at, expires_at FROM memberships WHERE customer_id = ? AND cafe_id = ? ORDER BY expires_at DESC LIMIT 1`,
    [customerId, CAFE_ID],
  );
  const startsAt = period?.starts_at || member.registeredAt;
  const expiresAt = member.expiresAt || period?.expires_at || null;
  const activities = listedArenas(member.accessInterest);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter((row) => String((row as { start_at: string }).start_at).slice(0, 10) >= today && ['CONFIRMED', 'CHECKED_IN'].includes(String((row as { status: string }).status)));
  const dues = all<{ total: number }>(
    `SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE customer_id = ? AND payment_status = 'UNPAID' AND status NOT IN ('DRAFT','CANCELLED','OTP_PENDING')`,
    [customerId],
  )[0]?.total ?? 0;
  const visitMinutes = (checkIns as { checked_in_at: string; checked_out_at: string | null }[]).reduce((sum, row) => {
    const start = new Date(row.checked_in_at).getTime();
    const end = row.checked_out_at ? new Date(row.checked_out_at).getTime() : Date.now();
    return sum + Math.max(0, Math.round((end - start) / 60000));
  }, 0);
  const bookingMinutes = (bookings as { start_at: string; end_at: string; status: string }[])
    .filter((row) => row.status !== 'CANCELLED' && row.status !== 'NO_SHOW')
    .reduce((sum, row) => sum + Math.max(0, Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60000)), 0);
  return {
    member: {
      ...member,
      startsAt,
      expiresAt,
      activities,
    },
    bookings,
    payments,
    checkIns,
    upcoming,
    outstanding: dues,
    timeUsedMinutes: visitMinutes + bookingMinutes,
    consent: comms.consentFor(customerId),
    messages: comms.messageHistory(customerId),
  };
}

function assignPlan(customerId: string, planId: string, actor: string, status = 'ACTIVE') {
  const plan = get<PlanRow>('SELECT * FROM membership_plans WHERE id = ? AND cafe_id = ?', [planId, CAFE_ID]);
  if (!plan || plan.is_active !== 1) throw new AppError(400, 'PLAN', 'Choose an active membership plan.');
  const customer = get<{ id: string; member_code: string }>('SELECT id, member_code FROM customers WHERE id = ? AND cafe_id = ?', [customerId, CAFE_ID]);
  if (!customer) throw new AppError(404, 'MEMBER', 'Member not found.');
  const prior = get<{ n: number }>('SELECT COUNT(*) AS n FROM memberships WHERE customer_id = ?', [customerId])?.n ?? 0;
  const starts = nowIso();
  const expires = new Date(Date.now() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
  const id = randomUUID();
  tx(() => {
    run(
      'INSERT INTO memberships (id, cafe_id, customer_id, plan_id, status, starts_at, expires_at, frozen_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
      [id, CAFE_ID, customerId, planId, status, starts, expires, starts],
    );
    run(
      `UPDATE customers SET plan_id = ?, membership_status = ?, membership_expires_at = ?, frozen_until = NULL WHERE id = ?`,
      [planId, status, expires, customerId],
    );
  });
  audit(actor, 'ASSIGN_PLAN', 'membership', id, plan.name);
  if (status === 'ACTIVE') {
    comms.emitGymEvent(prior > 0 ? 'MEMBERSHIP_RENEWED' : 'MEMBERSHIP_ACTIVATED', {
      entity: 'membership',
      entityId: id,
      customerId,
      extra: {
        membership_id: customer.member_code || id.slice(0, 8),
        expiry_date: comms.kolkataYmd(expires),
        new_expiry_date: comms.kolkataYmd(expires),
      },
    });
  }
  return memberProfile(customerId);
}

export function saveMember(input: {
  id?: string;
  name: string;
  mobile: string;
  email?: string;
  planId?: string;
  emergencyContact?: string;
  photoUrl?: string;
  accessInterest?: string;
  govtIdLabel?: string;
  govtIdUrl?: string;
  coachId?: string;
  notes?: string;
  notifyPrefs?: string;
}, actor: string) {
  const mobile = digits(input.mobile);
  if (!mobile) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  const name = input.name.trim();
  if (name.length < 2) throw new AppError(400, 'NAME', 'Enter the member name.');
  const existing = input.id
    ? get<{ id: string; coach_id: string | null }>('SELECT id, coach_id FROM customers WHERE id = ? AND cafe_id = ?', [input.id, CAFE_ID])
    : get<{ id: string; coach_id: string | null }>('SELECT id, coach_id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, mobile]);
  const id = existing?.id ?? randomUUID();
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM customers WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0;
  if (!existing) {
    run(
      `INSERT INTO customers (id, cafe_id, name, mobile, order_count, last_order_at, created_at, email, member_code, membership_status, emergency_contact, photo_url, access_interest, govt_id_label, govt_id_url, coach_id)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`,
      [id, CAFE_ID, name, mobile, nowIso(), input.email?.trim() ?? '', memberCode(count + 1), input.emergencyContact?.trim() ?? '', input.photoUrl?.trim() ?? '', input.accessInterest?.trim() ?? '', input.govtIdLabel?.trim() ?? '', input.govtIdUrl?.trim() ?? '', input.coachId || null],
    );
  } else {
    run(
      'UPDATE customers SET name = ?, mobile = ?, email = ?, emergency_contact = ?, photo_url = ?, access_interest = ?, govt_id_label = ?, govt_id_url = ?, coach_id = ? WHERE id = ?',
      [name, mobile, input.email?.trim() ?? '', input.emergencyContact?.trim() ?? '', input.photoUrl?.trim() ?? '', input.accessInterest?.trim() ?? '', input.govtIdLabel?.trim() ?? '', input.govtIdUrl?.trim() ?? '', input.coachId || null, id],
    );
    const code = get<{ member_code: string }>('SELECT member_code FROM customers WHERE id = ?', [id]);
    if (!code?.member_code) run('UPDATE customers SET member_code = ? WHERE id = ?', [memberCode(count + 1), id]);
  }
  if (input.notes !== undefined) run('UPDATE customers SET notes = ? WHERE id = ?', [input.notes.slice(0, 2000), id]);
  if (input.notifyPrefs !== undefined) run('UPDATE customers SET notify_prefs = ? WHERE id = ?', [input.notifyPrefs.slice(0, 40), id]);
  audit(actor, existing ? 'EDIT_MEMBER' : 'ADD_MEMBER', 'member', id, name);
  if (input.coachId && input.coachId !== (existing?.coach_id || '')) {
    const trainer = get<{ name: string; specialization: string }>('SELECT name, specialization FROM trainers WHERE id = ?', [input.coachId]);
    comms.emitGymEvent('TRAINER_ASSIGNED', {
      entity: 'trainer',
      entityId: input.coachId,
      customerId: id,
      extra: {
        trainer_name: trainer?.name || 'Trainer',
        sport: trainer?.specialization ? ` for ${trainer.specialization}` : '',
      },
    });
  }
  if (input.planId) return assignPlan(id, input.planId, actor);
  return memberProfile(id);
}

const MEMBER_CSV_KEYS: Record<string, string[]> = {
  name: ['name', 'fullname', 'member', 'membername'],
  mobile: ['mobile', 'phone', 'phonenumber', 'contact', 'contactnumber', 'whatsapp'],
  email: ['email', 'mail', 'emailaddress'],
  plan: ['plan', 'membership', 'planname', 'membershipplan'],
  activity: ['activity', 'access', 'sport', 'wantstouse', 'facility'],
  trainer: ['trainer', 'coach'],
  notes: ['notes', 'note'],
  emergency: ['emergency', 'emergencycontact'],
};

function csvHeaderKey(value: string) {
  return value.toLowerCase().replace(/[\s_\-/]+/g, '');
}

function parseCsvTable(text: string) {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell.trim());
      cell = '';
      if (row.some((value) => value)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((value) => value)) rows.push(row);
  return rows;
}

function memberCsvColumns(header: string[]) {
  const index = new Map<string, number>();
  header.forEach((label, i) => {
    const key = csvHeaderKey(label);
    if (key && !index.has(key)) index.set(key, i);
  });
  const col = (aliases: string[]) => {
    for (const alias of aliases) {
      const i = index.get(alias);
      if (i !== undefined) return i;
    }
    return -1;
  };
  const name = col(MEMBER_CSV_KEYS.name);
  const mobile = col(MEMBER_CSV_KEYS.mobile);
  if (name < 0 || mobile < 0) throw new AppError(400, 'CSV', 'The CSV needs name and mobile columns.');
  return {
    name,
    mobile,
    email: col(MEMBER_CSV_KEYS.email),
    plan: col(MEMBER_CSV_KEYS.plan),
    activity: col(MEMBER_CSV_KEYS.activity),
    trainer: col(MEMBER_CSV_KEYS.trainer),
    notes: col(MEMBER_CSV_KEYS.notes),
    emergency: col(MEMBER_CSV_KEYS.emergency),
  };
}

function csvCell(row: string[], index: number) {
  return index < 0 ? '' : (row[index] ?? '').trim();
}

export type MemberCsvIssue = { row: number; name: string; reason: string };

export function importMembersCsv(text: string, actor: string) {
  const csv = text.trim();
  if (!csv) throw new AppError(400, 'CSV', 'Choose a CSV file of members.');
  if (csv.length > 1_400_000) throw new AppError(400, 'CSV', 'That CSV is too large.');
  const table = parseCsvTable(csv);
  if (table.length < 2) throw new AppError(400, 'CSV', 'The CSV has a header but no members.');
  const columns = memberCsvColumns(table[0]);
  const body = table.slice(1);
  if (body.length > 2000) throw new AppError(400, 'CSV', 'Upload at most 2000 members at a time.');
  const plans = listPlans(false);
  const trainers = listTrainers().filter((trainer) => trainer.isActive);
  const matchPlan = (value: string) => {
    const needle = value.trim().toLowerCase();
    if (!needle) return '';
    return plans.find((plan) => plan.id.toLowerCase() === needle || plan.name.toLowerCase() === needle)?.id ?? null;
  };
  const matchTrainer = (value: string) => {
    const needle = value.trim().toLowerCase();
    if (!needle) return '';
    return trainers.find((trainer) => trainer.name.toLowerCase() === needle || trainer.id.toLowerCase() === needle)?.id ?? null;
  };
  const seen = new Set<string>();
  const created: string[] = [];
  const skipped: MemberCsvIssue[] = [];
  const errors: MemberCsvIssue[] = [];
  body.forEach((row, offset) => {
    const line = offset + 2;
    const name = csvCell(row, columns.name);
    const mobile = digits(csvCell(row, columns.mobile));
    const label = name || mobile || `Row ${line}`;
    if (!name || name.length < 2) {
      errors.push({ row: line, name: label, reason: 'Enter the member name.' });
      return;
    }
    if (!mobile) {
      errors.push({ row: line, name: label, reason: 'Enter a valid 10-digit mobile number.' });
      return;
    }
    if (seen.has(mobile)) {
      skipped.push({ row: line, name: label, reason: 'Same mobile already appears in this file.' });
      return;
    }
    seen.add(mobile);
    const already = get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, mobile]);
    if (already) {
      skipped.push({ row: line, name: label, reason: 'A member with this mobile is already on file.' });
      return;
    }
    const planValue = csvCell(row, columns.plan);
    const planId = matchPlan(planValue);
    if (planId === null) {
      errors.push({ row: line, name: label, reason: `Unknown plan "${planValue}".` });
      return;
    }
    const trainerValue = csvCell(row, columns.trainer);
    const coachId = matchTrainer(trainerValue);
    if (coachId === null) {
      errors.push({ row: line, name: label, reason: `Unknown trainer "${trainerValue}".` });
      return;
    }
    const activityRaw = csvCell(row, columns.activity);
    const accessInterest = matchActivity(activityRaw) || activityRaw;
    const profile = saveMember({
      name,
      mobile,
      email: csvCell(row, columns.email),
      planId,
      emergencyContact: csvCell(row, columns.emergency),
      accessInterest,
      coachId,
      notes: csvCell(row, columns.notes),
    }, actor);
    created.push(profile.member.id);
  });
  audit(actor, 'IMPORT_MEMBERS', 'member', CAFE_ID, `${created.length} added from CSV`);
  return { created: created.length, skipped: skipped.length, errors, skippedRows: skipped };
}

export function setMembershipStatus(customerId: string, status: 'ACTIVE' | 'SUSPENDED' | 'FROZEN' | 'PENDING', actor: string, freezeDays = 0) {
  const member = get<{ id: string; plan_id: string | null }>('SELECT id, plan_id FROM customers WHERE id = ? AND cafe_id = ?', [customerId, CAFE_ID]);
  if (!member) throw new AppError(404, 'MEMBER', 'Member not found.');
  let frozenUntil: string | null = null;
  if (status === 'FROZEN') {
    const plan = member.plan_id
      ? get<{ freeze_days: number }>('SELECT freeze_days FROM membership_plans WHERE id = ?', [member.plan_id])
      : null;
    const days = freezeDays || plan?.freeze_days || 0;
    if (days < 1) throw new AppError(400, 'FREEZE', 'This plan does not allow a freeze.');
    frozenUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  run('UPDATE customers SET membership_status = ?, frozen_until = ? WHERE id = ?', [status, frozenUntil, customerId]);
  audit(actor, status, 'member', customerId, status);
  return memberProfile(customerId);
}

export function recordMemberPayment(customerId: string, planId: string, method: 'CASH' | 'UPI' | 'CARD', actor: string) {
  const plan = get<PlanRow>('SELECT * FROM membership_plans WHERE id = ? AND cafe_id = ?', [planId, CAFE_ID]);
  if (!plan) throw new AppError(404, 'PLAN', 'Plan not found.');
  const member = get<{ name: string; mobile: string }>('SELECT name, mobile FROM customers WHERE id = ? AND cafe_id = ?', [customerId, CAFE_ID]);
  if (!member) throw new AppError(404, 'MEMBER', 'Member not found.');
  const itemId = `gym_item_plan_${plan.id}`;
  const item = get('SELECT id FROM menu_items WHERE id = ?', [itemId]);
  if (!item) throw new AppError(409, 'CATALOG', 'This plan is not on the register yet.');
  const order = createStaffOrder({
    customerName: member.name,
    customerMobile: member.mobile,
    items: [{ menuItemId: itemId, quantity: 1, addonIds: [] }],
    notes: `MEMBERSHIP:${plan.id}`,
  });
  const paid = markPaid(order.id, method, order.total);
  run('UPDATE orders SET customer_id = ? WHERE id = ?', [customerId, order.id]);
  assignPlan(customerId, planId, actor);
  audit(actor, 'MEMBER_PAYMENT', 'order', order.id, method);
  comms.emitGymEvent('PAYMENT_SUCCESS', {
    entity: 'order',
    entityId: order.id,
    customerId,
    extra: {
      amount: `₹${plan.price}`,
      transaction_id: order.id.slice(0, 8),
      payment_date: comms.kolkataYmd(),
      membership_ref: plan.name,
    },
  });
  return { order: paid, profile: memberProfile(customerId) };
}

function overlaps(facilityId: string, startAt: string, endAt: string, ignoreId?: string) {
  const row = get<{ id: string }>(
    `SELECT id FROM bookings
     WHERE facility_id = ? AND status IN ('CONFIRMED','CHECKED_IN')
       AND start_at < ? AND end_at > ?
       ${ignoreId ? 'AND id != ?' : ''}
     LIMIT 1`,
    ignoreId ? [facilityId, endAt, startAt, ignoreId] : [facilityId, endAt, startAt],
  );
  return row?.id ?? null;
}

export function slotsFor(facilityId: string, date: string, duration: number) {
  const facility = get<FacilityRow>('SELECT * FROM facilities WHERE id = ? AND cafe_id = ?', [facilityId, CAFE_ID]);
  if (!facility) throw new AppError(404, 'FACILITY', 'Facility not found.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'DATE', 'Choose a date.');
  const minutes = duration || facility.slot_minutes;
  const [oh, om] = facility.opens_at.split(':').map(Number);
  const [ch, cm] = facility.closes_at.split(':').map(Number);
  const open = (oh * 60) + om;
  const close = (ch * 60) + cm;
  const slots: { start: string; end: string; free: boolean }[] = [];
  for (let cursor = open; cursor + minutes <= close; cursor += facility.slot_minutes) {
    const sh = String(Math.floor(cursor / 60)).padStart(2, '0');
    const sm = String(cursor % 60).padStart(2, '0');
    const eh = String(Math.floor((cursor + minutes) / 60)).padStart(2, '0');
    const em = String((cursor + minutes) % 60).padStart(2, '0');
    const start = new Date(`${date}T${sh}:${sm}:00+05:30`).toISOString();
    const end = new Date(`${date}T${eh}:${em}:00+05:30`).toISOString();
    const blocked = facility.maintenance_status !== 'OK' || facility.is_available !== 1;
    slots.push({ start, end, free: !blocked && !overlaps(facility.id, start, end) });
  }
  return { facility: mapFacility(facility), slots };
}

export function createBooking(input: {
  facilityId: string;
  customerId?: string | null;
  memberName: string;
  memberMobile?: string;
  startAt: string;
  durationMinutes?: number;
  participants?: number;
  paymentMethod?: 'CASH' | 'UPI' | 'CARD' | '';
  payNow?: boolean;
  notes?: string;
}, actor: string) {
  const facility = get<FacilityRow>('SELECT * FROM facilities WHERE id = ? AND cafe_id = ?', [input.facilityId, CAFE_ID]);
  if (!facility) throw new AppError(404, 'FACILITY', 'Facility not found.');
  if (facility.is_available !== 1 || facility.maintenance_status !== 'OK') {
    throw new AppError(409, 'UNAVAILABLE', `${facility.name} is not available.`);
  }
  const start = new Date(input.startAt);
  if (Number.isNaN(start.getTime())) throw new AppError(400, 'TIME', 'Choose a start time.');
  const duration = input.durationMinutes || facility.slot_minutes;
  const endAt = addMinutes(start.toISOString(), duration);
  const people = Math.max(1, Math.min(facility.capacity, input.participants || 1));
  const name = input.memberName.trim() || 'Walk-in';
  const mobile = input.memberMobile ? digits(input.memberMobile) : '';
  if (input.memberMobile && !mobile) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  let customerId = input.customerId ?? null;
  let discount = 0;
  let unit = facility.guest_price;
  if (customerId) {
    const membership = activeMembership(customerId);
    if (membership?.active) {
      unit = facility.member_price;
      discount = Math.round((unit * people * membership.discountBps) / 10000);
    }
  }
  const amount = Math.max(0, unit * people - discount);
  const id = randomUUID();
  tx(() => {
    if (overlaps(facility.id, start.toISOString(), endAt)) {
      throw new AppError(409, 'OVERLAP', 'That time is already booked.');
    }
    run(
      `INSERT INTO bookings (id, cafe_id, facility_id, customer_id, member_name, member_mobile, sport, start_at, end_at, participants, amount, discount, payment_status, status, payment_method, order_id, notes, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', 'CONFIRMED', '', NULL, ?, ?, ?, ?)`,
      [id, CAFE_ID, facility.id, customerId, name, mobile, facility.sport, start.toISOString(), endAt, people, amount, discount, input.notes?.slice(0, 240) ?? '', nowIso(), nowIso(), actor],
    );
    run('INSERT INTO booking_participants (id, booking_id, name, mobile) VALUES (?, ?, ?, ?)', [randomUUID(), id, name, mobile]);
  });
  const menuItemId = `gym_item_${facility.id}`;
  const menuItem = get('SELECT id FROM menu_items WHERE id = ?', [menuItemId]);
  if (menuItem && amount > 0) {
    const order = createStaffOrder({
      customerName: name,
      customerMobile: mobile,
      items: [{ menuItemId, quantity: people, addonIds: [], notes: `BOOKING:${id}` }],
      notes: `BOOKING:${id}`,
      discount: Math.max(0, facility.guest_price * people - amount),
    });
    if (customerId) run('UPDATE orders SET customer_id = ? WHERE id = ?', [customerId, order.id]);
    if (input.payNow && input.paymentMethod) {
      markPaid(order.id, input.paymentMethod, order.total);
      run(
        `UPDATE bookings SET order_id = ?, amount = ?, payment_status = 'PAID', payment_method = ?, updated_at = ? WHERE id = ?`,
        [order.id, order.total, input.paymentMethod, nowIso(), id],
      );
    } else {
      run('UPDATE bookings SET order_id = ?, amount = ?, updated_at = ? WHERE id = ?', [order.id, order.total, nowIso(), id]);
    }
  }
  audit(actor, 'CREATE_BOOKING', 'booking', id, facility.name);
  notify('staff', 'New booking', `${name} · ${facility.name}`);
  const created = getBooking(id);
  if (customerId) {
    comms.emitGymEvent('BOOKING_CONFIRMED', {
      entity: 'booking',
      entityId: id,
      customerId,
      extra: {
        booking_id: id.slice(0, 8),
        facility: facility.name,
        sport: facility.sport,
        booking_date: comms.kolkataYmd(created.startAt),
        start_time: comms.kolkataTime(created.startAt),
        end_time: comms.kolkataTime(created.endAt),
        amount: `₹${created.amount}`,
      },
    });
  }
  return created;
}

export function listBookings(filters: { date?: string; facilityId?: string; sport?: string } = {}) {
  const rows = all<{
    id: string;
    member_name: string;
    member_mobile: string;
    sport: string;
    facility: string;
    facility_id: string;
    start_at: string;
    end_at: string;
    participants: number;
    amount: number;
    discount: number;
    payment_status: string;
    status: string;
    payment_method: string;
    customer_id: string | null;
    notes: string;
    created_by: string;
  }>(
    `SELECT b.id, b.member_name, b.member_mobile, b.sport, f.name AS facility, b.facility_id, b.start_at, b.end_at,
            b.participants, b.amount, b.discount, b.payment_status, b.status, b.payment_method, b.customer_id, b.notes, b.created_by
     FROM bookings b JOIN facilities f ON f.id = b.facility_id
     WHERE b.cafe_id = ?
     ORDER BY b.start_at`,
    [CAFE_ID],
  );
  return rows.filter((row) => {
    if (filters.facilityId && row.facility_id !== filters.facilityId) return false;
    if (filters.sport && row.sport !== filters.sport) return false;
    if (filters.date) {
      const ymd = new Date(row.start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (ymd !== filters.date) return false;
    }
    return true;
  }).map((row) => ({
    id: row.id,
    memberName: row.member_name,
    memberMobile: row.member_mobile,
    sport: row.sport,
    facility: row.facility,
    facilityId: row.facility_id,
    startAt: row.start_at,
    endAt: row.end_at,
    participants: row.participants,
    amount: row.amount,
    discount: row.discount,
    paymentStatus: row.payment_status,
    status: row.status,
    paymentMethod: row.payment_method,
    customerId: row.customer_id,
    notes: row.notes ?? '',
    createdBy: row.created_by ?? '',
  }));
}

export function getBooking(id: string) {
  const row = listBookings().find((booking) => booking.id === id);
  if (!row) throw new AppError(404, 'BOOKING', 'Booking not found.');
  return row;
}

export function updateBooking(id: string, patch: { startAt?: string; facilityId?: string; participants?: number; memberName?: string; memberMobile?: string; notes?: string; status?: string }, actor: string) {
  const current = get<{ facility_id: string; start_at: string; end_at: string; status: string; participants: number; member_name: string; member_mobile: string; notes: string; payment_status: string }>(
    'SELECT facility_id, start_at, end_at, status, participants, member_name, member_mobile, notes, payment_status FROM bookings WHERE id = ? AND cafe_id = ?',
    [id, CAFE_ID],
  );
  if (!current) throw new AppError(404, 'BOOKING', 'Booking not found.');
  const nextStatus = patch.status ? String(patch.status) : current.status;
  if (patch.status && !BOOKING_STATUSES.includes(nextStatus as (typeof BOOKING_STATUSES)[number])) {
    throw new AppError(400, 'STATUS', 'Unknown booking status.');
  }
  if (nextStatus === 'CANCELLED' && current.payment_status === 'PAID') {
    throw new AppError(409, 'REFUND', 'Refund the payment before cancelling a paid booking.');
  }
  const open = OPEN_BOOKING.includes(current.status) || OPEN_BOOKING.includes(nextStatus);
  if (!open) {
    if (!patch.status || nextStatus === current.status) throw new AppError(409, 'BOOKING', 'This booking can no longer be changed.');
    run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?', [nextStatus, nowIso(), id]);
    audit(actor, nextStatus, 'booking', id, nextStatus);
    return getBooking(id);
  }
  const facilityId = patch.facilityId || current.facility_id;
  const facility = get<FacilityRow>('SELECT * FROM facilities WHERE id = ?', [facilityId]);
  if (!facility) throw new AppError(404, 'FACILITY', 'Facility not found.');
  const startAt = patch.startAt ? new Date(patch.startAt).toISOString() : current.start_at;
  const duration = new Date(current.end_at).getTime() - new Date(current.start_at).getTime();
  const endAt = new Date(new Date(startAt).getTime() + duration).toISOString();
  const mobile = patch.memberMobile !== undefined ? digits(patch.memberMobile) : current.member_mobile;
  if (patch.memberMobile && !mobile) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  const people = Math.max(1, Math.min(facility.capacity, patch.participants ?? current.participants));
  tx(() => {
    if (OPEN_BOOKING.includes(nextStatus) && overlaps(facilityId, startAt, endAt, id)) throw new AppError(409, 'OVERLAP', 'That time is already booked.');
    run(
      'UPDATE bookings SET facility_id = ?, sport = ?, start_at = ?, end_at = ?, participants = ?, member_name = ?, member_mobile = ?, notes = ?, status = ?, updated_at = ? WHERE id = ?',
      [facilityId, facility.sport, startAt, endAt, people, patch.memberName?.trim() || current.member_name, mobile ?? '', (patch.notes ?? current.notes ?? '').slice(0, 240), nextStatus, nowIso(), id],
    );
  });
  audit(actor, patch.status && nextStatus !== current.status ? nextStatus : 'RESCHEDULE', 'booking', id, facility.name);
  const updated = getBooking(id);
  if (updated.customerId) {
    if (nextStatus === 'CANCELLED' && current.status !== 'CANCELLED') {
      comms.emitGymEvent('BOOKING_CANCELLED', {
        entity: 'booking',
        entityId: id,
        customerId: updated.customerId,
        extra: { booking_id: id.slice(0, 8), facility: facility.name, refund_status: updated.paymentStatus === 'REFUNDED' ? 'Refunded' : 'No refund' },
      });
    } else if (startAt !== current.start_at || facilityId !== current.facility_id) {
      comms.emitGymEvent('BOOKING_RESCHEDULED', {
        entity: 'booking',
        entityId: id,
        customerId: updated.customerId,
        extra: {
          facility: facility.name,
          old_when: `${comms.kolkataYmd(current.start_at)} ${comms.kolkataTime(current.start_at)}`,
          new_when: `${comms.kolkataYmd(updated.startAt)} ${comms.kolkataTime(updated.startAt)}`,
        },
      });
    }
  }
  return updated;
}

export function setBookingStatus(id: string, status: 'CONFIRMED' | 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW', actor: string) {
  const current = get<{ status: string; order_id: string | null; payment_status: string }>('SELECT status, order_id, payment_status FROM bookings WHERE id = ?', [id]);
  if (!current) throw new AppError(404, 'BOOKING', 'Booking not found.');
  if (status === 'CANCELLED' && current.payment_status === 'PAID') {
    throw new AppError(409, 'REFUND', 'Refund the payment before cancelling a paid booking.');
  }
  run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
  audit(actor, status, 'booking', id, status);
  const updated = getBooking(id);
  if (status === 'CANCELLED' && updated.customerId) {
    comms.emitGymEvent('BOOKING_CANCELLED', {
      entity: 'booking',
      entityId: id,
      customerId: updated.customerId,
      extra: { booking_id: id.slice(0, 8), facility: updated.facility, refund_status: updated.paymentStatus === 'REFUNDED' ? 'Refunded' : 'No refund' },
    });
  }
  return updated;
}

export function refundBooking(id: string, actor: string) {
  const current = get<{ payment_status: string; order_id: string | null; amount: number }>(
    'SELECT payment_status, order_id, amount FROM bookings WHERE id = ? AND cafe_id = ?',
    [id, CAFE_ID],
  );
  if (!current) throw new AppError(404, 'BOOKING', 'Booking not found.');
  if (current.payment_status !== 'PAID' || !current.order_id) {
    throw new AppError(409, 'REFUND', 'There is no recorded payment to refund.');
  }
  const paid = get<{ id: string }>('SELECT id FROM payments WHERE order_id = ? AND status = ?', [current.order_id, 'PAID']);
  if (!paid) throw new AppError(409, 'REFUND', 'There is no recorded payment to refund.');
  tx(() => {
    run(
      'INSERT INTO payments (id, order_id, method, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), current.order_id, 'OTHER', current.amount, 'REFUNDED', nowIso()],
    );
    run(`UPDATE orders SET payment_status = 'REFUNDED', updated_at = ? WHERE id = ?`, [nowIso(), current.order_id]);
    run(`UPDATE bookings SET payment_status = 'REFUNDED', status = 'CANCELLED', updated_at = ? WHERE id = ?`, [nowIso(), id]);
  });
  audit(actor, 'REFUND', 'booking', id, 'Desk refund recorded. Razorpay is not refunded automatically.');
  const booking = getBooking(id);
  if (booking.customerId) {
    comms.emitGymEvent('BOOKING_CANCELLED', {
      entity: 'booking',
      entityId: id,
      customerId: booking.customerId,
      extra: { booking_id: id.slice(0, 8), facility: booking.facility, refund_status: 'Desk refund recorded' },
    });
  }
  return {
    booking,
    note: 'Desk refund recorded. An online Razorpay refund is not sent unless that integration is configured.',
  };
}

export function saveFacility(input: Partial<FacilityRow> & { name?: string; sport?: string }, actor: string, id?: string) {
  const facilityId = id || randomUUID();
  const current = id ? get<FacilityRow>('SELECT * FROM facilities WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]) : undefined;
  if (id && !current) throw new AppError(404, 'FACILITY', 'Facility not found.');
  const name = (input.name ?? current?.name ?? '').trim();
  const sport = (input.sport ?? current?.sport ?? '').trim();
  if (!name || !sport) throw new AppError(400, 'FACILITY', 'Name and sport are required.');
  const next = {
    image_url: input.image_url ?? current?.image_url ?? '',
    location: input.location ?? current?.location ?? '',
    description: input.description ?? current?.description ?? '',
    capacity: Number(input.capacity ?? current?.capacity ?? 1),
    opens_at: input.opens_at ?? current?.opens_at ?? '06:00',
    closes_at: input.closes_at ?? current?.closes_at ?? '22:00',
    slot_minutes: Number(input.slot_minutes ?? current?.slot_minutes ?? 60),
    member_price: Number(input.member_price ?? current?.member_price ?? 0),
    guest_price: Number(input.guest_price ?? current?.guest_price ?? 0),
    is_available: input.is_available ?? current?.is_available ?? 1,
    maintenance_status: input.maintenance_status ?? current?.maintenance_status ?? 'OK',
    access_rule: input.access_rule ?? current?.access_rule ?? 'BOOKING',
  };
  if (!current) {
    run(
      `INSERT INTO facilities (id, cafe_id, name, sport, image_url, location, description, capacity, opens_at, closes_at, slot_minutes, member_price, guest_price, is_available, maintenance_status, access_rule, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [facilityId, CAFE_ID, name, sport, next.image_url, next.location, next.description, next.capacity, next.opens_at, next.closes_at, next.slot_minutes, next.member_price, next.guest_price, next.is_available, next.maintenance_status, next.access_rule, nowIso()],
    );
  } else {
    run(
      `UPDATE facilities SET name = ?, sport = ?, image_url = ?, location = ?, description = ?, capacity = ?, opens_at = ?, closes_at = ?, slot_minutes = ?, member_price = ?, guest_price = ?, is_available = ?, maintenance_status = ?, access_rule = ?, updated_at = ? WHERE id = ?`,
      [name, sport, next.image_url, next.location, next.description, next.capacity, next.opens_at, next.closes_at, next.slot_minutes, next.member_price, next.guest_price, next.is_available, next.maintenance_status, next.access_rule, nowIso(), facilityId],
    );
  }
  audit(actor, current ? 'EDIT_FACILITY' : 'ADD_FACILITY', 'facility', facilityId, name);
  const wasBlocked = Boolean(current && (current.maintenance_status !== 'OK' || current.is_available !== 1));
  const nowBlocked = next.maintenance_status !== 'OK' || next.is_available !== 1;
  if (current && !wasBlocked && nowBlocked) notifyFacilityMembers(facilityId, 'FACILITY_MAINTENANCE', { facility: name });
  if (current && wasBlocked && !nowBlocked) notifyFacilityMembers(facilityId, 'FACILITY_REOPENED', { facility: name });
  return listFacilities().find((row) => row.id === facilityId);
}

function notifyFacilityMembers(facilityId: string, type: 'FACILITY_MAINTENANCE' | 'FACILITY_REOPENED', extra: Record<string, string>) {
  const ids = all<{ customer_id: string }>(
    `SELECT DISTINCT customer_id FROM bookings WHERE cafe_id = ? AND facility_id = ? AND status IN ('CONFIRMED','CHECKED_IN') AND start_at >= ? AND customer_id IS NOT NULL AND customer_id != ''`,
    [CAFE_ID, facilityId, nowIso()],
  ).map((row) => row.customer_id);
  comms.emitToMembers(type, ids, extra, facilityId);
}

export function savePlan(input: {
  id?: string;
  name: string;
  durationDays: number;
  price: number;
  description?: string;
  facilityAccess?: string;
  bookingPrivileges?: string;
  discountBps?: number;
  guestPasses?: number;
  renewalDays?: number;
  freezeDays?: number;
  isActive?: boolean;
}, actor: string) {
  const id = input.id || randomUUID();
  const current = input.id ? get('SELECT id FROM membership_plans WHERE id = ? AND cafe_id = ?', [input.id, CAFE_ID]) : null;
  if (input.id && !current) throw new AppError(404, 'PLAN', 'Plan not found.');
  if (!input.name.trim() || input.durationDays < 1 || input.price < 0) throw new AppError(400, 'PLAN', 'Name, duration, and price are required.');
  const values = [
    input.name.trim(),
    input.durationDays,
    input.price,
    input.description?.trim() ?? '',
    input.facilityAccess?.trim() || 'ALL',
    input.bookingPrivileges?.trim() ?? '',
    input.discountBps ?? 0,
    input.guestPasses ?? 0,
    input.renewalDays ?? 7,
    input.freezeDays ?? 0,
    input.isActive === false ? 0 : 1,
    nowIso(),
  ];
  if (!current) {
    run(
      `INSERT INTO membership_plans (id, cafe_id, name, duration_days, price, description, facility_access, booking_privileges, discount_bps, guest_passes, renewal_days, freeze_days, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, CAFE_ID, ...values],
    );
  } else {
    run(
      `UPDATE membership_plans SET name = ?, duration_days = ?, price = ?, description = ?, facility_access = ?, booking_privileges = ?, discount_bps = ?, guest_passes = ?, renewal_days = ?, freeze_days = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      [...values, id],
    );
  }
  audit(actor, current ? 'EDIT_PLAN' : 'ADD_PLAN', 'plan', id, input.name.trim());
  return listPlans().find((plan) => plan.id === id);
}

export function checkIn(input: { query: string; guestFee?: number; payFee?: boolean; method?: 'CASH' | 'UPI' | 'CARD'; facilityName?: string; fromGate?: boolean }, actor: string) {
  const q = input.query.trim();
  const mobile = digits(q);
  const member = get<{ id: string; name: string; mobile: string; membership_status: string; membership_expires_at: string | null }>(
    `SELECT id, name, mobile, membership_status, membership_expires_at FROM customers
     WHERE cafe_id = ? AND (id = ? OR member_code = ? OR mobile = ? OR name LIKE ?) LIMIT 1`,
    [CAFE_ID, q, q.toUpperCase(), mobile || q, `%${q}%`],
  );
  if (!member) throw new AppError(404, 'MEMBER', 'No member matched that search.');
  const membership = activeMembership(member.id);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const booking = all<{ id: string; facility: string; start_at: string }>(
    `SELECT b.id, f.name AS facility, b.start_at FROM bookings b JOIN facilities f ON f.id = b.facility_id
     WHERE b.customer_id = ? AND b.status IN ('CONFIRMED','CHECKED_IN')`,
    [member.id],
  ).find((row) => new Date(row.start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === today);
  const targetName = input.facilityName?.trim() || booking?.facility || 'Reception';
  const open = get<{ id: string; facility_name: string }>(
    'SELECT id, facility_name FROM check_ins WHERE cafe_id = ? AND customer_id = ? AND checked_out_at IS NULL ORDER BY checked_in_at DESC LIMIT 1',
    [CAFE_ID, member.id],
  );
  if (!membership?.active) {
    if (open) checkOut(open.id, actor);
    throw new AppError(403, 'ACCESS', 'Only members can go in. This membership is not active.');
  }
  if (open && matchArena(open.facility_name) && matchArena(open.facility_name) === matchArena(targetName)) {
    return { checkInId: open.id, already: true, profile: memberProfile(member.id) };
  }
  if (open) checkOut(open.id, actor);
  const id = randomUUID();
  run(
    `INSERT INTO check_ins (id, cafe_id, customer_id, member_name, booking_id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at, checked_in_by)
     VALUES (?, ?, ?, ?, ?, ?, 'MEMBER', 0, 'UNPAID', ?, NULL, ?)`,
    [id, CAFE_ID, member.id, member.name, booking?.id ?? null, targetName, nowIso(), actor],
  );
  if (booking) run(`UPDATE bookings SET status = 'CHECKED_IN', updated_at = ? WHERE id = ?`, [nowIso(), booking.id]);
  audit(actor, 'CHECK_IN', 'check_in', id, member.name);
  return { checkInId: id, profile: memberProfile(member.id) };
}

export function checkOut(checkInId: string, actor: string) {
  const row = get('SELECT id FROM check_ins WHERE id = ? AND checked_out_at IS NULL', [checkInId]);
  if (!row) throw new AppError(404, 'CHECKIN', 'Open check-in not found.');
  run('UPDATE check_ins SET checked_out_at = ? WHERE id = ?', [nowIso(), checkInId]);
  audit(actor, 'CHECK_OUT', 'check_in', checkInId, 'Checked out');
  return { ok: true };
}

export function overview() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const members = get<{ n: number }>('SELECT COUNT(*) AS n FROM customers WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0;
  const active = listMembers('ACTIVE').length;
  const bookings = listBookings({ date: today });
  const revenue = bookings.filter((row) => row.paymentStatus === 'PAID').reduce((sum, row) => sum + row.amount, 0);
  const openSales = get<{ n: number; total: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM orders WHERE cafe_id = ? AND payment_status = 'UNPAID' AND status NOT IN ('DRAFT','CANCELLED','OTP_PENDING')`,
    [CAFE_ID],
  );
  const inside = get<{ n: number }>("SELECT COUNT(*) AS n FROM check_ins WHERE cafe_id = ? AND checked_out_at IS NULL", [CAFE_ID])?.n ?? 0;
  const capacity = get<{ n: number }>('SELECT COALESCE(SUM(capacity), 0) AS n FROM facilities WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0;
  return {
    totalMembers: members,
    activeMemberships: active,
    todaysBookings: bookings.length,
    todaysRevenue: revenue,
    currentOccupancy: inside,
    capacity,
    pendingPayments: openSales?.total ?? 0,
    pendingCount: openSales?.n ?? 0,
    facilities: listFacilities().map((facility) => {
      const current = bookings.filter((row) => row.facilityId === facility.id && OPEN_BOOKING.includes(row.status)).length;
      return { ...facility, currentOccupancy: current, availability: facility.isAvailable && facility.maintenanceStatus === 'OK' ? 'OPEN' : 'BLOCKED' };
    }),
  };
}

export function gymReport() {
  const bookings = listBookings();
  const paid = (sportish: (row: { sport: string }) => boolean) => bookings.filter((row) => row.paymentStatus === 'PAID' && sportish(row)).reduce((sum, row) => sum + row.amount, 0);
  const membershipRevenue = get<{ n: number }>(
    `SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE cafe_id = ? AND notes LIKE 'MEMBERSHIP:%' AND payment_status = 'PAID'`,
    [CAFE_ID],
  )?.n ?? 0;
  const retail = get<{ n: number }>(
    `SELECT COALESCE(SUM(total), 0) AS n FROM orders WHERE cafe_id = ? AND payment_status = 'PAID' AND notes NOT LIKE 'MEMBERSHIP:%' AND notes NOT LIKE 'BOOKING:%'`,
    [CAFE_ID],
  )?.n ?? 0;
  const methods = all<{ method: string; amount: number }>(
    `SELECT method, COALESCE(SUM(amount), 0) AS amount FROM payments WHERE status = 'PAID' GROUP BY method`,
  );
  const checkIns = get<{ n: number }>('SELECT COUNT(*) AS n FROM check_ins WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0;
  return {
    facilityRevenue: paid(() => true),
    membershipRevenue,
    coachingRevenue: paid((row) => /coach|class/i.test(row.sport)),
    retail,
    byMethod: Object.fromEntries(methods.map((row) => [row.method, row.amount])),
    utilization: listFacilities().map((facility) => ({
      name: facility.name,
      bookings: bookings.filter((row) => row.facilityId === facility.id && row.status !== 'CANCELLED').length,
    })),
    renewals: get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE cafe_id = ?", [CAFE_ID])?.n ?? 0,
    attendance: checkIns,
    cancellations: bookings.filter((row) => row.status === 'CANCELLED').length,
    noShows: bookings.filter((row) => row.status === 'NO_SHOW').length,
    activeVisitors: get<{ n: number }>("SELECT COUNT(*) AS n FROM check_ins WHERE cafe_id = ? AND checked_out_at IS NULL", [CAFE_ID])?.n ?? 0,
    activeMemberships: listMembers('ACTIVE').length,
    visitors: listMembers('all').length,
  };
}

export function facilityBoard() {
  const open = all<{ facility_name: string; name: string; membership_status: string | null; coach: string | null }>(
    `SELECT ci.facility_name, COALESCE(c.name, ci.member_name) AS name, c.membership_status, t.name AS coach
     FROM check_ins ci
     LEFT JOIN customers c ON c.id = ci.customer_id
     LEFT JOIN trainers t ON t.id = c.coach_id
     WHERE ci.cafe_id = ? AND ci.checked_out_at IS NULL`,
    [CAFE_ID],
  );
  return listFacilities().map((facility) => {
    const using = open
      .filter((row) => row.facility_name === facility.name)
      .map((row) => ({
        name: row.name,
        member: row.membership_status === 'ACTIVE',
        coach: row.coach ?? '',
      }));
    return { ...facility, visitorCount: using.length, using };
  });
}

export function activityBoard() {
  const customers = all<{ id: string; name: string; access_interest: string }>(
    'SELECT id, name, access_interest FROM customers WHERE cafe_id = ?',
    [CAFE_ID],
  );
  const joins = all<{ id: string; name: string; sport: string; customer_id: string | null }>(
    "SELECT id, name, sport, customer_id FROM join_requests WHERE cafe_id = ? AND status NOT IN ('DECLINED','CANCELLED')",
    [CAFE_ID],
  );
  const inside = all<{ customer_id: string | null; member_name: string; facility_name: string }>(
    'SELECT customer_id, member_name, facility_name FROM check_ins WHERE cafe_id = ? AND checked_out_at IS NULL',
    [CAFE_ID],
  );
  return ARENA_SPORTS.map((sport) => {
    const courts = listFacilities().filter((facility) => matchArena(facility.sport) === sport || matchArena(facility.name) === sport);
    const people = new Map<string, { id: string; name: string; inside: boolean }>();
    for (const customer of customers) {
      if (!listedArenas(customer.access_interest).includes(sport)) continue;
      people.set(customer.id, { id: customer.id, name: customer.name, inside: false });
    }
    for (const row of joins) {
      if (!listedArenas(row.sport).includes(sport)) continue;
      const id = row.customer_id || `join:${row.id}`;
      if (row.customer_id && people.has(row.customer_id)) continue;
      if (!people.has(id)) people.set(id, { id, name: row.name, inside: false });
    }
    for (const row of inside) {
      if (matchArena(row.facility_name) !== sport) continue;
      const id = row.customer_id || `in:${row.member_name}`;
      const current = (row.customer_id && people.get(row.customer_id)) || people.get(id) || [...people.values()].find((person) => person.name === row.member_name);
      if (current) current.inside = true;
      else people.set(id, { id, name: row.member_name, inside: true });
    }
    const list = [...people.values()].sort((left, right) => Number(right.inside) - Number(left.inside) || left.name.localeCompare(right.name));
    return {
      sport,
      slug: arenaSlug(sport),
      facilityId: courts[0]?.id ?? '',
      inside: list.filter((person) => person.inside).length,
      people: list,
    };
  });
}

export function scanActivityGate(slug: string, cookieHeader?: string, pass?: string | null) {
  const customerId = readMemberId(cookieHeader, pass);
  if (!customerId) throw new AppError(401, 'AUTH', 'Register once on this phone, then just scan.');
  const member = get<{ id: string; name: string; access_interest: string }>(
    'SELECT id, name, access_interest FROM customers WHERE id = ? AND cafe_id = ?',
    [customerId, CAFE_ID],
  );
  if (!member) throw new AppError(401, 'AUTH', 'Register once on this phone, then just scan.');
  if (!activeMembership(member.id)?.active) {
    throw new AppError(403, 'ACCESS', 'Only members can go in. This membership is not active.');
  }
  const door = !String(slug ?? '').trim();
  const registered = listedArenas(member.access_interest)[0] || '';
  const sport = door
    ? (registered || 'Gym')
    : (sportFromSlug(slug) || matchArena(slug) || '');
  if (!sport) throw new AppError(400, 'SPORT', 'Unknown activity.');
  const court = listFacilities().find((facility) => matchArena(facility.sport) === sport || matchArena(facility.name) === sport);
  const facilityName = court?.name ?? sport;
  const result = checkIn({ query: member.id, facilityName, fromGate: true }, member.name);
  return {
    ok: true,
    already: Boolean(result.already),
    sport,
    activity: registered || sport,
    name: member.name,
    facility: facilityName,
    door,
  };
}

function shiftStats(name: string, since: string, until: string | null) {
  const end = until ?? '9999-12-31T00:00:00.000Z';
  const bookings = get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM bookings WHERE cafe_id = ? AND created_by = ? AND created_at >= ? AND created_at < ?',
    [CAFE_ID, name, since, end],
  )?.n ?? 0;
  const checkIns = get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM check_ins WHERE cafe_id = ? AND checked_in_by = ? AND checked_in_at >= ? AND checked_in_at < ?',
    [CAFE_ID, name, since, end],
  )?.n ?? 0;
  return { bookings, checkIns };
}

type ShiftDbRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  subject_name: string;
  started_at: string;
  ended_at: string | null;
  phone: string;
  email: string;
  role_label: string;
  govt_id_label: string;
  govt_id_url?: string;
  areas: string;
  notes: string;
  opened_by: string;
};

type SessionRow = {
  id: string;
  shift_id: string;
  trainer_id: string;
  trainer_name: string;
  session_date: string;
  start_time: string;
  duration_minutes: number;
  facility: string;
  activity: string;
  kind: string;
  participants: number;
  visitors: string;
  amount: number;
  payment: string;
};

export type SessionInput = {
  date?: string;
  startTime?: string;
  minutes?: number;
  facility?: string;
  activity?: string;
  kind?: string;
  people?: number;
  visitors?: string;
  amount?: number;
  payment?: string;
};

export type ShiftInput = {
  type?: string;
  trainerId?: string;
  name?: string;
  phone?: string;
  email?: string;
  roleLabel?: string;
  govtIdLabel?: string;
  govtIdUrl?: string;
  areas?: string;
  notes?: string;
  sessions?: SessionInput[];
};

const SHIFT_COLUMNS = 'id, subject_type, subject_id, subject_name, started_at, ended_at, phone, email, role_label, govt_id_label, areas, notes, opened_by';

function mapShift(row: ShiftDbRow) {
  const sessions = get<{ n: number }>('SELECT COUNT(*) AS n FROM trainer_sessions WHERE shift_id = ?', [row.id])?.n ?? 0;
  return {
    id: row.id,
    type: row.subject_type,
    subjectId: row.subject_id,
    name: row.subject_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    phone: row.phone ?? '',
    email: row.email ?? '',
    roleLabel: row.role_label ?? '',
    govtIdLabel: row.govt_id_label ?? '',
    areas: row.areas ?? '',
    notes: row.notes ?? '',
    sessions,
    ...shiftStats(row.opened_by || row.subject_name, row.started_at, row.ended_at),
  };
}

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    shiftId: row.shift_id,
    trainerId: row.trainer_id,
    trainerName: row.trainer_name,
    date: row.session_date,
    startTime: row.start_time,
    minutes: row.duration_minutes,
    facility: row.facility,
    activity: row.activity,
    kind: row.kind,
    people: row.participants,
    visitors: row.visitors,
    amount: row.amount,
    payment: row.payment,
  };
}

function trainerList() {
  return all('SELECT id, name, phone, email, specialization, availability, is_active FROM trainers WHERE cafe_id = ? ORDER BY name', [CAFE_ID]);
}

export function listShifts() {
  const rows = all<ShiftDbRow>(`SELECT ${SHIFT_COLUMNS} FROM desk_shifts WHERE cafe_id = ? ORDER BY started_at DESC LIMIT 60`, [CAFE_ID]);
  return { shifts: rows.map(mapShift), trainers: trainerList() };
}

export function getShift(id: string) {
  const row = get<ShiftDbRow>(`SELECT ${SHIFT_COLUMNS}, govt_id_url FROM desk_shifts WHERE id = ? AND cafe_id = ?`, [id, CAFE_ID]);
  if (!row) throw new AppError(404, 'SHIFT', 'Shift not found.');
  const sessions = all<SessionRow>('SELECT * FROM trainer_sessions WHERE shift_id = ? ORDER BY session_date, start_time', [id]);
  return { shift: { ...mapShift(row), govtIdUrl: row.govt_id_url ?? '' }, sessions: sessions.map(mapSession), trainers: trainerList() };
}

export function listTrainerSessions(trainerId?: string) {
  const rows = trainerId
    ? all<SessionRow>('SELECT * FROM trainer_sessions WHERE cafe_id = ? AND trainer_id = ? ORDER BY session_date DESC, start_time DESC LIMIT 300', [CAFE_ID, trainerId])
    : all<SessionRow>('SELECT * FROM trainer_sessions WHERE cafe_id = ? ORDER BY session_date DESC, start_time DESC LIMIT 300', [CAFE_ID]);
  return rows.map(mapSession);
}

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function istDaysAgo(days: number) {
  return new Date(Date.parse(`${istToday()}T12:00:00+05:30`) - days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function seedOnce(key: string, fn: () => void) {
  tx(() => {
    if (Number(run('INSERT OR IGNORE INTO seed_marks (id, created_at) VALUES (?, ?)', [key, nowIso()]).changes) > 0) fn();
  });
}

function seedDemoPeople() {
  const first = ['Aarav', 'Anish', 'Diya', 'Ishaan', 'Kavya', 'Rohan', 'Sana', 'Vihaan', 'Anaya', 'Dev', 'Meher', 'Kabir', 'Zara', 'Yash', 'Pia', 'Arjun', 'Nisha', 'Reyansh', 'Tara', 'Om', 'Aisha', 'Vivaan', 'Kiara', 'Siddharth', 'Myra'];
  const last = ['Sharma', 'Patel', 'Nair', 'Khan', 'Iyer', 'Reddy', 'Mehta', 'Singh', 'Joshi', 'Kapoor', 'Desai', 'Banerjee', 'Malhotra', 'Pillai', 'Chowdhury', 'Bose', 'Gill', 'Kulkarni', 'Menon', 'Das'];
  const cities = ['Ahmedabad', 'Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Jaipur', 'Kolkata', 'Mumbai', 'Pune', 'Surat'];
  const sports = [...SIGNUP_ACTIVITIES];
  const planIds = ['plan_monthly', 'plan_quarterly', 'plan_annual', 'plan_student', 'plan_family', 'plan_premium'] as const;
  const courts: Record<string, string> = {
    Badminton: 'Badminton Court 1',
    Basketball: 'Basketball C1',
    Football: 'Football C1',
    Swimming: 'Swimming C1',
    Gym: 'Gym',
    Tennis: 'Tennis Court 1',
    Skating: 'Skating Rink',
    'Table tennis': 'Table Tennis 1',
  };
  const coaches: Record<string, string> = {
    Badminton: 'trainer_head',
    Tennis: 'trainer_arjun',
    Swimming: 'trainer_farah',
    Football: 'trainer_imran',
  };
  const ids = ['Aadhaar', 'Passport', 'Driving licence', 'PAN'];
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM customers WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0;
  for (let i = 0; i < 500; i++) {
    const given = first[i % first.length];
    const family = last[Math.floor(i / first.length) % last.length];
    const name = `${given} ${family}`;
    const id = `demo_mem_${String(i + 1).padStart(3, '0')}`;
    const mobile = String(9710000000 + i);
    const primary = sports[i % sports.length];
    const extra = sports[(i + 3) % sports.length];
    const interest = i % 4 === 0 && extra !== primary ? `${primary} and ${extra}` : primary;
    const bucket = i % 20;
    const status = bucket === 0 ? 'EXPIRED' : bucket === 1 ? 'SUSPENDED' : bucket === 2 ? 'FROZEN' : 'ACTIVE';
    const planId = planIds[i % planIds.length];
    const days = status === 'EXPIRED' ? -(20 + (i % 80)) : bucket === 5 || bucket === 6 ? 3 + (i % 10) : 20 + (i % 300);
    const expires = new Date(Date.now() + days * 86400000).toISOString();
    const starts = new Date(Date.now() - 40 * 86400000).toISOString();
    const coach = i % 3 === 0 ? (coaches[primary] ?? null) : null;
    const created = new Date(Date.now() - (i % 280) * 86400000).toISOString();
    const year = 1978 + (i % 30);
    const month = String((i % 12) + 1).padStart(2, '0');
    const day = String((i % 27) + 1).padStart(2, '0');
    const city = cities[i % cities.length];
    run(
      `INSERT OR IGNORE INTO customers (id, cafe_id, name, mobile, order_count, last_order_at, created_at, email, member_code, membership_status, membership_expires_at, emergency_contact, photo_url, access_interest, govt_id_label, govt_id_url, coach_id, plan_id, frozen_until, notes, dob, city, tags)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, '', ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        CAFE_ID,
        name,
        mobile,
        created,
        `${given.toLowerCase()}.${family.toLowerCase()}.${i + 1}@gymkhana.demo`,
        memberCode(count + i + 1),
        status,
        expires,
        String(9821000000 + (i % 9000)),
        interest,
        `${ids[i % ids.length]} · ending ${String(1000 + (i % 9000)).slice(-4)}`,
        coach,
        planId || null,
        status === 'FROZEN' ? new Date(Date.now() + 14 * 86400000).toISOString() : null,
        `${interest} · ${city} · ${status === 'ACTIVE' ? 'member evenings' : status.toLowerCase()}`,
        `${year}-${month}-${day}`,
        city,
        [primary, planId, status.toLowerCase()].join(','),
      ],
    );
    run(
      `INSERT OR IGNORE INTO memberships (id, cafe_id, customer_id, plan_id, status, starts_at, expires_at, frozen_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`mem_${id}`, CAFE_ID, id, planId, status === 'EXPIRED' ? 'EXPIRED' : status === 'FROZEN' ? 'FROZEN' : status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE', starts, expires, status === 'FROZEN' ? new Date(Date.now() + 14 * 86400000).toISOString() : null, created],
    );
    const court = courts[primary];
    if (court && i % 2 === 0) {
      const visits = 1 + (i % 6);
      for (let v = 0; v < visits; v++) {
        const inAt = new Date(Date.now() - (v + 1) * (1 + (i % 5)) * 86400000 - (v * 3600000)).toISOString();
        const outAt = new Date(new Date(inAt).getTime() + (45 + (i % 90)) * 60000).toISOString();
        run(
          `INSERT OR IGNORE INTO check_ins (id, cafe_id, customer_id, member_name, booking_id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at, checked_in_by)
           VALUES (?, ?, ?, ?, NULL, ?, 'MEMBER', 0, 'UNPAID', ?, ?, 'seed')`,
          [`in_${id}_${v}`, CAFE_ID, id, name, court, inAt, outAt],
        );
      }
    }
    if (court && status === 'ACTIVE' && i % 13 === 0) {
      run(
        `INSERT OR IGNORE INTO check_ins (id, cafe_id, customer_id, member_name, booking_id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at, checked_in_by)
         VALUES (?, ?, ?, ?, NULL, ?, 'MEMBER', 0, 'UNPAID', ?, NULL, 'seed')`,
        [`in_${id}_now`, CAFE_ID, id, name, court, new Date(Date.now() - (20 + (i % 80)) * 60000).toISOString()],
      );
    }
  }
}

type TaskDetails = { category: string; priority: string; assignedTo: string; cost: number };

function taskDetails(body: Record<string, unknown> | undefined, fallback: TaskDetails): TaskDetails {
  const category = String(body?.category ?? fallback.category);
  if (!(TASK_CATEGORIES as readonly string[]).includes(category)) throw new AppError(400, 'MAINTENANCE', 'Choose the kind of work.');
  const priority = String(body?.priority ?? fallback.priority);
  if (!TASK_PRIORITIES.some((row) => row.value === priority)) throw new AppError(400, 'MAINTENANCE', 'Choose the priority.');
  const cost = body?.cost === undefined || body.cost === '' ? fallback.cost : Math.round(Number(body.cost));
  if (!Number.isFinite(cost) || cost < 0 || cost > 10_000_000) throw new AppError(400, 'MAINTENANCE', 'Enter the cost in rupees.');
  return { category, priority, assignedTo: String(body?.assignedTo ?? fallback.assignedTo).trim().slice(0, 80), cost };
}

function saveSessions(shiftId: string, trainerId: string, trainerName: string, sessions: SessionInput[]) {
  const clean = sessions.map((entry, index) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? '') ? entry.date! : istToday();
    const startTime = String(entry.startTime ?? '').trim();
    if (!/^\d{2}:\d{2}$/.test(startTime)) throw new AppError(400, 'SESSION', `Session ${index + 1}: enter the start time.`);
    const minutes = Math.round(Number(entry.minutes ?? 0));
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) throw new AppError(400, 'SESSION', `Session ${index + 1}: enter how many minutes it ran.`);
    const activity = String(entry.activity ?? '').trim();
    if (!activity) throw new AppError(400, 'SESSION', `Session ${index + 1}: enter what the session was.`);
    const people = Math.max(1, Math.min(200, Math.round(Number(entry.people ?? 1)) || 1));
    const amount = Math.max(0, Math.round(Number(entry.amount ?? 0)) || 0);
    return {
      date,
      startTime,
      minutes,
      facility: String(entry.facility ?? '').trim().slice(0, 80),
      activity: activity.slice(0, 120),
      kind: String(entry.kind ?? 'Group class').trim().slice(0, 40) || 'Group class',
      people,
      visitors: String(entry.visitors ?? '').trim().slice(0, 400),
      amount,
      payment: String(entry.payment ?? 'Included in plan').trim().slice(0, 40) || 'Included in plan',
    };
  });
  tx(() => {
    run('DELETE FROM trainer_sessions WHERE shift_id = ?', [shiftId]);
    for (const entry of clean) {
      run(
        `INSERT INTO trainer_sessions (id, cafe_id, shift_id, trainer_id, trainer_name, session_date, start_time, duration_minutes, facility, activity, kind, participants, visitors, amount, payment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), CAFE_ID, shiftId, trainerId, trainerName, entry.date, entry.startTime, entry.minutes, entry.facility, entry.activity, entry.kind, entry.people, entry.visitors, entry.amount, entry.payment, nowIso()],
      );
    }
  });
}

function shiftDetails(input: ShiftInput) {
  const phone = String(input.phone ?? '').trim();
  if (phone && !digits(phone)) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  return {
    phone: phone ? digits(phone) ?? '' : '',
    email: String(input.email ?? '').trim().slice(0, 120),
    roleLabel: String(input.roleLabel ?? '').trim().slice(0, 60),
    govtIdLabel: String(input.govtIdLabel ?? '').trim().slice(0, 80),
    govtIdUrl: String(input.govtIdUrl ?? '').slice(0, 1_500_000),
    areas: String(input.areas ?? '').trim().slice(0, 120),
    notes: String(input.notes ?? '').slice(0, 2000),
  };
}

export function startShift(input: ShiftInput, actor: Actor) {
  const type = input.type === 'TRAINER' ? 'TRAINER' : 'STAFF';
  const trainer = type === 'TRAINER'
    ? get<{ id: string; name: string }>('SELECT id, name FROM trainers WHERE id = ? AND cafe_id = ?', [input.trainerId ?? '', CAFE_ID])
    : null;
  if (type === 'TRAINER' && !trainer) throw new AppError(400, 'TRAINER', 'Choose which trainer is clocking in.');
  const name = String(input.name ?? '').trim() || trainer?.name || '';
  if (name.length < 2) throw new AppError(400, 'NAME', 'Enter the name of the person starting the shift.');
  const subjectId = type === 'TRAINER' ? trainer!.id : `staff:${name.toLowerCase()}`;
  const open = get<{ id: string }>('SELECT id FROM desk_shifts WHERE cafe_id = ? AND subject_type = ? AND subject_id = ? AND ended_at IS NULL', [CAFE_ID, type, subjectId]);
  if (open) throw new AppError(409, 'SHIFT', `${name} is already on shift. Open that shift from the Shift page.`);
  const details = shiftDetails(input);
  const id = randomUUID();
  run(
    `INSERT INTO desk_shifts (id, cafe_id, subject_type, subject_id, subject_name, started_at, ended_at, phone, email, role_label, govt_id_label, govt_id_url, areas, notes, opened_by)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, CAFE_ID, type, subjectId, name, nowIso(), details.phone, details.email, details.roleLabel, details.govtIdLabel, details.govtIdUrl, details.areas, details.notes, actor.name],
  );
  if (type === 'TRAINER' && input.sessions?.length) saveSessions(id, trainer!.id, name, input.sessions);
  audit(actor.name, 'SHIFT_START', 'shift', id, name);
  return getShift(id);
}

export function updateShift(id: string, input: ShiftInput, actor: string) {
  const row = get<{ subject_type: string; subject_id: string; subject_name: string }>('SELECT subject_type, subject_id, subject_name FROM desk_shifts WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
  if (!row) throw new AppError(404, 'SHIFT', 'Shift not found.');
  const name = String(input.name ?? '').trim() || row.subject_name;
  if (name.length < 2) throw new AppError(400, 'NAME', 'Enter the name of the person on shift.');
  const details = shiftDetails(input);
  run(
    'UPDATE desk_shifts SET subject_name = ?, phone = ?, email = ?, role_label = ?, govt_id_label = ?, govt_id_url = ?, areas = ?, notes = ? WHERE id = ?',
    [name, details.phone, details.email, details.roleLabel, details.govtIdLabel, details.govtIdUrl, details.areas, details.notes, id],
  );
  if (row.subject_type === 'TRAINER' && Array.isArray(input.sessions)) saveSessions(id, row.subject_id, name, input.sessions);
  audit(actor, 'SHIFT_EDIT', 'shift', id, name);
  return getShift(id);
}

export function endShift(shiftId: string, actor: string) {
  const row = get('SELECT id FROM desk_shifts WHERE id = ? AND cafe_id = ? AND ended_at IS NULL', [shiftId, CAFE_ID]);
  if (!row) throw new AppError(404, 'SHIFT', 'That shift is already closed.');
  run('UPDATE desk_shifts SET ended_at = ? WHERE id = ?', [nowIso(), shiftId]);
  audit(actor, 'SHIFT_END', 'shift', shiftId, 'Clocked out');
  return listShifts();
}

type TrainerRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  specialization: string;
  availability: string;
  is_active: number;
  govt_id_label: string;
  govt_id_url?: string;
  notes: string;
  offers: string;
  free_slots: string;
};

function mapTrainer(row: TrainerRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? '',
    specialization: row.specialization,
    availability: row.availability,
    isActive: row.is_active === 1,
    govtIdLabel: row.govt_id_label ?? '',
    govtIdUrl: row.govt_id_url ?? '',
    notes: row.notes ?? '',
    offers: row.offers ?? '',
    freeSlots: normalizeSlots(row.free_slots),
  };
}

export function listTrainers() {
  return all<TrainerRow>(
    'SELECT id, name, phone, email, specialization, availability, is_active, govt_id_label, notes, offers, free_slots FROM trainers WHERE cafe_id = ? ORDER BY name',
    [CAFE_ID],
  ).map(mapTrainer);
}

function heldSlots(trainerId: string) {
  return all<{ id: string; name: string; preferred_slot: string }>(
    `SELECT id, name, preferred_slot FROM join_requests
     WHERE cafe_id = ? AND trainer_id = ? AND status = 'APPROVED' AND preferred_slot != ''`,
    [CAFE_ID, trainerId],
  ).map((row) => ({ slot: row.preferred_slot, name: row.name, requestId: row.id }));
}

export function trainerProfile(id: string) {
  const row = get<TrainerRow>('SELECT * FROM trainers WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
  if (!row) throw new AppError(404, 'TRAINER', 'Trainer not found.');
  return {
    trainer: mapTrainer(row),
    classes: all('SELECT id, name, category, schedule, duration_minutes, capacity, price FROM gym_classes WHERE trainer_id = ? ORDER BY name', [id]),
    sessions: listTrainerSessions(id),
    heldSlots: heldSlots(id),
  };
}

export function trainerForStaff(user: { id?: string; email?: string; phone?: string; name?: string } | null | undefined) {
  if (!user) return null;
  if (user.id) {
    const claimed = get<{ trainer_id: string | null }>('SELECT trainer_id FROM users WHERE id = ?', [user.id]);
    if (claimed?.trainer_id) {
      const row = get<TrainerRow>('SELECT * FROM trainers WHERE id = ? AND cafe_id = ?', [claimed.trainer_id, CAFE_ID]);
      if (row) return trainerProfile(row.id);
    }
  }
  const email = String(user.email ?? '').trim().toLowerCase();
  if (email) {
    const byEmail = get<TrainerRow>(
      'SELECT * FROM trainers WHERE cafe_id = ? AND lower(email) = ? LIMIT 1',
      [CAFE_ID, email],
    );
    if (byEmail) return trainerProfile(byEmail.id);
  }
  const phone = digits(String(user.phone ?? ''));
  if (phone) {
    const byPhone = get<TrainerRow>(
      'SELECT * FROM trainers WHERE cafe_id = ? AND phone = ? LIMIT 1',
      [CAFE_ID, phone],
    );
    if (byPhone) return trainerProfile(byPhone.id);
  }
  return null;
}

export function claimTrainerForUser(userId: string, trainerId: string) {
  const trainer = get<TrainerRow>('SELECT * FROM trainers WHERE id = ? AND cafe_id = ? AND is_active = 1', [trainerId, CAFE_ID]);
  if (!trainer) throw new AppError(404, 'TRAINER', 'That trainer is not available.');
  const user = get<{ id: string }>('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) throw new AppError(401, 'AUTH', 'Sign in again.');
  run(
    `UPDATE users SET trainer_id = ?, phone = ?, specialization = ?, name = ? WHERE id = ?`,
    [trainer.id, trainer.phone || '', trainer.specialization || '', trainer.name, userId],
  );
  audit(trainer.name, 'TRAINER_CLAIM', 'trainer', trainer.id, `Desk signed in as ${trainer.name}`);
  return trainerProfile(trainer.id);
}

export function saveMyTrainerSlots(user: { email?: string; phone?: string; name?: string }, freeSlots: unknown, actor: string) {
  const linked = trainerForStaff(user);
  if (!linked?.trainer?.id) throw new AppError(404, 'TRAINER', 'No trainer profile is linked to this login.');
  const trainer = linked.trainer;
  return saveTrainer({
    id: trainer.id,
    name: trainer.name,
    phone: trainer.phone,
    email: trainer.email,
    specialization: trainer.specialization,
    availability: trainer.availability,
    isActive: trainer.isActive,
    govtIdLabel: trainer.govtIdLabel,
    govtIdUrl: trainer.govtIdUrl,
    notes: trainer.notes,
    offers: trainer.offers,
    freeSlots,
  }, actor);
}

export function saveTrainer(input: {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  specialization?: string;
  availability?: string;
  isActive?: boolean;
  govtIdLabel?: string;
  govtIdUrl?: string;
  notes?: string;
  offers?: string;
  freeSlots?: unknown;
}, actor: string) {
  const name = String(input.name ?? '').trim();
  if (name.length < 2) throw new AppError(400, 'NAME', 'Enter the trainer name.');
  const phoneText = String(input.phone ?? '').trim();
  const phone = phoneText ? digits(phoneText) : '';
  if (phoneText && !phone) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  const current = input.id
    ? get<{ id: string; free_slots: string }>('SELECT id, free_slots FROM trainers WHERE id = ? AND cafe_id = ?', [input.id, CAFE_ID])
    : undefined;
  if (input.id && !current) throw new AppError(404, 'TRAINER', 'Trainer not found.');
  const slots = input.freeSlots === undefined ? normalizeSlots(current?.free_slots ?? '') : normalizeSlots(input.freeSlots);
  const availability = slots.length ? summarizeSlots(slots) : String(input.availability ?? '').trim();
  const values = [
    name,
    phone ?? '',
    String(input.email ?? '').trim().slice(0, 120),
    String(input.specialization ?? '').trim().slice(0, 80),
    availability.slice(0, 160),
    input.isActive === false ? 0 : 1,
    String(input.govtIdLabel ?? '').trim().slice(0, 80),
    String(input.govtIdUrl ?? '').slice(0, 1_500_000),
    String(input.notes ?? '').slice(0, 2000),
    String(input.offers ?? '').trim().slice(0, 60),
    JSON.stringify(slots),
  ];
  if (input.id) {
    run(
      'UPDATE trainers SET name = ?, phone = ?, email = ?, specialization = ?, availability = ?, is_active = ?, govt_id_label = ?, govt_id_url = ?, notes = ?, offers = ?, free_slots = ? WHERE id = ?',
      [...values, input.id],
    );
    audit(actor, 'EDIT_TRAINER', 'trainer', input.id, name);
    return trainerProfile(input.id);
  }
  const id = randomUUID();
  run(
    `INSERT INTO trainers (name, phone, email, specialization, availability, is_active, govt_id_label, govt_id_url, notes, offers, free_slots, id, cafe_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...values, id, CAFE_ID],
  );
  audit(actor, 'ADD_TRAINER', 'trainer', id, name);
  return trainerProfile(id);
}

export const ID_TYPES = [...GOVT_ID_TYPES];
const JOIN_OPEN = ['NEW', 'CONTACTED'];

type JoinRow = {
  id: string;
  ref_no: number;
  sport: string;
  name: string;
  mobile: string;
  email: string;
  dob: string;
  govt_id_label: string;
  govt_id_url: string;
  wants_trainer: number;
  trainer_id: string;
  preferred_slot: string;
  plan_id: string;
  amount: number;
  payment_status: string;
  payment_method: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  order_id: string;
  customer_id: string;
  status: string;
  handled_by: string;
  notes: string;
  created_at: string;
  updated_at: string;
  pincode: string;
  is_member: number;
  become_member: number;
  photo_url: string;
  password_hash?: string;
  kind?: string;
  trainer_name: string | null;
  trainer_phone: string | null;
  plan_name: string | null;
  plan_days: number | null;
  order_number: number | null;
};

const JOIN_SELECT = `SELECT r.*, t.name AS trainer_name, t.phone AS trainer_phone, p.name AS plan_name, p.duration_days AS plan_days, o.order_number
  FROM join_requests r
  LEFT JOIN trainers t ON t.id = r.trainer_id
  LEFT JOIN membership_plans p ON p.id = r.plan_id
  LEFT JOIN orders o ON o.id = r.order_id`;

function joinKind(value?: string) {
  if (value === 'SESSION' || value === 'REPORT') return value;
  return 'JOIN';
}

function joinRef(n: number) {
  return `GKJ${String(n).padStart(4, '0')}`;
}

function ageOn(dob: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const born = new Date(`${dob}T00:00:00+05:30`);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date(`${istToday()}T00:00:00+05:30`);
  let years = today.getFullYear() - born.getFullYear();
  const beforeBirthday = today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

function mapJoin(row: JoinRow, withPhoto = false) {
  return {
    id: row.id,
    ref: joinRef(row.ref_no),
    sport: row.sport,
    name: row.name,
    mobile: row.mobile,
    email: row.email,
    dob: row.dob,
    age: ageOn(row.dob),
    govtIdLabel: row.govt_id_label,
    govtIdUrl: withPhoto ? row.govt_id_url : '',
    hasIdPhoto: Boolean(row.govt_id_url),
    wantsTrainer: row.wants_trainer === 1,
    kind: joinKind(row.kind),
    route: row.wants_trainer === 1 ? 'TRAINER' : 'STAFF',
    trainerId: row.trainer_id,
    trainerName: row.trainer_name ?? '',
    trainerPhone: row.trainer_phone ?? '',
    preferredSlot: row.preferred_slot,
    preferredSlotLabel: row.preferred_slot ? requestSlotLabel(row.preferred_slot) : '',
    planId: row.plan_id,
    planName: row.plan_name ?? '',
    planDays: row.plan_days ?? 0,
    amount: row.amount,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    status: row.status,
    handledBy: row.handled_by,
    notes: row.notes,
    pincode: row.pincode ?? '',
    photoUrl: withPhoto ? row.photo_url ?? '' : '',
    hasPortrait: Boolean(row.photo_url),
    hasPassword: Boolean(row.password_hash),
    isMember: row.is_member === 1,
    becomeMember: row.become_member === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function joinRow(id: string) {
  const row = get<JoinRow>(`${JOIN_SELECT} WHERE r.id = ? AND r.cafe_id = ?`, [id, CAFE_ID]);
  if (!row) throw new AppError(404, 'REQUEST', 'Request not found.');
  return row;
}

export function listJoinRequests(route?: string) {
  const filter = route === 'TRAINER' ? 'AND r.wants_trainer = 1' : route === 'STAFF' ? 'AND r.wants_trainer = 0' : '';
  return all<JoinRow>(`${JOIN_SELECT} WHERE r.cafe_id = ? ${filter} ORDER BY r.created_at DESC LIMIT 300`, [CAFE_ID]).map((row) => mapJoin(row));
}

export function getJoinRequest(id: string) {
  return mapJoin(joinRow(id), true);
}

function publicJoin(row: JoinRow) {
  const view = mapJoin(row);
  return {
    id: view.id,
    ref: view.ref,
    sport: view.sport,
    firstName: view.name.split(' ')[0] ?? view.name,
    planName: view.planName,
    planDays: view.planDays,
    amount: view.amount,
    paymentStatus: view.paymentStatus,
    paymentMethod: view.paymentMethod,
    status: view.status,
    wantsTrainer: view.wantsTrainer,
    trainerName: view.trainerName,
    preferredSlotLabel: view.preferredSlotLabel,
    onlinePayment: razorpayEnabled(),
  };
}

export function getPublicJoin(id: string) {
  return publicJoin(joinRow(id));
}

function planCharge(planId: string) {
  const catalog = loadCatalog();
  const quote = priceCart({
    lines: [{ menuItemId: `gym_item_plan_${planId}`, quantity: 1, addonIds: [] }],
    items: catalog.items,
    groups: catalog.addonGroups,
    taxBps: catalog.cafe.taxBps,
  });
  return { subtotal: quote.subtotal, tax: quote.tax, total: quote.total };
}

function heldSlotSet(trainerId: string, ignoreRequest?: string) {
  return new Set(heldSlots(trainerId).filter((row) => row.requestId !== ignoreRequest).map((row) => row.slot));
}

export function joinOptions() {
  const facilities = listFacilities();
  const trainers = listTrainers().filter((trainer) => trainer.isActive);
  const sports = new Map<string, { sport: string; facilities: string[]; trainers: number }>();
  for (const facility of facilities) {
    const key = facility.sport.trim();
    if (!key) continue;
    const entry = sports.get(key.toLowerCase()) ?? { sport: key, facilities: [], trainers: 0 };
    entry.facilities.push(facility.name);
    sports.set(key.toLowerCase(), entry);
  }
  for (const trainer of trainers) {
    const entry = sports.get(trainer.specialization.trim().toLowerCase());
    if (entry) entry.trainers += 1;
  }
  return {
    activities: [...SIGNUP_ACTIVITIES],
    sports: [...sports.values()].sort((a, b) => a.sport.localeCompare(b.sport)),
    plans: listPlans(false).flatMap((plan) => {
      try {
        return [{ ...plan, charge: planCharge(plan.id) }];
      } catch {
        return [];
      }
    }),
    trainers: trainers.map((trainer) => {
      const held = heldSlotSet(trainer.id);
      return {
        id: trainer.id,
        name: trainer.name,
        sport: trainer.specialization,
        offers: trainer.offers,
        availability: trainer.availability,
        freeSlots: trainer.freeSlots.filter((slot) => !held.has(slot)),
      };
    }),
    idTypes: ID_TYPES,
    onlinePayment: razorpayEnabled(),
  };
}

type JoinInput = {
  signup?: unknown;
  sport?: unknown;
  name?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  mobile?: unknown;
  email?: unknown;
  dob?: unknown;
  pincode?: unknown;
  govtIdType?: unknown;
  govtIdNumber?: unknown;
  govtIdLabel?: unknown;
  govtIdUrl?: unknown;
  photoUrl?: unknown;
  passwordHash?: unknown;
  wantsTrainer?: unknown;
  trainerId?: unknown;
  preferredSlot?: unknown;
  planId?: unknown;
  isMember?: unknown;
  becomeMember?: unknown;
  notes?: unknown;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function flag(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function cleanJoin(input: JoinInput, current?: JoinRow) {
  const signup = input.signup === true || input.signup === 'true';
  const sportText = text(input.sport ?? current?.sport);
  const sport = matchActivity(sportText) || listFacilities().find((facility) => facility.sport.trim().toLowerCase() === sportText.toLowerCase())?.sport.trim();
  if (!sport) throw new AppError(400, 'SPORT', 'Choose an activity.');
  const firstName = text(input.firstName);
  const lastName = text(input.lastName);
  const name = (firstName && lastName ? `${firstName} ${lastName}` : text(input.name ?? current?.name)).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw new AppError(400, 'NAME', 'Enter your first and last name.');
  const rawMobile = text(input.mobile ?? current?.mobile);
  const mobile = rawMobile ? digits(rawMobile) ?? '' : '';
  if (rawMobile && !mobile) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  if (!signup && !current && !mobile) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  const email = text(input.email ?? current?.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) throw new AppError(400, 'EMAIL', 'Enter a valid email address.');
  const dob = text(input.dob ?? current?.dob);
  if (dob) {
    const age = ageOn(dob);
    if (age === null || dob >= istToday()) throw new AppError(400, 'DOB', 'Enter your date of birth.');
    if (age < 3 || age > 100) throw new AppError(400, 'DOB', 'Check the date of birth. Members must be between 3 and 100.');
  } else if (!signup && !current) {
    throw new AppError(400, 'DOB', 'Enter your date of birth.');
  }
  const pincode = text(input.pincode ?? current?.pincode).replace(/\D/g, '').slice(0, 6);
  if (pincode && !/^\d{6}$/.test(pincode)) throw new AppError(400, 'PINCODE', 'Enter a 6-digit pincode.');
  if (signup && !mobile && !/^\d{6}$/.test(pincode)) throw new AppError(400, 'PINCODE', 'Enter a 6-digit pincode.');

  let govtIdLabel = text(input.govtIdLabel ?? '');
  if (input.govtIdType !== undefined || input.govtIdNumber !== undefined) {
    const parsed = normalizeGovtId(text(input.govtIdType), text(input.govtIdNumber));
    if ('error' in parsed) throw new AppError(400, 'GOVT_ID', parsed.error || 'Enter a valid ID.');
    govtIdLabel = parsed.label;
  }
  if (!govtIdLabel) govtIdLabel = current?.govt_id_label ?? '';
  let govtIdUrl = current?.govt_id_url ?? '';
  if (input.govtIdUrl !== undefined) {
    const url = text(input.govtIdUrl);
    if (url && (!url.startsWith('data:image/') || url.length > 1_500_000)) throw new AppError(400, 'GOVT_ID', 'Upload a photo of the ID, nothing else.');
    govtIdUrl = url;
  }
  if (signup && !govtIdUrl) throw new AppError(400, 'GOVT_ID', 'Upload a photo of your government ID.');
  if (!govtIdLabel) govtIdLabel = govtIdUrl ? 'Government ID photo' : '';
  if (!govtIdLabel) throw new AppError(400, 'GOVT_ID', 'Upload a photo of your government ID.');
  let photoUrl = current?.photo_url ?? '';
  if (input.photoUrl !== undefined) {
    const url = text(input.photoUrl);
    if (url && (!url.startsWith('data:image/') || url.length > 1_500_000)) throw new AppError(400, 'PHOTO', 'Upload a photograph of yourself.');
    photoUrl = url;
  }
  if (signup && !photoUrl) throw new AppError(400, 'PHOTO', 'Upload a photograph of yourself.');

  const wantsTrainer = flag(input.wantsTrainer, current?.wants_trainer === 1);
  let trainerId = '';
  let preferredSlot = '';
  if (wantsTrainer) {
    trainerId = text(input.trainerId ?? current?.trainer_id);
    preferredSlot = text(input.preferredSlot ?? current?.preferred_slot);
    if (preferredSlot && !normalizeSlots([preferredSlot]).length) throw new AppError(400, 'SLOT', 'Choose one of the listed times.');
    if (trainerId) {
      const trainer = listTrainers().find((row) => row.id === trainerId && row.isActive);
      if (!trainer) throw new AppError(400, 'TRAINER', 'That trainer is not taking requests. Choose another trainer.');
      if (preferredSlot && (!trainer.freeSlots.includes(preferredSlot) || heldSlotSet(trainer.id, current?.id).has(preferredSlot))) {
        throw new AppError(409, 'SLOT', `${trainer.name} is no longer free at ${slotLabel(preferredSlot)}. Choose another time.`);
      }
    }
  }

  const planId = text(input.planId ?? current?.plan_id);
  let amount = current?.amount ?? 0;
  if (!planId) {
    if (!signup && !current) throw new AppError(400, 'PLAN', 'Choose a membership plan.');
    amount = 0;
  } else {
    const plan = get<{ id: string; is_active: number }>('SELECT id, is_active FROM membership_plans WHERE id = ? AND cafe_id = ?', [planId, CAFE_ID]);
    if (!plan || (plan.is_active !== 1 && planId !== current?.plan_id)) throw new AppError(400, 'PLAN', 'Choose a membership plan.');
    if (current && current.payment_status !== 'UNPAID' && planId !== current.plan_id) {
      throw new AppError(409, 'PLAN', 'The plan is already paid for. Decline and refund the request to change it.');
    }
    if (!current || current.payment_status === 'UNPAID') {
      try {
        amount = planCharge(planId).total;
      } catch {
        throw new AppError(409, 'CATALOG', 'This plan is not on the register yet. Ask the desk to add it.');
      }
    }
  }
  const notes = input.notes === undefined ? current?.notes ?? '' : text(input.notes).slice(0, 2000);
  const isMember = flag(input.isMember, current?.is_member === 1);
  const becomeMember = flag(input.becomeMember, current?.become_member === 1);
  const incomingHash = text(input.passwordHash);
  const passwordHash = incomingHash.startsWith('scrypt$') ? incomingHash : current?.password_hash ?? '';
  return { sport, name, mobile, email, dob, pincode, govtIdLabel: govtIdLabel.slice(0, 80), govtIdUrl, photoUrl, wantsTrainer, trainerId, preferredSlot, planId, amount, isMember, becomeMember, notes, passwordHash };
}

export function createJoinRequest(input: JoinInput, actor = 'Website') {
  const clean = cleanJoin({ ...input, notes: undefined });
  const stamp = nowIso();
  const recent = clean.mobile
    ? get<JoinRow>(
      `${JOIN_SELECT} WHERE r.cafe_id = ? AND r.mobile = ? AND r.payment_status = 'UNPAID' AND r.status = 'NEW' AND r.created_at > ? ORDER BY r.created_at DESC LIMIT 1`,
      [CAFE_ID, clean.mobile, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()],
    )
    : undefined;
  const id = recent?.id ?? randomUUID();
  if (recent) {
    run(
      `UPDATE join_requests SET sport = ?, name = ?, email = ?, dob = ?, pincode = ?, govt_id_label = ?, govt_id_url = ?, photo_url = ?, password_hash = ?, wants_trainer = ?, trainer_id = ?, preferred_slot = ?, plan_id = ?, amount = ?, is_member = ?, become_member = ?, razorpay_order_id = '', updated_at = ? WHERE id = ?`,
      [clean.sport, clean.name, clean.email, clean.dob, clean.pincode, clean.govtIdLabel, clean.govtIdUrl, clean.photoUrl, clean.passwordHash, clean.wantsTrainer ? 1 : 0, clean.trainerId, clean.preferredSlot, clean.planId, clean.amount, clean.isMember ? 1 : 0, clean.becomeMember ? 1 : 0, stamp, id],
    );
    audit(actor, 'JOIN_UPDATED', 'join', id, 'Applicant changed the request');
    return getPublicJoin(id);
  }
  const ref = (get<{ n: number | null }>('SELECT MAX(ref_no) AS n FROM join_requests WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0) + 1;
  run(
    `INSERT INTO join_requests (id, cafe_id, ref_no, sport, name, mobile, email, dob, pincode, govt_id_label, govt_id_url, photo_url, password_hash, wants_trainer, trainer_id, preferred_slot, plan_id, amount, is_member, become_member, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, CAFE_ID, ref, clean.sport, clean.name, clean.mobile, clean.email, clean.dob, clean.pincode, clean.govtIdLabel, clean.govtIdUrl, clean.photoUrl, clean.passwordHash, clean.wantsTrainer ? 1 : 0, clean.trainerId, clean.preferredSlot, clean.planId, clean.amount, clean.isMember ? 1 : 0, clean.becomeMember ? 1 : 0, stamp, stamp],
  );
  const row = joinRow(id);
  const who = clean.wantsTrainer ? (row.trainer_name ? `wants ${row.trainer_name}` : 'wants a trainer') : 'no trainer';
  audit(actor, 'JOIN_REQUEST', 'join', id, `${row.plan_name ?? 'Plan'} · ${clean.sport} · ${who}`);
  notify(
    clean.wantsTrainer ? 'trainers' : 'staff',
    clean.wantsTrainer ? 'New trainer request' : 'New membership request',
    `${joinRef(ref)} · ${clean.name} · ${clean.sport} · ${row.plan_name ?? ''} · ${clean.mobile}`,
  );
  return publicJoin(row);
}

function portalCustomer(customerId: string) {
  const customer = get<{
    id: string;
    name: string;
    mobile: string;
    email: string;
    dob: string;
    photo_url: string;
    govt_id_label: string;
    govt_id_url: string;
    plan_id: string | null;
    access_interest: string;
  }>(
    'SELECT id, name, mobile, email, dob, photo_url, govt_id_label, govt_id_url, plan_id, access_interest FROM customers WHERE id = ? AND cafe_id = ?',
    [customerId, CAFE_ID],
  );
  if (!customer) throw new AppError(401, 'AUTH', 'Sign in to continue.');
  return customer;
}

function memberNote(parts: Array<string | undefined>) {
  return parts.map((part) => text(part).slice(0, 400)).filter(Boolean).join('\n').slice(0, 2000);
}

export function listMemberSessions(customerId: string) {
  return all<JoinRow>(
    `${JOIN_SELECT} WHERE r.cafe_id = ? AND r.customer_id = ? AND r.kind = 'SESSION' ORDER BY r.created_at DESC LIMIT 120`,
    [CAFE_ID, customerId],
  ).map((row) => mapJoin(row));
}

export function createSessionRequest(customerId: string, input: { sport?: string; startAt?: string; purpose?: string; remarks?: string }) {
  const customer = portalCustomer(customerId);
  const sport = matchActivity(text(input.sport));
  if (!sport) throw new AppError(400, 'SPORT', 'Choose a venue.');
  const start = new Date(String(input.startAt ?? ''));
  if (Number.isNaN(start.getTime())) throw new AppError(400, 'TIME', 'Choose a date and time.');
  const stamp = nowIso();
  const id = randomUUID();
  const ref = (get<{ n: number | null }>('SELECT MAX(ref_no) AS n FROM join_requests WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0) + 1;
  const planId = customer.plan_id || 'plan_annual';
  const notes = memberNote([text(input.purpose) || 'Session booking', input.remarks]);
  run(
    `INSERT INTO join_requests (id, cafe_id, ref_no, sport, name, mobile, email, dob, pincode, govt_id_label, govt_id_url, photo_url, password_hash, wants_trainer, trainer_id, preferred_slot, plan_id, amount, is_member, become_member, kind, customer_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', 0, '', ?, ?, 0, 1, 0, 'SESSION', ?, ?, ?, ?)`,
    [id, CAFE_ID, ref, sport, customer.name, customer.mobile, customer.email, customer.dob, customer.govt_id_label || 'Session', customer.govt_id_url, customer.photo_url, start.toISOString(), planId, customerId, notes, stamp, stamp],
  );
  audit('Website', 'SESSION_REQUEST', 'join', id, `${customer.name} · ${sport} · ${requestSlotLabel(start.toISOString())}`);
  notify('staff', 'New session request', `${joinRef(ref)} · ${customer.name} · ${sport} · ${requestSlotLabel(start.toISOString())}`);
  return getJoinRequest(id);
}

export function createReportRequest(customerId: string, input: { issue?: string; remarks?: string }) {
  const customer = portalCustomer(customerId);
  const issue = text(input.issue).slice(0, 800);
  if (issue.length < 4) throw new AppError(400, 'REPORT', 'Say what the issue is.');
  const stamp = nowIso();
  const id = randomUUID();
  const ref = (get<{ n: number | null }>('SELECT MAX(ref_no) AS n FROM join_requests WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0) + 1;
  const planId = customer.plan_id || 'plan_annual';
  const sport = listedArenas(customer.access_interest)[0] || 'Gym';
  const notes = memberNote([issue, input.remarks]);
  run(
    `INSERT INTO join_requests (id, cafe_id, ref_no, sport, name, mobile, email, dob, pincode, govt_id_label, govt_id_url, photo_url, password_hash, wants_trainer, trainer_id, preferred_slot, plan_id, amount, is_member, become_member, kind, customer_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'Report', ?, ?, '', 0, '', '', ?, 0, 1, 0, 'REPORT', ?, ?, ?, ?)`,
    [id, CAFE_ID, ref, sport, customer.name, customer.mobile, customer.email, customer.dob, customer.govt_id_url, customer.photo_url, planId, customerId, notes, stamp, stamp],
  );
  audit('Website', 'REPORT_FILED', 'join', id, `${customer.name} · ${issue.slice(0, 80)}`);
  notify('staff', 'Member report', `${joinRef(ref)} · ${customer.name} · ${issue.slice(0, 80)}`);
  return getJoinRequest(id);
}

export async function startJoinPayment(id: string) {
  const row = joinRow(id);
  if (row.payment_status === 'PAID') throw new AppError(409, 'PAYMENT', 'This request is already paid.');
  if (!JOIN_OPEN.includes(row.status)) throw new AppError(409, 'PAYMENT', 'This request is closed. Contact the desk.');
  if (!razorpayEnabled()) throw new AppError(503, 'PAYMENTS', 'Online payment is not switched on. Pay at reception.');
  try {
    const order = await createRazorpayOrder(row.amount * 100, `join-${joinRef(row.ref_no)}`);
    run('UPDATE join_requests SET razorpay_order_id = ?, updated_at = ? WHERE id = ?', [order.id, nowIso(), id]);
    return {
      requestId: id,
      amount: order.amount,
      currency: order.currency,
      razorpayOrderId: order.id,
      razorpayKeyId: publicRazorpayKey(),
      venue: loadCatalog().cafe.name,
      description: `${row.plan_name ?? 'Membership'} · ${row.sport}`,
      prefill: { name: row.name, email: row.email, contact: row.mobile },
    };
  } catch (error) {
    if (error instanceof RazorpayError) throw new AppError(503, 'PAYMENTS', error.message);
    throw error;
  }
}

function ensureJoinCustomer(row: JoinRow, actor: string) {
  const existing = row.customer_id
    ? get<{ id: string; member_code: string }>('SELECT id, member_code FROM customers WHERE id = ? AND cafe_id = ?', [row.customer_id, CAFE_ID])
    : row.mobile
      ? get<{ id: string; member_code: string }>('SELECT id, member_code FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, row.mobile])
      : undefined;
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM customers WHERE cafe_id = ?', [CAFE_ID])?.n ?? 0;
  const interest = row.wants_trainer === 1 ? `${row.sport} with a trainer` : row.sport;
  if (existing) {
    run(
      `UPDATE customers SET name = ?, email = ?, dob = ?, govt_id_label = ?,
         photo_url = CASE WHEN ? != '' THEN ? ELSE photo_url END,
         govt_id_url = CASE WHEN ? != '' THEN ? ELSE govt_id_url END,
         access_interest = CASE WHEN IFNULL(access_interest, '') = '' THEN ? ELSE access_interest END,
         coach_id = CASE WHEN ? != '' THEN ? ELSE coach_id END,
         member_code = CASE WHEN IFNULL(member_code, '') = '' THEN ? ELSE member_code END
       WHERE id = ?`,
      [row.name, row.email, row.dob, row.govt_id_label, row.photo_url, row.photo_url, row.govt_id_url, row.govt_id_url, interest, row.trainer_id, row.trainer_id, memberCode(count + 1), existing.id],
    );
    return existing.id;
  }
  const id = randomUUID();
  run(
    `INSERT INTO customers (id, cafe_id, name, mobile, order_count, last_order_at, created_at, email, member_code, membership_status, emergency_contact, photo_url, access_interest, govt_id_label, govt_id_url, coach_id, dob)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, 'PENDING', '', ?, ?, ?, ?, ?, ?)`,
    [id, CAFE_ID, row.name, row.mobile, nowIso(), row.email, memberCode(count + 1), row.photo_url ?? '', interest, row.govt_id_label, row.govt_id_url, row.trainer_id || null, row.dob],
  );
  audit(actor, 'ADD_MEMBER', 'member', id, `${row.name} · from ${joinRef(row.ref_no)}`);
  return id;
}

function settleJoin(row: JoinRow, method: 'CASH' | 'UPI' | 'CARD', label: string, paymentId: string, actor: string) {
  const customerId = ensureJoinCustomer(row, actor);
  const order = createStaffOrder({
    customerName: row.name,
    customerMobile: row.mobile,
    items: [{ menuItemId: `gym_item_plan_${row.plan_id}`, quantity: 1, addonIds: [] }],
    notes: `MEMBERSHIP:${row.plan_id} REQUEST:${joinRef(row.ref_no)}`,
  });
  markPaid(order.id, method, order.total);
  run('UPDATE orders SET customer_id = ? WHERE id = ?', [customerId, order.id]);
  run(
    `UPDATE join_requests SET payment_status = 'PAID', payment_method = ?, razorpay_payment_id = ?, order_id = ?, customer_id = ?, updated_at = ? WHERE id = ?`,
    [label, paymentId, order.id, customerId, nowIso(), row.id],
  );
  audit(actor, 'JOIN_PAID', 'join', row.id, `${label} · bill ${order.orderNumber ?? ''}`.trim());
  comms.emitGymEvent('PAYMENT_SUCCESS', {
    entity: 'order',
    entityId: order.id,
    customerId,
    extra: {
      amount: `₹${row.amount}`,
      transaction_id: (paymentId || order.id).slice(0, 8),
      payment_date: comms.kolkataYmd(),
      membership_ref: row.plan_name ?? 'Membership',
    },
  });
  return customerId;
}

export function confirmJoinPayment(id: string, razorpayOrderId: string, razorpayPaymentId: string, signature: string) {
  const row = joinRow(id);
  if (row.payment_status === 'PAID') {
    if (row.razorpay_payment_id === razorpayPaymentId) return publicJoin(row);
    throw new AppError(409, 'PAYMENT', 'This request is already paid.');
  }
  if (!row.razorpay_order_id || row.razorpay_order_id !== razorpayOrderId) {
    throw new AppError(409, 'PAYMENT', 'This payment does not match the request. Start the payment again.');
  }
  try {
    verifyRazorpayPayment(razorpayOrderId, razorpayPaymentId, signature);
  } catch (error) {
    if (row.customer_id) {
      comms.emitGymEvent('PAYMENT_FAILED', {
        entity: 'join',
        entityId: row.id,
        customerId: row.customer_id,
        extra: {
          amount: `₹${row.amount}`,
          transaction_id: razorpayPaymentId.slice(0, 8),
          payment_date: comms.kolkataYmd(),
        },
      });
    }
    if (error instanceof RazorpayError) throw new AppError(422, 'PAYMENTS', error.message);
    throw error;
  }
  tx(() => settleJoin(row, 'UPI', 'Online', razorpayPaymentId, 'Website'));
  notify(
    row.wants_trainer === 1 ? 'trainers' : 'staff',
    'Membership paid online',
    `${joinRef(row.ref_no)} · ${row.name} paid ₹${row.amount} for ${row.plan_name ?? 'a plan'}`,
  );
  return getPublicJoin(id);
}

export function updateJoinRequest(id: string, input: JoinInput, actor: string) {
  const current = joinRow(id);
  if (current.status === 'APPROVED') {
    run('UPDATE join_requests SET notes = ?, updated_at = ? WHERE id = ?', [text(input.notes ?? current.notes).slice(0, 2000), nowIso(), id]);
    return getJoinRequest(id);
  }
  const clean = cleanJoin(input, current);
  run(
    `UPDATE join_requests SET sport = ?, name = ?, mobile = ?, email = ?, dob = ?, pincode = ?, govt_id_label = ?, govt_id_url = ?, photo_url = ?, wants_trainer = ?, trainer_id = ?, preferred_slot = ?, plan_id = ?, amount = ?, is_member = ?, become_member = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [clean.sport, clean.name, clean.mobile, clean.email, clean.dob, clean.pincode, clean.govtIdLabel, clean.govtIdUrl, clean.photoUrl, clean.wantsTrainer ? 1 : 0, clean.trainerId, clean.preferredSlot, clean.planId, clean.amount, clean.isMember ? 1 : 0, clean.becomeMember ? 1 : 0, clean.notes, nowIso(), id],
  );
  if (clean.planId !== current.plan_id) run(`UPDATE join_requests SET razorpay_order_id = '' WHERE id = ?`, [id]);
  audit(actor, 'JOIN_EDIT', 'join', id, 'Details updated');
  return getJoinRequest(id);
}

export function markJoinContacted(id: string, actor: string) {
  const row = joinRow(id);
  if (!JOIN_OPEN.includes(row.status)) throw new AppError(409, 'REQUEST', 'This request is already closed.');
  run(`UPDATE join_requests SET status = 'CONTACTED', handled_by = ?, updated_at = ? WHERE id = ?`, [actor, nowIso(), id]);
  audit(actor, 'JOIN_CONTACTED', 'join', id, row.mobile);
  return getJoinRequest(id);
}

export function approveJoinRequest(id: string, method: string | undefined, actor: string, notes?: string, assignTrainerId?: string) {
  let row = joinRow(id);
  if (!JOIN_OPEN.includes(row.status)) throw new AppError(409, 'REQUEST', 'This request is already closed.');
  if (row.kind !== 'REPORT' && assignTrainerId) {
    const trainer = get<{ id: string; name: string }>('SELECT id, name FROM trainers WHERE id = ? AND cafe_id = ? AND is_active = 1', [assignTrainerId, CAFE_ID]);
    if (!trainer) throw new AppError(400, 'TRAINER', 'That trainer is not available.');
    if (!row.trainer_id || row.trainer_id !== trainer.id || row.wants_trainer !== 1) {
      run(`UPDATE join_requests SET trainer_id = ?, wants_trainer = 1, updated_at = ? WHERE id = ?`, [trainer.id, nowIso(), id]);
      row = joinRow(id);
    }
  }
  if (row.kind === 'REPORT') {
    run(
      `UPDATE join_requests SET status = 'APPROVED', handled_by = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
      [actor, notes === undefined ? null : notes.slice(0, 2000), nowIso(), id],
    );
    audit(actor, 'REPORT_SEEN', 'join', id, row.name);
    return getJoinRequest(id);
  }
  if (row.kind === 'SESSION') {
    if (!row.customer_id) throw new AppError(400, 'MEMBER', 'This session is not tied to a member.');
    if (!row.preferred_slot || Number.isNaN(Date.parse(row.preferred_slot))) throw new AppError(400, 'TIME', 'This session has no time.');
    const facility = facilityForSport(row.sport);
    if (!facility) throw new AppError(400, 'FACILITY', 'No court is set up for that sport.');
    const customer = get<{ name: string; mobile: string }>('SELECT name, mobile FROM customers WHERE id = ?', [row.customer_id]);
    const trainerName = row.trainer_id
      ? get<{ name: string }>('SELECT name FROM trainers WHERE id = ?', [row.trainer_id])?.name
      : '';
    if (row.trainer_id) run('UPDATE customers SET coach_id = ? WHERE id = ?', [row.trainer_id, row.customer_id]);
    createBooking({
      facilityId: facility.id,
      customerId: row.customer_id,
      memberName: customer?.name || row.name,
      memberMobile: customer?.mobile || row.mobile,
      startAt: row.preferred_slot,
      notes: [row.notes || 'Member session request', trainerName ? `Trainer: ${trainerName}` : ''].filter(Boolean).join('\n'),
    }, actor);
    run(
      `UPDATE join_requests SET status = 'APPROVED', handled_by = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
      [actor, notes === undefined ? null : notes.slice(0, 2000), nowIso(), id],
    );
    audit(actor, 'SESSION_APPROVED', 'join', id, `${row.sport} · ${requestSlotLabel(row.preferred_slot)}${trainerName ? ` · ${trainerName}` : ''}`);
    return getJoinRequest(id);
  }
  if (row.wants_trainer === 1 && !row.trainer_id) throw new AppError(400, 'TRAINER', 'Choose a trainer before approving.');
  const trainerSimple = Boolean(assignTrainerId) && row.wants_trainer === 1;
  if (!row.plan_id) {
    if (trainerSimple) {
      const fallback = get<{ id: string; price: number }>('SELECT id, price FROM membership_plans WHERE cafe_id = ? AND is_active = 1 ORDER BY duration_days ASC, price ASC LIMIT 1', [CAFE_ID])
        ?? get<{ id: string; price: number }>('SELECT id, price FROM membership_plans WHERE id = ?', ['plan_monthly']);
      if (!fallback) throw new AppError(400, 'PLAN', 'No membership plan is set up yet.');
      run(`UPDATE join_requests SET plan_id = ?, amount = ?, updated_at = ? WHERE id = ?`, [fallback.id, fallback.price, nowIso(), id]);
      row = joinRow(id);
    } else {
      throw new AppError(400, 'PLAN', 'Choose a membership plan before approving.');
    }
  }
  if (!row.mobile) {
    if (trainerSimple) {
      const stub = `0${String(row.ref_no).replace(/\D/g, '').padStart(9, '0').slice(-9)}`;
      run(`UPDATE join_requests SET mobile = ?, updated_at = ? WHERE id = ?`, [stub, nowIso(), id]);
      row = joinRow(id);
    } else {
      throw new AppError(400, 'MOBILE', 'Enter a phone number before approving.');
    }
  }
  if (row.wants_trainer === 1 && row.preferred_slot && heldSlotSet(row.trainer_id, row.id).has(row.preferred_slot)) {
    if (trainerSimple) {
      run(`UPDATE join_requests SET preferred_slot = '', updated_at = ? WHERE id = ?`, [nowIso(), id]);
      row = joinRow(id);
    } else {
      throw new AppError(409, 'SLOT', `${row.trainer_name ?? 'The trainer'} already has someone at ${slotLabel(row.preferred_slot)}. Pick another time first.`);
    }
  }
  const pay = method === 'CASH' || method === 'UPI' || method === 'CARD' ? method : null;
  const trainerApproveWithoutPay = row.wants_trainer === 1 && !pay && row.payment_status !== 'PAID';
  if (row.payment_status !== 'PAID' && !pay && row.wants_trainer !== 1) {
    throw new AppError(400, 'PAYMENT', 'Choose how the payment was taken: cash, UPI, or card.');
  }
  tx(() => {
    const customerId = row.payment_status === 'PAID' || trainerApproveWithoutPay
      ? ensureJoinCustomer(row, actor)
      : settleJoin(row, pay!, pay === 'CASH' ? 'Cash' : pay === 'UPI' ? 'UPI' : 'Card', '', actor);
    if (!activeMembership(customerId)?.active) assignPlan(customerId, row.plan_id, actor);
    if (row.trainer_id) run('UPDATE customers SET coach_id = ? WHERE id = ?', [row.trainer_id, customerId]);
    run(`UPDATE join_requests SET status = 'APPROVED', customer_id = ?, handled_by = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`, [customerId, actor, notes === undefined ? null : notes.slice(0, 2000), nowIso(), id]);
  });
  audit(actor, 'JOIN_APPROVED', 'join', id, trainerApproveWithoutPay
    ? `${row.plan_name ?? 'Plan'} · trainer assigned · payment due at desk`
    : `${row.plan_name ?? 'Plan'} is active`);
  const approved = getJoinRequest(id);
  if (row.trainer_id && approved.customerId) {
    const trainer = get<{ name: string; specialization: string }>('SELECT name, specialization FROM trainers WHERE id = ?', [row.trainer_id]);
    comms.emitGymEvent('TRAINER_ASSIGNED', {
      entity: 'trainer',
      entityId: row.trainer_id,
      customerId: approved.customerId,
      extra: {
        trainer_name: trainer?.name || 'Trainer',
        sport: trainer?.specialization ? ` for ${trainer.specialization}` : '',
      },
    });
    if (row.preferred_slot) {
      comms.emitGymEvent('SESSION_SCHEDULED', {
        entity: 'session',
        entityId: `${id}:${row.preferred_slot}`,
        customerId: approved.customerId,
        extra: {
          trainer_name: trainer?.name || 'Trainer',
          session_date: comms.kolkataYmd(),
          start_time: slotLabel(row.preferred_slot),
          location: row.sport,
          session_ref: id.slice(0, 8),
        },
      });
    }
  }
  return approved;
}

export function declineJoinRequest(id: string, reason: string, actor: string, notes?: string) {
  const row = joinRow(id);
  if (row.status === 'APPROVED') throw new AppError(409, 'REQUEST', 'This request is approved. Change the membership from the visitor record.');
  if (row.status === 'DECLINED') throw new AppError(409, 'REQUEST', 'This request is already declined.');
  tx(() => {
    if (row.payment_status === 'PAID' && row.order_id) {
      run(
        'INSERT INTO payments (id, order_id, method, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [randomUUID(), row.order_id, 'OTHER', row.amount, 'REFUNDED', nowIso()],
      );
      run(`UPDATE orders SET payment_status = 'REFUNDED', updated_at = ? WHERE id = ?`, [nowIso(), row.order_id]);
      run(`UPDATE join_requests SET payment_status = 'REFUNDED' WHERE id = ?`, [id]);
    }
    run(`UPDATE join_requests SET status = 'DECLINED', handled_by = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`, [actor, notes === undefined ? null : notes.slice(0, 2000), nowIso(), id]);
  });
  const refund = row.payment_status === 'PAID' ? ' Refund recorded on the bill. Razorpay is not refunded automatically, so send it from the Razorpay dashboard.' : '';
  audit(actor, 'JOIN_DECLINED', 'join', id, `${reason.trim().slice(0, 200) || 'Declined'}.${refund}`);
  return { request: getJoinRequest(id), note: refund.trim() };
}

function ensureCategory(id: string, name: string, sort: number) {
  run(
    'INSERT OR IGNORE INTO menu_categories (id, cafe_id, name, sort_order) VALUES (?, ?, ?, ?)',
    [id, CAFE_ID, name, sort],
  );
}

function ensureItem(id: string, categoryId: string, name: string, description: string, price: number, sheet: string) {
  const existing = get('SELECT id FROM menu_items WHERE id = ?', [id]);
  const stamp = nowIso();
  if (!existing) {
    run(
      `INSERT INTO menu_items (id, cafe_id, category_id, name, description, price, image_url, is_veg, is_available, is_favorite, shortcut_num, shortcut_alpha, sort_order, updated_at, sheet_json)
       VALUES (?, ?, ?, ?, ?, ?, '', 1, 1, 0, NULL, NULL, 50, ?, ?)`,
      [id, CAFE_ID, categoryId, name, description, price, stamp, sheet],
    );
  } else {
    run('UPDATE menu_items SET is_available = 1, category_id = ?, price = ?, description = ?, sheet_json = ? WHERE id = ?', [categoryId, price, description, sheet, id]);
  }
}

export function seedGymkhana() {
  run(`UPDATE users SET role = 'SUPER_ADMIN' WHERE id = 'user_staff' AND role = 'staff'`);
  run(`UPDATE pos_configs SET name = 'Gymkhana' WHERE cafe_id = ? AND name = 'Restaurant'`, [CAFE_ID]);
  const staffPassword = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', ['user_staff']);
  const extras: { id: string; name: string; email: string; role: string; phone: string; specialization: string }[] = [
    { id: 'user_manager', name: 'Gymkhana Manager', email: 'manager@gymkhana.local', role: 'MANAGER', phone: '9000000001', specialization: 'Operations' },
    { id: 'user_reception', name: 'Reception', email: 'reception@gymkhana.local', role: 'RECEPTIONIST', phone: '9000000002', specialization: 'Front desk' },
    { id: 'user_cashier', name: 'Cashier', email: 'cashier@gymkhana.local', role: 'CASHIER', phone: '9000000003', specialization: 'Payments' },
    { id: 'user_coach', name: 'Neha Kapoor', email: 'neha.kapoor@gymkhana.local', role: 'COACH', phone: '9810000001', specialization: 'Badminton' },
    { id: 'user_facility', name: 'Facility Manager', email: 'facilities@gymkhana.local', role: 'FACILITY_MANAGER', phone: '9000000005', specialization: 'Courts' },
    { id: 'user_inventory', name: 'Inventory', email: 'inventory@gymkhana.local', role: 'INVENTORY_MANAGER', phone: '9000000006', specialization: 'Stores' },
  ];
  if (staffPassword) {
    for (const user of extras) {
      run(
        `INSERT OR IGNORE INTO users (id, cafe_id, name, email, password_hash, role, created_at, phone, specialization, schedule_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user.id, CAFE_ID, user.name, user.email, staffPassword.password_hash, user.role, nowIso(), user.phone, user.specialization, 'Mon–Sat 08:00–18:00'],
      );
      run(
        `UPDATE users SET name = ?, email = ?, role = ?, phone = ?, specialization = ? WHERE id = ?`,
        [user.name, user.email, user.role, user.phone, user.specialization, user.id],
      );
    }
  }
  const facilities = [
    ['fac_badminton', 'Badminton Court 1', 'Badminton', 'Indoor hall', 4, 400, 600, 'BOOKING'],
    ['fac_badminton_2', 'Badminton Court 2', 'Badminton', 'Indoor hall', 4, 400, 600, 'BOOKING'],
    ['fac_tennis', 'Tennis Court 1', 'Tennis', 'Outdoor', 4, 700, 1000, 'BOOKING'],
    ['fac_pool', 'Swimming C1', 'Swimming', 'Pool deck', 30, 200, 350, 'EITHER'],
    ['fac_pool_2', 'Swimming C2', 'Swimming', 'Pool deck', 30, 200, 350, 'EITHER'],
    ['fac_basketball', 'Basketball C1', 'Basketball', 'Main court', 10, 800, 1200, 'BOOKING'],
    ['fac_basketball_2', 'Basketball C2', 'Basketball', 'Main court', 10, 800, 1200, 'BOOKING'],
    ['fac_squash', 'Squash Court', 'Squash', 'Indoor', 2, 350, 500, 'BOOKING'],
    ['fac_gym', 'Gym', 'Fitness', 'Strength floor', 40, 0, 150, 'MEMBERSHIP'],
    ['fac_football', 'Football C1', 'Football', 'Field', 22, 2500, 4000, 'BOOKING'],
    ['fac_football_2', 'Football C2', 'Football', 'Field', 22, 2500, 4000, 'BOOKING'],
    ['fac_skating', 'Skating Rink', 'Skating', 'Outdoor rink', 20, 300, 450, 'EITHER'],
    ['fac_table_tennis', 'Table Tennis 1', 'Table tennis', 'Indoor hall', 8, 200, 350, 'BOOKING'],
    ['fac_table_tennis_2', 'Table Tennis 2', 'Table tennis', 'Indoor hall', 8, 200, 350, 'BOOKING'],
  ] as const;
  for (const [id, name, sport, location, capacity, memberPrice, guestPrice, access] of facilities) {
    run(
      `INSERT OR IGNORE INTO facilities (id, cafe_id, name, sport, image_url, location, description, capacity, opens_at, closes_at, slot_minutes, member_price, guest_price, is_available, maintenance_status, access_rule, updated_at)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, '06:00', '22:00', 60, ?, ?, 1, 'OK', ?, ?)`,
      [id, CAFE_ID, name, sport, location, `${name} at Gymkhana`, capacity, memberPrice, guestPrice, access, nowIso()],
    );
  }
  run(`UPDATE facilities SET name = 'Football C1' WHERE id = 'fac_football' AND name = 'Football Ground'`);
  run(`UPDATE facilities SET name = 'Basketball C1' WHERE id = 'fac_basketball' AND name = 'Basketball Court'`);
  run(`UPDATE facilities SET name = 'Swimming C1' WHERE id = 'fac_pool' AND name = 'Swimming Pool'`);
  run(`UPDATE check_ins SET facility_name = 'Football C1' WHERE facility_name = 'Football Ground'`);
  run(`UPDATE check_ins SET facility_name = 'Swimming C1' WHERE facility_name = 'Swimming Pool'`);
  const plans = [
    ['plan_monthly', 'Monthly', 30, 2500, 'Court and gym access for 30 days.', 500, 1, 0],
    ['plan_quarterly', 'Quarterly', 90, 6500, 'Three months of member pricing.', 800, 2, 7],
    ['plan_annual', 'Annual', 365, 18000, 'Full-year access and guest passes.', 1000, 6, 30],
    ['plan_student', 'Student', 30, 1500, 'Student rate with a valid ID check at the desk.', 500, 0, 0],
    ['plan_family', 'Family', 365, 32000, 'Two adults and two children on one plan.', 1000, 4, 14],
    ['plan_premium', 'Premium', 365, 42000, 'Priority booking and coaching discount.', 1500, 8, 30],
  ] as const;
  for (const [id, name, days, price, description, discount, guests, freeze] of plans) {
    run(
      `INSERT OR IGNORE INTO membership_plans (id, cafe_id, name, duration_days, price, description, facility_access, booking_privileges, discount_bps, guest_passes, renewal_days, freeze_days, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ALL', 'Member pricing on facilities', ?, ?, 7, ?, 1, ?)`,
      [id, CAFE_ID, name, days, price, description, discount, guests, freeze, nowIso()],
    );
  }
  const categories: [string, string, number][] = [
    ['cat_facility', 'Facility Bookings', 20],
    ['cat_membership', 'Memberships', 21],
    ['cat_classes', 'Classes', 22],
    ['cat_coaching', 'Coaching', 23],
    ['cat_rentals', 'Equipment Rentals', 24],
    ['cat_merch', 'Merchandise', 25],
    ['cat_refreshments', 'Refreshments', 26],
    ['cat_other_services', 'Other Services', 27],
  ];
  for (const [id, name, sort] of categories) ensureCategory(id, name, sort);
  for (const facility of listFacilities()) {
    ensureItem(`gym_item_${facility.id}`, 'cat_facility', facility.name, facility.description, facility.guestPrice, JSON.stringify({ productType: 'service', tags: `facility:${facility.id}`, reference: facility.id, pos: true, sales: true }));
  }
  for (const plan of listPlans()) {
    ensureItem(`gym_item_plan_${plan.id}`, 'cat_membership', `${plan.name} membership`, plan.description, plan.price, JSON.stringify({ productType: 'service', tags: `plan:${plan.id}`, reference: plan.id, pos: true, sales: true }));
  }
  ensureItem('gym_item_day_pass', 'cat_other_services', 'Day pass', 'Visitor entry fee', 200, JSON.stringify({ productType: 'service', tags: 'pass', pos: true, sales: true }));
  ensureItem('gym_item_coaching', 'cat_coaching', 'Private coaching hour', 'One coach, one court hour', 1200, JSON.stringify({ productType: 'service', tags: 'coaching', pos: true, sales: true }));
  ensureItem('gym_item_class', 'cat_classes', 'Group class drop-in', 'Single class visit', 400, JSON.stringify({ productType: 'service', tags: 'class', pos: true, sales: true }));
  ensureItem('gym_item_racket', 'cat_rentals', 'Racket rental', 'Issued from the desk', 100, JSON.stringify({ productType: 'service', tags: 'rental', pos: true, sales: true }));
  ensureItem('gym_item_shirt', 'cat_merch', 'Gymkhana t-shirt', 'Merchandise', 800, JSON.stringify({ productType: 'goods', tags: 'merch', pos: true, sales: true }));
  ensureItem('gym_item_course_badminton', 'cat_classes', 'Beginner badminton course', 'Eight-session training course', 3200, JSON.stringify({ productType: 'service', tags: 'course', pos: true, sales: true }));
  ensureItem('gym_item_course_swim', 'cat_classes', 'Swim technique course', 'Lane training for four weeks', 2800, JSON.stringify({ productType: 'service', tags: 'course', pos: true, sales: true }));
  ensureItem('gym_item_activity_yoga', 'cat_classes', 'Morning yoga', 'Open activity on the studio floor', 300, JSON.stringify({ productType: 'service', tags: 'activity', pos: true, sales: true }));
  ensureItem('gym_item_activity_fitness', 'cat_coaching', 'Football fitness', 'Conditioning session on the ground', 500, JSON.stringify({ productType: 'service', tags: 'activity', pos: true, sales: true }));
  const stock: [string, string, string, number, number, number][] = [
    ['inv_racket', 'Badminton racket', 'RKT-1', 16, 4, 850],
    ['inv_basketball', 'Basketball', 'BBL-1', 18, 4, 900],
    ['inv_football', 'Football', 'FBL-1', 12, 3, 1100],
    ['inv_cone', 'Training cone', 'CON-1', 40, 10, 80],
    ['inv_bib', 'Training bib', 'BIB-1', 30, 8, 150],
    ['inv_ladder', 'Agility ladder', 'LAD-1', 6, 2, 700],
    ['inv_shuttle', 'Shuttlecock tube', 'SHU-1', 24, 6, 220],
  ];
  for (const [id, name, sku, qty, reorder, cost] of stock) {
    run(
      `INSERT OR IGNORE INTO inventory_items (id, cafe_id, name, sku, category, unit, qty, reorder_level, cost_per_unit, supplier, is_active, updated_at)
       VALUES (?, ?, ?, ?, 'Training', 'pcs', ?, ?, ?, 'Gymkhana stores', 1, ?)`,
      [id, CAFE_ID, name, sku, qty, reorder, cost, nowIso()],
    );
    run(`UPDATE inventory_items SET category = 'Training', name = ?, qty = ?, reorder_level = ?, cost_per_unit = ?, unit = 'pcs', supplier = 'Gymkhana stores' WHERE id = ?`, [name, qty, reorder, cost, id]);
  }
  const trainers: [string, string, string, string, string, string][] = [
    ['trainer_head', 'Neha Kapoor', '9810000001', 'neha.kapoor@gymkhana.local', 'Badminton', 'Mon–Sat 06:00–11:00'],
    ['trainer_arjun', 'Arjun Desai', '9810000002', 'arjun.desai@gymkhana.local', 'Tennis', 'Tue–Sun 07:00–12:00'],
    ['trainer_farah', 'Farah Khan', '9810000003', 'farah.khan@gymkhana.local', 'Swimming', 'Mon–Fri 06:30–10:00'],
    ['trainer_imran', 'Kabir Patel', '9810000004', 'kabir.patel@gymkhana.local', 'Football', 'Mon–Sat 16:00–20:00'],
  ];
  const seedSlots: Record<string, string[]> = {
    trainer_head: slotsBetween(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], 6, 11),
    trainer_arjun: slotsBetween(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], 7, 12),
    trainer_farah: slotsBetween(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 6, 10),
    trainer_imran: slotsBetween(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], 16, 20),
  };
  for (const [id, name, phone, email, sport, hours] of trainers) {
    run(
      `INSERT OR IGNORE INTO trainers (id, cafe_id, name, phone, specialization, availability, is_active, email) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, CAFE_ID, name, phone, sport, hours, email],
    );
    run('UPDATE trainers SET name = ?, phone = ?, email = ?, specialization = ? WHERE id = ?', [name, phone, email, sport, id]);
    const slots = seedSlots[id] ?? [];
    run(`UPDATE trainers SET free_slots = ?, availability = ? WHERE id = ? AND free_slots = ''`, [JSON.stringify(slots), summarizeSlots(slots), id]);
  }
  run(`UPDATE trainer_sessions SET trainer_name = 'Kabir Patel' WHERE trainer_id = 'trainer_imran'`);
  run(`UPDATE desk_shifts SET subject_name = 'Kabir Patel', email = 'kabir.patel@gymkhana.local' WHERE subject_id = 'trainer_imran'`);
  run(`UPDATE maintenance_records SET actor = 'Kabir Patel' WHERE actor = 'Imran Qureshi'`);
  run(
    `INSERT OR IGNORE INTO gym_classes (id, cafe_id, name, category, trainer_id, schedule, duration_minutes, capacity, price, description, is_private, is_active)
     VALUES ('class_badminton', ?, 'Morning badminton', 'Badminton', 'trainer_head', 'Mon Wed Fri 07:00', 60, 8, 400, 'Group drills', 0, 1)`,
    [CAFE_ID],
  );
  run(
    `INSERT OR IGNORE INTO announcements (id, cafe_id, title, body, created_at) VALUES ('ann_open', ?, 'Courts open at 6', 'Book a slot from the member home or the reception desk.', ?)`,
    [CAFE_ID, nowIso()],
  );
  const demo = get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, '9811111111']);
  if (!demo) {
    const id = 'member_demo';
    run(
      `INSERT OR IGNORE INTO customers (id, cafe_id, name, mobile, order_count, last_order_at, created_at, email, member_code, membership_status)
       VALUES (?, ?, 'Asha Menon', '9811111111', 0, NULL, ?, 'asha@example.com', 'GK1001', 'PENDING')`,
      [id, CAFE_ID, nowIso()],
    );
    if (get('SELECT id FROM customers WHERE id = ?', [id])) assignPlan(id, 'plan_annual', 'seed');
  }
  run(`UPDATE customers SET access_interest = 'Badminton courts and morning coaching', govt_id_label = 'Aadhaar · ending 4412', coach_id = 'trainer_head', emergency_contact = '9820000001' WHERE mobile = '9811111111' AND cafe_id = ?`, [CAFE_ID]);
  const people: [string, string, string, string, string, string, string, string][] = [
    ['visitor_rahul', 'Rahul Iyer', '9811111112', 'rahul@example.com', 'VK1002', 'Badminton court, evening slot', 'Driving licence · MH04 2291', 'trainer_head'],
    ['visitor_meera', 'Meera Shah', '9811111113', 'meera.shah@example.com', 'VK1003', 'Tennis coaching', 'Passport · Z4419021', 'trainer_arjun'],
    ['visitor_kabir', 'Kabir Das', '9811111114', 'kabir@example.com', 'VK1004', 'Football ground', 'Aadhaar · ending 7781', 'trainer_imran'],
    ['visitor_leela', 'Leela Nair', '9811111115', 'leela@example.com', 'VK1005', 'Swimming pool lanes', 'Aadhaar · ending 1104', 'trainer_farah'],
  ];
  for (const [id, name, mobile, email, code, access, govt, coach] of people) {
    run(
      `INSERT OR IGNORE INTO customers (id, cafe_id, name, mobile, order_count, last_order_at, created_at, email, member_code, membership_status, access_interest, govt_id_label, coach_id, emergency_contact)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?, 'PENDING', ?, ?, ?, '9820000099')`,
      [id, CAFE_ID, name, mobile, nowIso(), email, code, access, govt, coach],
    );
  }
  if (get("SELECT id FROM customers WHERE id = 'visitor_rahul' AND membership_status != 'ACTIVE'")) assignPlan('visitor_rahul', 'plan_monthly', 'seed');
  if (get("SELECT id FROM customers WHERE id = 'visitor_meera' AND membership_status != 'ACTIVE'")) assignPlan('visitor_meera', 'plan_monthly', 'seed');
  if (get("SELECT id FROM customers WHERE id = 'visitor_kabir' AND membership_status != 'ACTIVE'")) assignPlan('visitor_kabir', 'plan_quarterly', 'seed');
  if (get("SELECT id FROM customers WHERE id = 'visitor_leela' AND membership_status != 'ACTIVE'")) assignPlan('visitor_leela', 'plan_student', 'seed');
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const evening = new Date(`${day}T18:00:00+05:30`).toISOString();
  const eveningEnd = new Date(`${day}T19:00:00+05:30`).toISOString();
  run(
    `INSERT OR IGNORE INTO bookings (id, cafe_id, facility_id, customer_id, member_name, member_mobile, sport, start_at, end_at, participants, amount, discount, payment_status, status, payment_method, order_id, notes, created_at, updated_at, created_by)
     VALUES ('book_demo_badminton', ?, 'fac_badminton', 'visitor_rahul', 'Rahul Iyer', '9811111112', 'Badminton', ?, ?, 2, 600, 0, 'UNPAID', 'CONFIRMED', '', NULL, 'Evening court', ?, ?, 'Reception')`,
    [CAFE_ID, evening, eveningEnd, nowIso(), nowIso()],
  );
  run(
    `INSERT OR IGNORE INTO bookings (id, cafe_id, facility_id, customer_id, member_name, member_mobile, sport, start_at, end_at, participants, amount, discount, payment_status, status, payment_method, order_id, notes, created_at, updated_at, created_by)
     VALUES ('book_demo_tennis', ?, 'fac_tennis', 'visitor_meera', 'Meera Shah', '9811111113', 'Tennis', ?, ?, 2, 700, 0, 'PAID', 'CONFIRMED', 'UPI', NULL, 'Member court', ?, ?, 'Reception')`,
    [CAFE_ID, new Date(`${day}T07:00:00+05:30`).toISOString(), new Date(`${day}T08:00:00+05:30`).toISOString(), nowIso(), nowIso()],
  );
  const tomorrow = new Date(Date.parse(`${day}T12:00:00+05:30`) + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const ashaId = get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, '9811111111'])?.id ?? 'member_demo';
  const extraBookings: [string, string, string, string, string, string, string, number, number, number, string, string, string, string][] = [
    ['book_demo_squash', day, 'visitor_meera', 'fac_squash', 'Meera Shah', '9811111113', 'Squash', 9, 1, 500, 'PAID', 'CHECKED_IN', 'UPI', 'Morning squash'],
    ['book_demo_pool', day, 'visitor_leela', 'fac_pool', 'Leela Nair', '9811111115', 'Swimming', 11, 1, 400, 'PAID', 'CHECKED_IN', 'CASH', 'Lane hire'],
    ['book_demo_bball', day, 'visitor_kabir', 'fac_basketball', 'Kabir Das', '9811111114', 'Basketball', 16, 1, 800, 'UNPAID', 'CONFIRMED', '', 'Hall booking'],
    ['book_demo_football', day, 'visitor_kabir', 'fac_football', 'Kabir Das', '9811111114', 'Football', 17, 1, 2000, 'PAID', 'CONFIRMED', 'CARD', 'Evening ground'],
    ['book_demo_gym', day, ashaId, 'fac_gym', 'Asha Menon', '9811111111', 'Gym', 8, 2, 0, 'PAID', 'CHECKED_IN', 'CASH', 'Member gym floor'],
    ['book_demo_tennis_pm', day, 'visitor_meera', 'fac_tennis', 'Meera Shah', '9811111113', 'Tennis', 16, 1, 700, 'PAID', 'CONFIRMED', 'UPI', 'Afternoon court'],
    ['book_demo_badminton_pm', day, ashaId, 'fac_badminton_2', 'Asha Menon', '9811111111', 'Badminton', 19, 1, 600, 'UNPAID', 'CONFIRMED', '', 'Night slot'],
    ['book_demo_yoga', day, 'visitor_leela', 'fac_pool_2', 'Leela Nair', '9811111115', 'Swimming', 7, 1, 350, 'PAID', 'COMPLETED', 'UPI', 'Sunrise lane'],
    ['book_demo_cancelled', day, 'visitor_rahul', 'fac_tennis', 'Rahul Iyer', '9811111112', 'Tennis', 12, 1, 700, 'UNPAID', 'CANCELLED', '', 'Guest cancelled'],
    ['book_demo_yday_tennis', istDaysAgo(1), 'visitor_meera', 'fac_tennis', 'Meera Shah', '9811111113', 'Tennis', 7, 1, 700, 'PAID', 'COMPLETED', 'UPI', 'Yesterday court'],
    ['book_demo_yday_badminton', istDaysAgo(1), 'visitor_rahul', 'fac_badminton', 'Rahul Iyer', '9811111112', 'Badminton', 18, 1, 600, 'PAID', 'COMPLETED', 'CASH', 'Yesterday evening'],
    ['book_demo_tomorrow', tomorrow, ashaId, 'fac_badminton', 'Asha Menon', '9811111111', 'Badminton', 18, 1, 600, 'UNPAID', 'CONFIRMED', '', 'Hold for tomorrow'],
  ];
  for (const [id, date, customerId, facilityId, name, mobile, sport, hour, hours, amount, pay, status, method, notes] of extraBookings) {
    if (!get('SELECT id FROM facilities WHERE id = ?', [facilityId])) continue;
    const startAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+05:30`).toISOString();
    const endAt = new Date(`${date}T${String(hour + hours).padStart(2, '0')}:00:00+05:30`).toISOString();
    run(
      `INSERT OR IGNORE INTO bookings (id, cafe_id, facility_id, customer_id, member_name, member_mobile, sport, start_at, end_at, participants, amount, discount, payment_status, status, payment_method, order_id, notes, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, 0, ?, ?, ?, NULL, ?, ?, ?, 'Reception')`,
      [id, CAFE_ID, facilityId, customerId, name, mobile, sport, startAt, endAt, amount, pay, status, method, notes, startAt, startAt],
    );
  }
  const inside: [string, string, string, string, string][] = [
    ['cin_rahul', 'visitor_rahul', 'Rahul Iyer', 'Badminton Court 1', 'VISITOR'],
    ['cin_kabir', 'visitor_kabir', 'Kabir Das', 'Football C1', 'VISITOR'],
    ['cin_leela', 'visitor_leela', 'Leela Nair', 'Swimming C1', 'MEMBER'],
  ];
  for (const [id, customerId, name, facility, kind] of inside) {
    run(
      `INSERT OR IGNORE INTO check_ins (id, cafe_id, customer_id, member_name, booking_id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at, checked_in_by)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 'UNPAID', ?, NULL, 'Reception')`,
      [id, CAFE_ID, customerId, name, facility, kind, nowIso()],
    );
  }
  run(
    `INSERT OR IGNORE INTO gym_classes (id, cafe_id, name, category, trainer_id, schedule, duration_minutes, capacity, price, description, is_private, is_active)
     VALUES ('class_tennis', ?, 'Tennis footwork', 'Tennis', 'trainer_arjun', 'Tue Thu 07:30', 60, 6, 500, 'Movement and rally drills', 0, 1)`,
    [CAFE_ID],
  );
  run(
    `INSERT OR IGNORE INTO gym_classes (id, cafe_id, name, category, trainer_id, schedule, duration_minutes, capacity, price, description, is_private, is_active)
     VALUES ('class_swim', ?, 'Lane swimming', 'Swimming', 'trainer_farah', 'Mon Wed Fri 06:30', 45, 10, 350, 'Technique laps', 0, 1)`,
    [CAFE_ID],
  );
  run(
    `INSERT OR IGNORE INTO maintenance_records (id, cafe_id, facility_id, title, notes, status, starts_at, ends_at, created_at, actor)
     VALUES ('mnt_net', ?, 'fac_badminton', 'Retension court net', 'Net is loose on the left post.', 'OPEN', ?, NULL, ?, 'Facility Manager')`,
    [CAFE_ID, nowIso(), nowIso()],
  );
  run(`UPDATE gym_classes SET trainer_id = 'trainer_head' WHERE id = 'class_badminton'`);
  const shiftDay = istToday();
  const shiftStart = new Date(`${shiftDay}T06:00:00+05:30`).toISOString();
  const shiftEnd = new Date(`${shiftDay}T11:00:00+05:30`).toISOString();
  run(
    `INSERT OR IGNORE INTO desk_shifts (id, cafe_id, subject_type, subject_id, subject_name, started_at, ended_at, phone, email, role_label, govt_id_label, govt_id_url, areas, notes, opened_by)
     VALUES ('shift_demo_neha', ?, 'TRAINER', 'trainer_head', 'Neha Kapoor', ?, ?, '9822222201', 'neha@gymkhana.club', 'Head trainer', 'Aadhaar ending 2201', '', 'Coaching', 'Morning badminton block.', 'seed')`,
    [CAFE_ID, shiftStart, shiftEnd],
  );
  const demoSessions: [string, string, number, string, string, string, number, string, number, string][] = [
    ['sess_demo_1', '06:30', 60, 'Badminton Court 1', 'Morning badminton coaching', 'Group class', 6, 'Asha Menon, Rahul Iyer and 4 juniors', 0, 'Included in plan'],
    ['sess_demo_2', '09:00', 45, 'Badminton Court 1', 'Footwork and smash drills', 'Private coaching', 1, 'Rahul Iyer', 800, 'Paid · UPI'],
  ];
  for (const [id, start, minutes, facility, activity, kind, people, visitors, amount, payment] of demoSessions) {
    run(
      `INSERT OR IGNORE INTO trainer_sessions (id, cafe_id, shift_id, trainer_id, trainer_name, session_date, start_time, duration_minutes, facility, activity, kind, participants, visitors, amount, payment, created_at)
       VALUES (?, ?, 'shift_demo_neha', 'trainer_head', 'Neha Kapoor', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, CAFE_ID, shiftDay, start, minutes, facility, activity, kind, people, visitors, amount, payment, shiftEnd],
    );
  }
  const trainerById = new Map(trainers.map(([id, name, phone, email]) => [id, { name, phone, email }]));
  type DemoSession = [string, number, string, string, string, number, string, number, string];
  const demoShifts: [string, string, number, string, string, string, string, DemoSession[]][] = [
    ['shift_demo_farah_0', 'trainer_farah', 0, '06:00', '10:00', 'Swim coach', 'Pool block before school hours.', [
      ['06:30', 45, 'Swimming Pool', 'Lane swimming', 'Group class', 8, 'Leela Nair and 7 members', 0, 'Included in plan'],
      ['07:30', 45, 'Swimming Pool', 'Freestyle breathing', 'Private coaching', 1, 'Leela Nair', 600, 'Paid · Cash'],
      ['08:30', 30, 'Swimming Pool', 'Swim test for new juniors', 'Assessment', 3, 'Three juniors from the waitlist', 0, 'Included in plan'],
    ]],
    ['shift_demo_neha_1', 'trainer_head', 1, '06:00', '11:00', 'Head trainer', 'Private lessons and trials.', [
      ['07:00', 60, 'Badminton Court 1', 'Serve and return', 'Private coaching', 1, 'Asha Menon', 1200, 'Paid · Card'],
      ['08:30', 30, 'Badminton Court 1', 'Trial for new players', 'Assessment', 3, 'Walk-in trial players', 0, 'Included in plan'],
      ['09:30', 60, 'Badminton Court 1', 'Doubles rotation', 'Group class', 6, 'Rahul Iyer and 5 members', 0, 'Included in plan'],
    ]],
    ['shift_demo_arjun_1', 'trainer_arjun', 1, '07:00', '12:00', 'Trainer', 'Footwork class and private hours.', [
      ['07:30', 60, 'Tennis Court 1', 'Tennis footwork', 'Group class', 5, 'Meera Shah and 4 members', 0, 'Included in plan'],
      ['09:00', 60, 'Tennis Court 1', 'Backhand clinic', 'Private coaching', 1, 'Meera Shah', 1500, 'Paid · UPI'],
      ['10:30', 60, 'Tennis Court 1', 'Junior tennis camp', 'Camp', 10, 'Under-12 camp group', 2000, 'Paid · Cash'],
    ]],
    ['shift_demo_imran_1', 'trainer_imran', 1, '16:00', '20:00', 'Trainer', 'Evening squad training.', [
      ['16:30', 90, 'Football Ground', 'U-14 squad practice', 'Team practice', 18, 'U-14 squad', 0, 'Included in plan'],
      ['18:30', 60, 'Football Ground', 'Striker finishing', 'Private coaching', 1, 'Kabir Das', 1000, 'Paid · UPI'],
    ]],
    ['shift_demo_neha_2', 'trainer_head', 2, '06:00', '11:00', 'Head trainer', 'Morning badminton block.', [
      ['07:00', 60, 'Badminton Court 1', 'Morning badminton', 'Group class', 7, 'Asha Menon, Rahul Iyer and 5 juniors', 0, 'Included in plan'],
      ['09:00', 45, 'Badminton Court 1', 'Smash and net play', 'Private coaching', 1, 'Rahul Iyer', 800, 'Due'],
    ]],
    ['shift_demo_farah_2', 'trainer_farah', 2, '06:00', '10:00', 'Swim coach', 'Lane training.', [
      ['06:30', 45, 'Swimming Pool', 'Lane swimming', 'Group class', 9, 'Leela Nair and 8 members', 0, 'Included in plan'],
      ['07:30', 45, 'Swimming Pool', 'Backstroke turns', 'Private coaching', 1, 'Leela Nair', 600, 'Paid · UPI'],
    ]],
    ['shift_demo_imran_2', 'trainer_imran', 2, '16:00', '20:00', 'Trainer', 'Senior team night.', [
      ['17:00', 120, 'Football Ground', 'Senior team practice', 'Team practice', 20, 'Senior team', 0, 'Included in plan'],
    ]],
    ['shift_demo_arjun_3', 'trainer_arjun', 3, '07:00', '12:00', 'Trainer', 'Footwork class.', [
      ['07:30', 60, 'Tennis Court 1', 'Tennis footwork', 'Group class', 6, 'Meera Shah and 5 members', 0, 'Included in plan'],
      ['10:00', 60, 'Tennis Court 1', 'First serve', 'Private coaching', 1, 'Meera Shah', 1500, 'Due'],
    ]],
    ['shift_demo_imran_3', 'trainer_imran', 3, '16:00', '20:00', 'Trainer', 'Fitness block.', [
      ['16:30', 60, 'Football Ground', 'Football fitness', 'Group class', 12, 'Open fitness group', 0, 'Included in plan'],
      ['18:00', 45, 'Football Ground', 'Goalkeeper drills', 'Private coaching', 2, 'Kabir Das and a friend', 1200, 'Paid · Cash'],
    ]],
    ['shift_demo_neha_4', 'trainer_head', 4, '06:00', '11:00', 'Head trainer', 'Morning badminton block.', [
      ['07:00', 60, 'Badminton Court 1', 'Morning badminton', 'Group class', 8, 'Full class', 0, 'Included in plan'],
      ['08:30', 60, 'Badminton Court 1', 'Footwork ladder', 'Private coaching', 1, 'Asha Menon', 1200, 'Paid · UPI'],
    ]],
  ];
  seedOnce('demo_sessions_week', () => {
    for (const [id, trainerId, daysAgo, from, to, roleLabel, notes, sessions] of demoShifts) {
      const trainer = trainerById.get(trainerId);
      if (!trainer) continue;
      const date = istDaysAgo(daysAgo);
      const endedAt = new Date(`${date}T${to}:00+05:30`).toISOString();
      run(
        `INSERT OR IGNORE INTO desk_shifts (id, cafe_id, subject_type, subject_id, subject_name, started_at, ended_at, phone, email, role_label, govt_id_label, govt_id_url, areas, notes, opened_by)
         VALUES (?, ?, 'TRAINER', ?, ?, ?, ?, ?, ?, ?, '', '', 'Coaching', ?, 'seed')`,
        [id, CAFE_ID, trainerId, trainer.name, new Date(`${date}T${from}:00+05:30`).toISOString(), endedAt, trainer.phone, trainer.email, roleLabel, notes],
      );
      sessions.forEach(([start, minutes, facility, activity, kind, people, visitors, amount, payment], index) => {
        run(
          `INSERT OR IGNORE INTO trainer_sessions (id, cafe_id, shift_id, trainer_id, trainer_name, session_date, start_time, duration_minutes, facility, activity, kind, participants, visitors, amount, payment, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [`${id}_${index + 1}`, CAFE_ID, id, trainerId, trainer.name, date, start, minutes, facility, activity, kind, people, visitors, amount, payment, endedAt],
        );
      });
    }
  });
  const demoTasks: [string, string, string, string, number, number | null, string, string, string, string, number][] = [
    ['mnt_badminton_mop', 'fac_badminton', 'Mop court before evening play', 'Dust on court 1 after the morning session.', 0, 0, 'Neha Kapoor', 'Cleaning', 'LOW', 'Housekeeping', 0],
    ['mnt_basket_lights', 'fac_basketball', 'Replace two floodlights', 'North end lights flicker after 19:00.', 1, null, 'Facility Manager', 'Electrical', 'URGENT', 'Ravi, electrician', 0],
    ['mnt_gym_treadmill', 'fac_gym', 'Service treadmill 3', 'Belt slips at speed 10. Keep it out of use until serviced.', 2, null, 'Reception', 'Equipment', 'HIGH', 'FitCare service', 0],
    ['mnt_pool_shower', 'fac_pool', 'Fix leaking shower', 'Second shower in the ladies changing room drips.', 3, null, 'Farah Khan', 'Plumbing', 'NORMAL', 'Plumber on call', 0],
    ['mnt_football_goal', 'fac_football', 'Fix goal net hooks', 'Three hooks broken on the east goal.', 4, 3, 'Kabir Patel', 'Repair', 'NORMAL', 'Ground staff', 350],
    ['mnt_pool_ph', 'fac_pool', 'Balance pool pH', 'Morning test read 7.9. Dose and retest before the lane class.', 6, 6, 'Farah Khan', 'Inspection', 'HIGH', 'Pool plant team', 450],
    ['mnt_squash_floor', 'fac_squash', 'Deep clean squash floor', 'Scuff marks around the service box.', 9, 8, 'Reception', 'Cleaning', 'LOW', 'Housekeeping', 600],
    ['mnt_tennis_lines', 'fac_tennis', 'Repaint baselines', 'Baseline paint has worn at both ends.', 12, 10, 'Facility Manager', 'Repair', 'NORMAL', 'Suresh Painters', 3800],
    ['mnt_gym_firstaid', 'fac_gym', 'Restock first aid kit', 'Check expiry dates and refill bandages and spray.', 15, 15, 'Facility Manager', 'Safety', 'NORMAL', 'Reception', 900],
    ['mnt_fire_check', 'fac_basketball', 'Monthly fire extinguisher check', 'Hall and corridor extinguishers, sign the tags.', 20, 20, 'Facility Manager', 'Safety', 'NORMAL', 'City Fire Safety', 1200],
  ];
  seedOnce('demo_maintenance', () => {
    run(`UPDATE maintenance_records SET category = 'Repair', priority = 'HIGH', assigned_to = 'Ground staff' WHERE id = 'mnt_net'`);
    for (const [id, facilityId, title, notes, startedAgo, endedAgo, raisedBy, category, priority, assignedTo, cost] of demoTasks) {
      const startedAt = new Date(`${istDaysAgo(startedAgo)}T07:15:00+05:30`).toISOString();
      const endedAt = endedAgo === null ? null : new Date(`${istDaysAgo(endedAgo)}T${endedAgo === startedAgo ? '09:30' : '16:00'}:00+05:30`).toISOString();
      run(
        `INSERT OR IGNORE INTO maintenance_records (id, cafe_id, facility_id, title, notes, status, starts_at, ends_at, created_at, actor, category, priority, assigned_to, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, CAFE_ID, facilityId, title, notes, endedAt ? 'CLOSED' : 'OPEN', startedAt, endedAt, startedAt, raisedBy, category, priority, assignedTo, cost],
      );
    }
  });
  const demoParticipants: [string, string, string, string, string][] = [
    ['reg_demo_1', 'class_badminton', 'Asha Menon', '9811111111', 'REGISTERED'],
    ['reg_demo_2', 'class_badminton', 'Rahul Iyer', '9811111112', 'ATTENDED'],
    ['reg_demo_3', 'class_badminton', 'Dev Arora', '', 'REGISTERED'],
    ['reg_demo_4', 'class_tennis', 'Meera Shah', '9811111113', 'ATTENDED'],
    ['reg_demo_5', 'class_tennis', 'Ishaan Kapoor', '', 'REGISTERED'],
    ['reg_demo_6', 'class_swim', 'Leela Nair', '9811111115', 'REGISTERED'],
    ['reg_demo_7', 'class_swim', 'Tara Menon', '', 'REGISTERED'],
  ];
  seedOnce('demo_participants', () => {
    demoParticipants.forEach(([id, classId, name, mobile, status], index) => {
      if (!get('SELECT id FROM gym_classes WHERE id = ?', [classId])) return;
      const customer = mobile ? get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, mobile]) : undefined;
      run(
        'INSERT OR IGNORE INTO class_registrations (id, class_id, customer_id, name, status, attended, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, classId, customer?.id ?? null, name, status, status === 'ATTENDED' ? 1 : 0, new Date(Date.now() - (index + 1) * 3_600_000).toISOString()],
      );
    });
  });
  seedClubDeskSales();
  seedOnce('demo_people_500', seedDemoPeople);
  repairMemberAccess();
}

function repairMemberAccess() {
  const planIds = ['plan_monthly', 'plan_quarterly', 'plan_annual', 'plan_student', 'plan_family', 'plan_premium'] as const;
  const pendingDemo = all<{ id: string }>(
    `SELECT id FROM customers WHERE cafe_id = ? AND id LIKE 'demo_mem_%' AND (membership_status = 'PENDING' OR IFNULL(plan_id, '') = '')`,
    [CAFE_ID],
  );
  pendingDemo.forEach((row, index) => {
    const planId = planIds[index % planIds.length];
    const plan = get<{ duration_days: number }>('SELECT duration_days FROM membership_plans WHERE id = ?', [planId]);
    const expires = new Date(Date.now() + (plan?.duration_days ?? 30) * 86_400_000).toISOString();
    const starts = nowIso();
    run(
      `UPDATE customers SET membership_status = 'ACTIVE', plan_id = ?, membership_expires_at = ?, frozen_until = NULL WHERE id = ?`,
      [planId, expires, row.id],
    );
    run(
      `INSERT OR IGNORE INTO memberships (id, cafe_id, customer_id, plan_id, status, starts_at, expires_at, frozen_until, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, NULL, ?)`,
      [`mem_${row.id}`, CAFE_ID, row.id, planId, starts, expires, starts],
    );
  });
  const named: [string, string][] = [
    ['visitor_rahul', 'plan_monthly'],
    ['visitor_kabir', 'plan_quarterly'],
    ['visitor_meera', 'plan_monthly'],
    ['visitor_leela', 'plan_student'],
    ['member_demo', 'plan_annual'],
  ];
  for (const [id, planId] of named) {
    const row = get<{ membership_status: string }>('SELECT membership_status FROM customers WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
    if (row && row.membership_status !== 'ACTIVE') assignPlan(id, planId, 'seed');
  }
  const gate = get<{ id: string; membership_status: string }>("SELECT id, membership_status FROM customers WHERE cafe_id = ? AND name = 'Gate Scan'", [CAFE_ID]);
  if (gate && gate.membership_status !== 'ACTIVE') assignPlan(gate.id, 'plan_monthly', 'seed');
  const open = all<{ id: string; customer_id: string }>(
    'SELECT id, customer_id FROM check_ins WHERE cafe_id = ? AND checked_out_at IS NULL AND customer_id IS NOT NULL',
    [CAFE_ID],
  );
  for (const row of open) {
    if (!activeMembership(row.customer_id)?.active) run('UPDATE check_ins SET checked_out_at = ? WHERE id = ?', [nowIso(), row.id]);
  }
  run(`UPDATE check_ins SET kind = 'MEMBER' WHERE cafe_id = ? AND kind != 'MEMBER'`, [CAFE_ID]);
}

function seedClubDeskSales() {
  if (get('SELECT id FROM seed_marks WHERE id = ?', ['demo_club_sales'])) return;
  run('INSERT INTO seed_marks (id, created_at) VALUES (?, ?)', ['demo_club_sales', nowIso()]);

  run(`INSERT OR IGNORE INTO pos_configs (id, cafe_id, name, is_restaurant) VALUES ('pos_config_restaurant', ?, 'Gymkhana', 1)`, [CAFE_ID]);
  if (!get("SELECT id FROM pos_sessions WHERE status = 'OPEN' LIMIT 1")) {
    const config = get<{ id: string }>('SELECT id FROM pos_configs LIMIT 1');
    if (config) {
      const seq = get<{ n: number }>(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS n FROM pos_sessions WHERE config_id = ?',
        [config.id],
      );
      run(
        `INSERT INTO pos_sessions (id, config_id, status, opened_at, closed_at, opened_by, opening_cash, closing_cash, counted_cash, notes, sequence)
         VALUES ('ps_demo_open', ?, 'OPEN', ?, NULL, 'Reception', 500000, NULL, NULL, 'Front desk till', ?)`,
        [config.id, new Date(`${istToday()}T06:00:00+05:30`).toISOString(), seq?.n ?? 1],
      );
    }
  }

  const sales: [string, number, number, number, string, string, string, '' | 'CASH' | 'UPI' | 'CARD', string][] = [
    ['sale_demo_t01', 0, 7, 12, 'Asha Menon', '9811111111', 'gym_item_fac_badminton', 'CASH', 'BOOKING:book_demo_gym'],
    ['sale_demo_t02', 0, 7, 48, 'Meera Shah', '9811111113', 'gym_item_fac_tennis', 'UPI', 'BOOKING:book_demo_tennis'],
    ['sale_demo_t03', 0, 8, 10, 'Kabir Das', '9811111114', 'gym_item_day_pass', 'CASH', ''],
    ['sale_demo_t04', 0, 8, 40, 'Leela Nair', '9811111115', 'gym_item_class', 'CARD', ''],
    ['sale_demo_t05', 0, 9, 5, 'Rahul Iyer', '9811111112', 'gym_item_coaching', 'UPI', ''],
    ['sale_demo_t06', 0, 9, 35, 'Meera Shah', '9811111113', 'gym_item_fac_squash', 'UPI', 'BOOKING:book_demo_squash'],
    ['sale_demo_t07', 0, 10, 20, 'Asha Menon', '9811111111', 'gym_item_racket', 'CASH', ''],
    ['sale_demo_t08', 0, 11, 5, 'Leela Nair', '9811111115', 'gym_item_fac_pool', 'CASH', 'BOOKING:book_demo_pool'],
    ['sale_demo_t09', 0, 12, 15, 'Walk-in', '9820000101', 'gym_item_fac_basketball', '', ''],
    ['sale_demo_t10', 0, 16, 10, 'Kabir Das', '9811111114', 'gym_item_fac_football', 'CARD', 'BOOKING:book_demo_football'],
    ['sale_demo_t11', 0, 16, 42, 'Meera Shah', '9811111113', 'gym_item_plan_plan_monthly', 'UPI', 'MEMBERSHIP:plan_monthly'],
    ['sale_demo_t12', 0, 17, 20, 'Rahul Iyer', '9811111112', 'gym_item_shirt', 'CASH', ''],
    ['sale_demo_t13', 0, 18, 5, 'Asha Menon', '9811111111', 'gym_item_fac_badminton', 'UPI', 'BOOKING:book_demo_badminton'],
    ['sale_demo_d1a', 1, 7, 20, 'Meera Shah', '9811111113', 'gym_item_fac_tennis', 'UPI', 'BOOKING:book_demo_yday_tennis'],
    ['sale_demo_d1b', 1, 18, 10, 'Rahul Iyer', '9811111112', 'gym_item_fac_badminton', 'CASH', 'BOOKING:book_demo_yday_badminton'],
    ['sale_demo_d1c', 1, 19, 5, 'Asha Menon', '9811111111', 'gym_item_class', 'CARD', ''],
    ['sale_demo_d2a', 2, 8, 0, 'Leela Nair', '9811111115', 'gym_item_fac_pool', 'UPI', ''],
    ['sale_demo_d2b', 2, 17, 30, 'Kabir Das', '9811111114', 'gym_item_coaching', 'UPI', ''],
    ['sale_demo_d2c', 2, 18, 45, 'Rahul Iyer', '9811111112', 'gym_item_racket', 'CASH', ''],
    ['sale_demo_d3a', 3, 7, 30, 'Asha Menon', '9811111111', 'gym_item_plan_plan_quarterly', 'CARD', 'MEMBERSHIP:plan_quarterly'],
    ['sale_demo_d3b', 3, 9, 15, 'Meera Shah', '9811111113', 'gym_item_fac_tennis', 'UPI', ''],
    ['sale_demo_d3c', 3, 16, 0, 'Walk-in', '9820000102', 'gym_item_day_pass', 'CASH', ''],
    ['sale_demo_d4a', 4, 8, 10, 'Leela Nair', '9811111115', 'gym_item_class', 'UPI', ''],
    ['sale_demo_d4b', 4, 18, 20, 'Kabir Das', '9811111114', 'gym_item_fac_football', 'CASH', ''],
    ['sale_demo_d5a', 5, 7, 45, 'Rahul Iyer', '9811111112', 'gym_item_fac_badminton', 'UPI', ''],
    ['sale_demo_d5b', 5, 11, 0, 'Asha Menon', '9811111111', 'gym_item_shirt', 'CARD', ''],
    ['sale_demo_d6a', 6, 9, 20, 'Meera Shah', '9811111113', 'gym_item_coaching', 'UPI', ''],
    ['sale_demo_d6b', 6, 17, 10, 'Leela Nair', '9811111115', 'gym_item_fac_pool', 'CASH', ''],
    ['sale_demo_d8a', 8, 10, 0, 'Kabir Das', '9811111114', 'gym_item_plan_plan_annual', 'UPI', 'MEMBERSHIP:plan_annual'],
    ['sale_demo_d10a', 10, 8, 30, 'Asha Menon', '9811111111', 'gym_item_fac_badminton', 'CASH', ''],
    ['sale_demo_d12a', 12, 16, 15, 'Rahul Iyer', '9811111112', 'gym_item_racket', 'UPI', ''],
    ['sale_demo_d14a', 14, 7, 0, 'Meera Shah', '9811111113', 'gym_item_plan_plan_monthly', 'CARD', 'MEMBERSHIP:plan_monthly'],
    ['sale_demo_d18a', 18, 9, 40, 'Leela Nair', '9811111115', 'gym_item_class', 'UPI', ''],
    ['sale_demo_d21a', 21, 11, 10, 'Kabir Das', '9811111114', 'gym_item_fac_basketball', 'CASH', ''],
    ['sale_demo_d24a', 24, 18, 0, 'Asha Menon', '9811111111', 'gym_item_shirt', 'UPI', ''],
    ['sale_demo_d28a', 28, 8, 20, 'Rahul Iyer', '9811111112', 'gym_item_day_pass', 'CASH', ''],
  ];

  for (const [id, ago, hour, minute, name, mobile, item, method, notes] of sales) {
    if (!get('SELECT id FROM menu_items WHERE id = ?', [item])) continue;
    try {
      const order = createStaffOrder({
        id,
        clientKey: id,
        customerName: name,
        customerMobile: mobile,
        items: [{ menuItemId: item, quantity: 1, addonIds: [] }],
        notes,
        allowOpenTable: true,
      });
      if (method) markPaid(order.id, method);
      retimeOrder(order.id, new Date(`${istDaysAgo(ago)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`).toISOString());
    } catch {
      /* skip a missing catalog row so the rest of the desk still seeds */
    }
  }
}

export function registerGymRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    wrap: (fn: (req: Request, res: Response, next: NextFunction) => unknown) => (req: Request, res: Response, next: NextFunction) => void;
  },
) {
  const { requireAuth, wrap } = deps;
  const allow = (...roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      const role = req.user?.role ?? '';
      if (role === 'staff' || role === 'SUPER_ADMIN' || role === 'MANAGER' || roles.includes(role)) {
        next();
        return;
      }
      res.status(403).json({ error: 'You do not have access to this.', code: 'FORBIDDEN' });
    });
  };
  const allowAdmin = () => (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, () => {
      const role = req.user?.role ?? '';
      if (role === 'staff' || role === 'SUPER_ADMIN' || role === 'MANAGER') {
        next();
        return;
      }
      res.status(403).json({ error: 'You do not have access to WhatsApp settings.', code: 'FORBIDDEN' });
    });
  };
  const actor = (req: Request): Actor => ({ id: req.user?.id ?? '', name: req.user?.name ?? 'Staff', role: req.user?.role ?? '' });

  app.get('/api/gym/overview', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((_req, res) => {
    res.json(overview());
  }));
  app.get('/api/gym/reports', allow('RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json(gymReport());
  }));
  app.get('/api/gym/members', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json({
      members: listMembers(String(req.query.filter ?? 'all'), String(req.query.q ?? ''), {
        sport: String(req.query.sport ?? ''),
        from: String(req.query.from ?? ''),
        to: String(req.query.to ?? ''),
      }),
    });
  }));
  app.get('/api/gym/members/:id', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json(memberProfile(String(req.params.id)));
  }));
  app.post('/api/gym/members', allow('RECEPTIONIST'), wrap((req, res) => {
    res.json(saveMember(req.body, actor(req).name));
  }));
  app.post('/api/gym/members/import', allow('RECEPTIONIST'), wrap((req, res) => {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    res.json(importMembersCsv(csv, actor(req).name));
  }));
  app.patch('/api/gym/members/:id', allow('RECEPTIONIST'), wrap((req, res) => {
    res.json(saveMember({ ...req.body, id: String(req.params.id) }, actor(req).name));
  }));
  app.post('/api/gym/members/:id/plan', allow('RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const method = req.body?.method;
    if (method === 'CASH' || method === 'UPI' || method === 'CARD') {
      res.json(recordMemberPayment(String(req.params.id), String(req.body.planId), method, actor(req).name));
      return;
    }
    res.json(assignPlan(String(req.params.id), String(req.body.planId), actor(req).name));
  }));
  app.post('/api/gym/members/:id/status', allow('RECEPTIONIST', 'MANAGER'), wrap((req, res) => {
    const status = String(req.body?.status ?? '');
    if (!['ACTIVE', 'SUSPENDED', 'FROZEN', 'PENDING'].includes(status)) throw new AppError(400, 'STATUS', 'Unknown membership status.');
    res.json(setMembershipStatus(String(req.params.id), status as 'ACTIVE', actor(req).name, Number(req.body?.freezeDays ?? 0)));
  }));

  app.get('/api/gym/facilities', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json({ facilities: facilityBoard() });
  }));
  app.get('/api/gym/activities', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json({ boards: activityBoard() });
  }));
  app.post('/api/gym/facilities', allow('FACILITY_MANAGER'), wrap((req, res) => {
    res.json({ facility: saveFacility(req.body, actor(req).name) });
  }));
  app.patch('/api/gym/facilities/:id', allow('FACILITY_MANAGER'), wrap((req, res) => {
    res.json({ facility: saveFacility(req.body, actor(req).name, String(req.params.id)) });
  }));
  app.post('/api/gym/facilities/:id/maintenance', allow('FACILITY_MANAGER'), wrap((req, res) => {
    const id = String(req.params.id);
    const title = String(req.body?.title ?? 'Maintenance').trim();
    run(
      `INSERT INTO maintenance_records (id, cafe_id, facility_id, title, notes, status, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      [randomUUID(), CAFE_ID, id, title, String(req.body?.notes ?? ''), nowIso(), req.body?.endsAt ?? null, nowIso()],
    );
    if (req.body?.block) {
      run(`UPDATE facilities SET is_available = 0, maintenance_status = 'MAINTENANCE', updated_at = ? WHERE id = ?`, [nowIso(), id]);
      const fac = get<{ name: string }>('SELECT name FROM facilities WHERE id = ?', [id]);
      notifyFacilityMembers(id, 'FACILITY_MAINTENANCE', { facility: fac?.name || title });
    }
    audit(actor(req).name, 'MAINTENANCE', 'facility', id, title);
    res.json({ facilities: listFacilities() });
  }));
  app.post('/api/gym/maintenance', allow('FACILITY_MANAGER', 'RECEPTIONIST', 'COACH'), wrap((req, res) => {
    const facilityId = String(req.body?.facilityId ?? '');
    const title = String(req.body?.title ?? '').trim();
    if (!facilityId || !title) throw new AppError(400, 'MAINTENANCE', 'Choose a facility and a task.');
    const facility = get('SELECT id FROM facilities WHERE id = ? AND cafe_id = ?', [facilityId, CAFE_ID]);
    if (!facility) throw new AppError(404, 'FACILITY', 'Facility not found.');
    const who = actor(req).name;
    const details = taskDetails(req.body, { category: 'Repair', priority: 'NORMAL', assignedTo: '', cost: 0 });
    const id = randomUUID();
    run(
      `INSERT INTO maintenance_records (id, cafe_id, facility_id, title, notes, status, starts_at, ends_at, created_at, actor, category, priority, assigned_to, cost)
       VALUES (?, ?, ?, ?, ?, 'OPEN', ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [id, CAFE_ID, facilityId, title.slice(0, 120), String(req.body?.notes ?? '').slice(0, 2000), nowIso(), nowIso(), who, details.category, details.priority, details.assignedTo, details.cost],
    );
    if (req.body?.block) {
      run(`UPDATE facilities SET is_available = 0, maintenance_status = 'MAINTENANCE', updated_at = ? WHERE id = ?`, [nowIso(), facilityId]);
      const fac = get<{ name: string }>('SELECT name FROM facilities WHERE id = ?', [facilityId]);
      notifyFacilityMembers(facilityId, 'FACILITY_MAINTENANCE', { facility: fac?.name || title });
    }
    audit(who, 'MAINTENANCE', 'maintenance', id, title);
    res.json({ id });
  }));
  app.patch('/api/gym/maintenance/:id', allow('FACILITY_MANAGER', 'RECEPTIONIST', 'COACH'), wrap((req, res) => {
    const id = String(req.params.id);
    const row = get<{ facility_id: string; title: string; notes: string; category: string; priority: string; assigned_to: string; cost: number }>(
      'SELECT facility_id, title, notes, category, priority, assigned_to, cost FROM maintenance_records WHERE id = ? AND cafe_id = ?',
      [id, CAFE_ID],
    );
    if (!row) throw new AppError(404, 'MAINTENANCE', 'Task not found.');
    const title = String(req.body?.title ?? row.title).trim();
    if (!title) throw new AppError(400, 'MAINTENANCE', 'Enter the task.');
    const facilityId = String(req.body?.facilityId ?? row.facility_id);
    if (!get('SELECT id FROM facilities WHERE id = ? AND cafe_id = ?', [facilityId, CAFE_ID])) throw new AppError(404, 'FACILITY', 'Facility not found.');
    const details = taskDetails(req.body, { category: row.category, priority: row.priority, assignedTo: row.assigned_to, cost: row.cost });
    run(
      'UPDATE maintenance_records SET title = ?, notes = ?, facility_id = ?, category = ?, priority = ?, assigned_to = ?, cost = ? WHERE id = ?',
      [title.slice(0, 120), String(req.body?.notes ?? row.notes).slice(0, 2000), facilityId, details.category, details.priority, details.assignedTo, details.cost, id],
    );
    audit(actor(req).name, 'EDIT_TASK', 'maintenance', id, title);
    res.json({ id });
  }));
  app.get('/api/gym/maintenance', allow('FACILITY_MANAGER', 'RECEPTIONIST', 'COACH'), wrap((_req, res) => {
    res.json({
      records: all(
        `SELECT m.id, m.title, m.notes, m.status, m.starts_at, m.ends_at, m.actor, m.facility_id, m.category, m.priority, m.assigned_to, m.cost,
                f.name AS facility, f.maintenance_status AS facility_status
         FROM maintenance_records m JOIN facilities f ON f.id = m.facility_id WHERE m.cafe_id = ? ORDER BY m.starts_at DESC`,
        [CAFE_ID],
      ),
    });
  }));
  app.post('/api/gym/maintenance/:id/close', allow('FACILITY_MANAGER', 'RECEPTIONIST', 'COACH'), wrap((req, res) => {
    const row = get<{ facility_id: string }>('SELECT facility_id FROM maintenance_records WHERE id = ?', [String(req.params.id)]);
    if (!row) throw new AppError(404, 'MAINTENANCE', 'Record not found.');
    run(`UPDATE maintenance_records SET status = 'CLOSED', ends_at = ? WHERE id = ?`, [nowIso(), String(req.params.id)]);
    run(`UPDATE facilities SET is_available = 1, maintenance_status = 'OK', updated_at = ? WHERE id = ?`, [nowIso(), row.facility_id]);
    const fac = get<{ name: string }>('SELECT name FROM facilities WHERE id = ?', [row.facility_id]);
    notifyFacilityMembers(row.facility_id, 'FACILITY_REOPENED', { facility: fac?.name || 'Facility' });
    audit(actor(req).name, 'TASK_DONE', 'maintenance', String(req.params.id), 'Marked done');
    res.json({ ok: true });
  }));

  app.get('/api/gym/plans', allow('RECEPTIONIST', 'CASHIER', 'COACH'), wrap((_req, res) => {
    res.json({ plans: listPlans() });
  }));
  app.post('/api/gym/plans', allow('MANAGER'), wrap((req, res) => {
    res.json({ plan: savePlan(req.body, actor(req).name) });
  }));
  app.patch('/api/gym/plans/:id', allow('MANAGER'), wrap((req, res) => {
    res.json({ plan: savePlan({ ...req.body, id: String(req.params.id) }, actor(req).name) });
  }));

  app.get('/api/gym/slots', allow('RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json(slotsFor(String(req.query.facilityId ?? ''), String(req.query.date ?? ''), Number(req.query.duration ?? 0)));
  }));
  app.get('/api/gym/bookings', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json({
      bookings: listBookings({
        date: req.query.date ? String(req.query.date) : undefined,
        facilityId: req.query.facilityId ? String(req.query.facilityId) : undefined,
        sport: req.query.sport ? String(req.query.sport) : undefined,
      }),
    });
  }));
  app.get('/api/gym/bookings/:id', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json({ booking: getBooking(String(req.params.id)) });
  }));
  app.post('/api/gym/bookings', allow('RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    res.json({ booking: createBooking(req.body, actor(req).name) });
  }));
  app.patch('/api/gym/bookings/:id', allow('RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    res.json({ booking: updateBooking(String(req.params.id), req.body, actor(req).name) });
  }));
  app.post('/api/gym/bookings/:id/status', allow('RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((req, res) => {
    const status = String(req.body?.status ?? '');
    if (!BOOKING_STATUSES.includes(status as (typeof BOOKING_STATUSES)[number])) throw new AppError(400, 'STATUS', 'Unknown booking status.');
    res.json({ booking: setBookingStatus(String(req.params.id), status as 'CANCELLED', actor(req).name) });
  }));
  app.post('/api/gym/bookings/:id/refund', allow('CASHIER', 'RECEPTIONIST'), wrap((req, res) => {
    res.json(refundBooking(String(req.params.id), actor(req).name));
  }));

  app.get('/api/gym/checkins', allow('RECEPTIONIST', 'CASHIER'), wrap((_req, res) => {
    res.json({
      checkIns: all(
        'SELECT * FROM check_ins WHERE cafe_id = ? ORDER BY checked_in_at DESC LIMIT 80',
        [CAFE_ID],
      ),
    });
  }));
  app.post('/api/gym/checkins', allow('RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    res.json(checkIn(req.body, actor(req).name));
  }));
  app.post('/api/gym/checkins/:id/out', allow('RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    res.json(checkOut(String(req.params.id), actor(req).name));
  }));

  app.get('/api/gym/classes', allow('COACH', 'RECEPTIONIST'), wrap((_req, res) => {
    res.json({
      classes: all(`SELECT c.*, t.name AS trainer_name, t.phone AS trainer_phone, t.email AS trainer_email FROM gym_classes c LEFT JOIN trainers t ON t.id = c.trainer_id WHERE c.cafe_id = ? ORDER BY c.name`, [CAFE_ID]),
      trainers: listTrainers(),
      registrations: all(
        `SELECT r.*, c.name AS class_name, c.schedule AS class_schedule, t.name AS trainer_name, t.phone AS trainer_phone
         FROM class_registrations r LEFT JOIN gym_classes c ON c.id = r.class_id LEFT JOIN trainers t ON t.id = c.trainer_id
         ORDER BY r.created_at DESC LIMIT 100`,
      ),
    });
  }));
  app.post('/api/gym/classes', allow('COACH'), wrap((req, res) => {
    if (String(req.body?.name ?? '').trim().length < 2) throw new AppError(400, 'CLASS', 'Enter the class name.');
    if (!String(req.body?.schedule ?? '').trim()) throw new AppError(400, 'CLASS', 'Enter when the class runs.');
    const id = randomUUID();
    run(
      `INSERT INTO gym_classes (id, cafe_id, name, category, trainer_id, schedule, duration_minutes, capacity, price, description, is_private, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, CAFE_ID, String(req.body.name ?? '').trim(), String(req.body.category ?? ''), req.body.trainerId || null, String(req.body.schedule ?? ''), Number(req.body.durationMinutes ?? 60), Number(req.body.capacity ?? 12), Number(req.body.price ?? 0), String(req.body.description ?? ''), req.body.isPrivate ? 1 : 0],
    );
    audit(actor(req).name, 'ADD_CLASS', 'class', id, String(req.body.name ?? ''));
    res.json({ id });
  }));
  app.patch('/api/gym/classes/:id', allow('COACH'), wrap((req, res) => {
    run(
      `UPDATE gym_classes SET name = COALESCE(?, name), schedule = COALESCE(?, schedule), trainer_id = COALESCE(?, trainer_id), capacity = COALESCE(?, capacity), price = COALESCE(?, price), description = COALESCE(?, description) WHERE id = ?`,
      [req.body.name ?? null, req.body.schedule ?? null, req.body.trainerId ?? null, req.body.capacity ?? null, req.body.price ?? null, req.body.description ?? null, String(req.params.id)],
    );
    res.json({ ok: true });
  }));
  app.get('/api/gym/me/trainer', allow('COACH', 'RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER', 'MANAGER'), wrap((req, res) => {
    const linked = trainerForStaff({
      id: req.user?.id,
      email: req.user?.email,
      phone: get<{ phone: string }>('SELECT phone FROM users WHERE id = ?', [req.user?.id ?? ''])?.phone,
      name: req.user?.name,
    });
    res.json(linked ?? { trainer: null, classes: [], sessions: [], heldSlots: [] });
  }));
  app.post('/api/gym/me/trainer/claim', allow('COACH', 'SUPER_ADMIN', 'MANAGER'), wrap((req, res) => {
    if (!req.user?.id) throw new AppError(401, 'AUTH', 'Sign in again.');
    res.json(claimTrainerForUser(req.user.id, String(req.body?.trainerId ?? '')));
  }));
  app.patch('/api/gym/me/trainer', allow('COACH'), wrap((req, res) => {
    const staff = {
      id: req.user?.id,
      email: req.user?.email,
      phone: get<{ phone: string }>('SELECT phone FROM users WHERE id = ?', [req.user?.id ?? ''])?.phone,
      name: req.user?.name,
    };
    res.json(saveMyTrainerSlots(staff, req.body?.freeSlots, actor(req).name));
  }));
  app.get('/api/gym/trainers', allow('COACH', 'RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json({ trainers: listTrainers() });
  }));
  app.get('/api/gym/trainers/:id', allow('COACH', 'RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json(trainerProfile(String(req.params.id)));
  }));
  app.post('/api/gym/trainers', allow('MANAGER'), wrap((req, res) => {
    res.json(saveTrainer(req.body ?? {}, actor(req).name));
  }));
  app.patch('/api/gym/trainers/:id', allow('COACH', 'MANAGER'), wrap((req, res) => {
    if (req.user?.role === 'COACH') {
      const linked = trainerForStaff({
        id: req.user.id,
        email: req.user.email,
        phone: get<{ phone: string }>('SELECT phone FROM users WHERE id = ?', [req.user.id])?.phone,
      });
      if (!linked?.trainer || linked.trainer.id !== String(req.params.id)) {
        throw new AppError(403, 'FORBIDDEN', 'You can only edit your own trainer profile.');
      }
      const trainer = linked.trainer;
      res.json(saveTrainer({
        id: trainer.id,
        name: trainer.name,
        phone: trainer.phone,
        email: trainer.email,
        specialization: trainer.specialization,
        isActive: trainer.isActive,
        govtIdLabel: trainer.govtIdLabel,
        govtIdUrl: trainer.govtIdUrl,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : trainer.notes,
        offers: trainer.offers,
        freeSlots: req.body?.freeSlots ?? trainer.freeSlots,
        availability: typeof req.body?.availability === 'string' ? req.body.availability : trainer.availability,
      }, actor(req).name));
      return;
    }
    res.json(saveTrainer({ ...(req.body ?? {}), id: String(req.params.id) }, actor(req).name));
  }));
  app.get('/api/gym/join-requests', allow('COACH', 'RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const route = String(req.query.route ?? '');
    if (req.user?.role === 'COACH' && route !== 'TRAINER') {
      res.json({ requests: listJoinRequests('TRAINER'), idTypes: ID_TYPES });
      return;
    }
    res.json({ requests: listJoinRequests(route), idTypes: ID_TYPES });
  }));
  app.get('/api/gym/join-requests/:id', allow('COACH', 'RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const request = getJoinRequest(String(req.params.id));
    if (req.user?.role === 'COACH' && request.route !== 'TRAINER') {
      throw new AppError(403, 'FORBIDDEN', 'Trainers only handle coaching requests.');
    }
    res.json({ request, idTypes: ID_TYPES });
  }));
  app.patch('/api/gym/join-requests/:id', allow('COACH', 'RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const request = getJoinRequest(String(req.params.id));
    if (req.user?.role === 'COACH' && request.route !== 'TRAINER') {
      throw new AppError(403, 'FORBIDDEN', 'Trainers only handle coaching requests.');
    }
    res.json({ request: updateJoinRequest(String(req.params.id), req.body ?? {}, actor(req).name) });
  }));
  app.post('/api/gym/join-requests/:id/contacted', allow('COACH', 'RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const request = getJoinRequest(String(req.params.id));
    if (req.user?.role === 'COACH' && request.route !== 'TRAINER') {
      throw new AppError(403, 'FORBIDDEN', 'Trainers only handle coaching requests.');
    }
    res.json({ request: markJoinContacted(String(req.params.id), actor(req).name) });
  }));
  app.post('/api/gym/join-requests/:id/approve', allow('COACH', 'RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const request = getJoinRequest(String(req.params.id));
    if (req.user?.role === 'COACH' && request.route !== 'TRAINER') {
      throw new AppError(403, 'FORBIDDEN', 'Trainers only handle coaching requests.');
    }
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    let assignTrainerId = typeof req.body?.trainerId === 'string' ? req.body.trainerId : undefined;
    if (req.user?.role === 'COACH' && request.route === 'TRAINER') {
      const linked = trainerForStaff({
        id: req.user.id,
        email: req.user.email,
        phone: get<{ phone: string }>('SELECT phone FROM users WHERE id = ?', [req.user.id])?.phone,
      });
      assignTrainerId = linked?.trainer?.id || assignTrainerId;
      if (!assignTrainerId) throw new AppError(400, 'TRAINER', 'Pick who you are on the trainer login first.');
    }
    res.json({
      request: approveJoinRequest(
        String(req.params.id),
        req.body?.method ? String(req.body.method) : undefined,
        actor(req).name,
        notes,
        assignTrainerId,
      ),
    });
  }));
  app.post('/api/gym/join-requests/:id/decline', allow('COACH', 'RECEPTIONIST', 'CASHIER'), wrap((req, res) => {
    const request = getJoinRequest(String(req.params.id));
    if (req.user?.role === 'COACH' && request.route !== 'TRAINER') {
      throw new AppError(403, 'FORBIDDEN', 'Trainers only handle coaching requests.');
    }
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    res.json(declineJoinRequest(String(req.params.id), String(req.body?.reason ?? ''), actor(req).name, notes));
  }));
  app.post('/api/gym/classes/:id/register', allow('COACH', 'RECEPTIONIST'), wrap((req, res) => {
    const klass = get<{ capacity: number; name: string }>('SELECT capacity, name FROM gym_classes WHERE id = ?', [String(req.params.id)]);
    if (!klass) throw new AppError(404, 'CLASS', 'Class not found.');
    const taken = get<{ n: number }>("SELECT COUNT(*) AS n FROM class_registrations WHERE class_id = ? AND status = 'REGISTERED'", [String(req.params.id)])?.n ?? 0;
    const status = taken >= klass.capacity ? 'WAITLIST' : 'REGISTERED';
    const id = randomUUID();
    run(
      'INSERT INTO class_registrations (id, class_id, customer_id, name, status, attended, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      [id, String(req.params.id), req.body.customerId ?? null, String(req.body.name ?? 'Guest'), status, nowIso()],
    );
    res.json({ id, status });
  }));
  app.post('/api/gym/registrations/:id/remove', allow('COACH', 'RECEPTIONIST'), wrap((req, res) => {
    run('DELETE FROM class_registrations WHERE id = ?', [String(req.params.id)]);
    res.json({ ok: true });
  }));
  app.post('/api/gym/registrations/:id/attend', allow('COACH'), wrap((req, res) => {
    run('UPDATE class_registrations SET attended = ?, status = ? WHERE id = ?', [req.body.attended === false ? 0 : 1, 'ATTENDED', String(req.params.id)]);
    res.json({ ok: true });
  }));

  app.get('/api/gym/rentals', allow('INVENTORY_MANAGER', 'RECEPTIONIST'), wrap((_req, res) => {
    res.json({ rentals: all('SELECT * FROM equipment_rentals WHERE cafe_id = ? ORDER BY issued_at DESC', [CAFE_ID]) });
  }));
  app.post('/api/gym/rentals', allow('INVENTORY_MANAGER', 'RECEPTIONIST'), wrap((req, res) => {
    const id = randomUUID();
    const fee = Number(req.body.fee ?? 0);
    const name = String(req.body.memberName ?? '').trim();
    const equipment = String(req.body.equipment ?? '').trim();
    if (!name || !equipment) throw new AppError(400, 'RENTAL', 'Member and equipment are required.');
    if (fee > 0 && (req.body.method === 'CASH' || req.body.method === 'UPI' || req.body.method === 'CARD')) {
      const order = createStaffOrder({
        customerName: name,
        customerMobile: req.body.mobile || '',
        items: [{ menuItemId: 'gym_item_racket', quantity: 1, addonIds: [] }],
        notes: `RENTAL:${id}`,
      });
      markPaid(order.id, req.body.method, order.total);
    } else if (fee > 0 && req.body.payNow) {
      throw new AppError(400, 'PAYMENT', 'Choose cash, UPI, or card. Online Razorpay is not used for desk rentals.');
    }
    run(
      `INSERT INTO equipment_rentals (id, cafe_id, customer_id, member_name, equipment_name, inventory_item_id, issued_at, due_at, returned_at, fee, deposit, condition, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'ISSUED')`,
      [id, CAFE_ID, req.body.customerId ?? null, name, equipment, req.body.inventoryItemId ?? null, nowIso(), String(req.body.dueAt ?? addMinutes(nowIso(), 24 * 60)), fee, Number(req.body.deposit ?? 0), String(req.body.condition ?? 'GOOD')],
    );
    audit(actor(req).name, 'RENT', 'rental', id, equipment);
    res.json({ id });
  }));
  app.post('/api/gym/rentals/:id/return', allow('INVENTORY_MANAGER', 'RECEPTIONIST'), wrap((req, res) => {
    const row = get('SELECT id FROM equipment_rentals WHERE id = ? AND status = ?', [String(req.params.id), 'ISSUED']);
    if (!row) throw new AppError(404, 'RENTAL', 'Open rental not found.');
    run(`UPDATE equipment_rentals SET status = 'RETURNED', returned_at = ?, condition = ? WHERE id = ?`, [nowIso(), String(req.body?.condition ?? 'GOOD'), String(req.params.id)]);
    res.json({ ok: true });
  }));

  app.get('/api/gym/shifts', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((_req, res) => {
    res.json(listShifts());
  }));
  app.get('/api/gym/shifts/:id', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    res.json(getShift(String(req.params.id)));
  }));
  app.post('/api/gym/shifts', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    res.json(startShift(req.body ?? {}, actor(req)));
  }));
  app.patch('/api/gym/shifts/:id', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    res.json(updateShift(String(req.params.id), req.body ?? {}, actor(req).name));
  }));
  app.post('/api/gym/shifts/:id/end', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    res.json(endShift(String(req.params.id), actor(req).name));
  }));
  app.get('/api/gym/sessions', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json({ sessions: listTrainerSessions() });
  }));
  app.get('/api/gym/audit/:entityId', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    res.json({
      entries: all(
        'SELECT id, actor, action, message, created_at FROM audit_logs WHERE cafe_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 30',
        [CAFE_ID, String(req.params.entityId)],
      ),
    });
  }));
  app.post('/api/gym/audit/:entityId', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    const action = ['MESSAGE', 'NOTE', 'ACTIVITY'].includes(String(req.body?.action)) ? String(req.body.action) : 'NOTE';
    const message = String(req.body?.message ?? '').trim().slice(0, 600);
    if (!message) throw new AppError(400, 'NOTE', 'Write something first.');
    audit(actor(req).name, action, String(req.body?.entity ?? 'record').slice(0, 40), String(req.params.entityId), message);
    res.json({ ok: true });
  }));

  app.get('/api/gym/employees', allow('MANAGER'), wrap((_req, res) => {
    res.json({
      employees: all('SELECT id, name, email, role, phone, specialization, schedule_json, created_at FROM users WHERE cafe_id = ? ORDER BY name', [CAFE_ID]),
      attendance: all('SELECT * FROM employee_attendance ORDER BY noted_at DESC LIMIT 40'),
      audit: all('SELECT * FROM audit_logs WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 40', [CAFE_ID]),
    });
  }));
  app.patch('/api/gym/employees/:id', allow('MANAGER'), wrap((req, res) => {
    const role = String(req.body?.role ?? '');
    if (role && !STAFF_ROLES.includes(role as (typeof STAFF_ROLES)[number])) throw new AppError(400, 'ROLE', 'Unknown role.');
    run(
      'UPDATE users SET role = COALESCE(NULLIF(?, \'\'), role), phone = COALESCE(?, phone), specialization = COALESCE(?, specialization), schedule_json = COALESCE(?, schedule_json) WHERE id = ? AND cafe_id = ?',
      [role, req.body.phone ?? null, req.body.specialization ?? null, req.body.schedule ?? null, String(req.params.id), CAFE_ID],
    );
    audit(actor(req).name, 'EDIT_EMPLOYEE', 'user', String(req.params.id), role);
    res.json({ ok: true });
  }));
  app.post('/api/gym/employees/:id/attendance', allow('MANAGER', 'RECEPTIONIST'), wrap((req, res) => {
    const status = req.body?.status === 'OUT' ? 'OUT' : 'IN';
    run('INSERT INTO employee_attendance (id, user_id, status, noted_at, actor) VALUES (?, ?, ?, ?, ?)', [randomUUID(), String(req.params.id), status, nowIso(), actor(req).name]);
    res.json({ ok: true });
  }));

  app.get('/api/gym/notifications', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((_req, res) => {
    res.json({ notifications: all('SELECT * FROM notifications WHERE cafe_id = ? ORDER BY created_at DESC LIMIT 40', [CAFE_ID]) });
  }));
  app.post('/api/gym/notifications/:id/read', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((req, res) => {
    run('UPDATE notifications SET read_at = ? WHERE id = ?', [nowIso(), String(req.params.id)]);
    res.json({ ok: true });
  }));

  app.get('/api/portal/home', wrap((req, res) => {
    const customerId = memberIdFrom(req);
    let member = null;
    if (customerId) {
      try {
        member = memberProfile(customerId);
      } catch {
        member = null;
      }
    }
    res.json({
      plans: listPlans(false),
      facilities: listFacilities(),
      announcements: all('SELECT id, title, body, created_at FROM announcements WHERE cafe_id = ? ORDER BY created_at DESC', [CAFE_ID]),
      classes: all('SELECT id, name, category, schedule, duration_minutes, capacity, price, description, is_private FROM gym_classes WHERE cafe_id = ? AND is_active = 1', [CAFE_ID]),
      member,
      sessions: customerId ? listMemberSessions(customerId) : [],
      razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    });
  }));
  app.post('/api/portal/login', wrap(async (req, res) => {
    const email = text(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) {
        throw new AppError(400, 'EMAIL', 'Enter a valid email address.');
      }
      if (password.length < 4 || password.length > 120) {
        throw new AppError(400, 'PASSWORD', 'Enter a password of at least 4 characters.');
      }
      const row = get<{ id: string; password_hash: string; customer_id: string; mobile: string }>(
        `SELECT id, password_hash, customer_id, mobile FROM join_requests WHERE cafe_id = ? AND lower(email) = ? ORDER BY updated_at DESC LIMIT 1`,
        [CAFE_ID, email],
      );
      if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
        throw new AppError(401, 'AUTH', 'Email or password is incorrect.');
      }
      const govtIdUrl = text(req.body?.govtIdUrl);
      if (govtIdUrl) {
        if ((!govtIdUrl.startsWith('data:image/') && !govtIdUrl.startsWith('data:application/pdf')) || govtIdUrl.length > 1_500_000) {
          throw new AppError(400, 'GOVT_ID', 'Upload the ID as a photo or PDF under 1 MB.');
        }
        run('UPDATE join_requests SET govt_id_url = ?, updated_at = ? WHERE id = ?', [govtIdUrl, nowIso(), row.id]);
      }
      let customerId = row.customer_id;
      if (!customerId) {
        customerId = get<{ id: string }>(
          row.mobile
            ? 'SELECT id FROM customers WHERE cafe_id = ? AND (lower(email) = ? OR mobile = ?) LIMIT 1'
            : 'SELECT id FROM customers WHERE cafe_id = ? AND lower(email) = ? LIMIT 1',
          row.mobile ? [CAFE_ID, email, row.mobile] : [CAFE_ID, email],
        )?.id ?? '';
      }
      if (!customerId) {
        res.json({ ok: true, pending: true });
        return;
      }
      const memberToken = memberPass(customerId);
      res.setHeader('Set-Cookie', memberCookie(customerId, memberToken));
      res.json({ ok: true, pending: false, memberToken });
      return;
    }
    if (!exposeDevOtp()) {
      throw new AppError(503, 'OTP', 'Member sign-in needs the SMS OTP provider. Set OTP_PROVIDER, or sign in at the desk.');
    }
    const mobile = digits(String(req.body?.mobile ?? ''));
    const member = mobile
      ? get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, mobile])
      : undefined;
    if (!member) throw new AppError(404, 'MEMBER', 'No member uses that mobile.');
    const memberToken = memberPass(member.id);
    res.setHeader('Set-Cookie', memberCookie(member.id, memberToken));
    res.json({ ok: true, dev: true, memberToken });
  }));
  app.post('/api/portal/logout', wrap((_req, res) => {
    const secure = isProduction() ? '; Secure' : '';
    res.setHeader('Set-Cookie', `gym_member=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
    res.json({ ok: true });
  }));
  app.patch('/api/portal/me', wrap((req, res) => {
    const customerId = readMemberId(req.headers.cookie);
    if (!customerId) throw new AppError(401, 'AUTH', 'Sign in with your member mobile.');
    run(
      'UPDATE customers SET email = COALESCE(?, email), emergency_contact = COALESCE(?, emergency_contact), notify_prefs = COALESCE(?, notify_prefs) WHERE id = ?',
      [req.body.email ?? null, req.body.emergencyContact ?? null, req.body.notifyPrefs ?? null, customerId],
    );
    res.json(memberProfile(customerId));
  }));
  app.get('/api/portal/session', wrap((req, res) => {
    const customerId = memberIdFrom(req);
    if (!customerId) {
      res.json({ ok: false, memberToken: null });
      return;
    }
    const memberToken = memberPass(customerId);
    res.setHeader('Set-Cookie', memberCookie(customerId, memberToken));
    res.json({ ok: true, memberToken });
  }));
  app.post('/api/portal/gate', wrap((req, res) => {
    const incoming = typeof req.body?.memberToken === 'string' ? req.body.memberToken : '';
    const header = req.headers['x-member-pass'];
    const headerPass = Array.isArray(header) ? header[0] : header;
    const pass = incoming || headerPass || '';
    const activity = typeof req.body?.activity === 'string' ? req.body.activity : '';
    const result = scanActivityGate(activity, req.headers.cookie, pass);
    const customerId = readMemberId(req.headers.cookie, pass) || memberIdFrom(req);
    const memberToken = customerId ? memberPass(customerId) : '';
    if (customerId) res.setHeader('Set-Cookie', memberCookie(customerId, memberToken));
    res.json({ ...result, memberToken });
  }));
  app.get('/api/portal/join', wrap((_req, res) => {
    res.json(joinOptions());
  }));
  app.post('/api/portal/join', wrap(async (req, res) => {
    const body = { ...(req.body ?? {}) } as Record<string, unknown>;
    const password = typeof body.password === 'string' ? body.password : '';
    delete body.password;
    delete body.passwordHash;
    if (password) {
      if (password.length < 4 || password.length > 120) throw new AppError(400, 'PASSWORD', 'Enter a password of at least 4 characters.');
      body.passwordHash = await hashPassword(password);
    }
    const request = createJoinRequest(body);
    const row = joinRow(request.id);
    const customerId = ensureJoinCustomer(row, 'Website');
    run('UPDATE join_requests SET customer_id = ?, updated_at = ? WHERE id = ?', [customerId, nowIso(), row.id]);
    if (!activeMembership(customerId)?.active) assignPlan(customerId, 'plan_annual', 'Website');
    const memberToken = memberPass(customerId);
    res.setHeader('Set-Cookie', memberCookie(customerId, memberToken));
    res.status(201).json({ request, memberToken });
  }));
  app.get('/api/portal/join/:id', wrap((req, res) => {
    res.json({ request: getPublicJoin(String(req.params.id)) });
  }));
  app.post('/api/portal/join/:id/pay', wrap(async (req, res) => {
    res.json(await startJoinPayment(String(req.params.id)));
  }));
  app.post('/api/portal/join/:id/verify', wrap((req, res) => {
    res.json({
      request: confirmJoinPayment(
        String(req.params.id),
        String(req.body?.razorpayOrderId ?? ''),
        String(req.body?.razorpayPaymentId ?? ''),
        String(req.body?.razorpaySignature ?? ''),
      ),
    });
  }));
  app.get('/api/portal/slots', wrap((req, res) => {
    res.json(slotsFor(String(req.query.facilityId ?? ''), String(req.query.date ?? ''), Number(req.query.duration ?? 0)));
  }));
  app.get('/api/portal/sessions', wrap((req, res) => {
    const customerId = memberIdFrom(req);
    if (!customerId) throw new AppError(401, 'AUTH', 'Sign in to see bookings.');
    res.json({ requests: listMemberSessions(customerId) });
  }));
  app.post('/api/portal/sessions', wrap((req, res) => {
    const customerId = memberIdFrom(req);
    if (!customerId) throw new AppError(401, 'AUTH', 'Sign in to book a session.');
    const request = createSessionRequest(customerId, {
      sport: String(req.body?.sport ?? ''),
      startAt: String(req.body?.startAt ?? ''),
      purpose: String(req.body?.purpose ?? ''),
      remarks: String(req.body?.remarks ?? ''),
    });
    res.status(201).json({ request, note: 'Request sent to the desk.' });
  }));
  app.post('/api/portal/report', wrap((req, res) => {
    const customerId = memberIdFrom(req);
    if (!customerId) throw new AppError(401, 'AUTH', 'Sign in to send a report.');
    const request = createReportRequest(customerId, { issue: String(req.body?.issue ?? ''), remarks: String(req.body?.remarks ?? '') });
    res.status(201).json({ request, note: 'Report sent to the desk.' });
  }));
  app.post('/api/portal/bookings', wrap((req, res) => {
    const customerId = memberIdFrom(req);
    if (!customerId) throw new AppError(401, 'AUTH', 'Sign in with your member mobile.');
    const member = get<{ name: string; mobile: string }>('SELECT name, mobile FROM customers WHERE id = ?', [customerId]);
    if (!member) throw new AppError(401, 'AUTH', 'Sign in with your member mobile.');
    if (req.body?.payNow && req.body?.paymentMethod !== 'CASH') {
      throw new AppError(503, 'PAYMENT', 'Online payment is not configured. Pay at the desk, or set Razorpay keys. This booking was not marked paid.');
    }
    const booking = createBooking({
      facilityId: String(req.body.facilityId),
      customerId,
      memberName: member.name,
      memberMobile: member.mobile,
      startAt: String(req.body.startAt),
      durationMinutes: Number(req.body.durationMinutes ?? 0) || undefined,
      participants: Number(req.body.participants ?? 1),
      payNow: false,
    }, member.name);
    res.json({ booking, payment: 'UNPAID', note: 'Slot reserved. Pay at reception. It is not marked paid.' });
  }));
  app.post('/api/portal/bookings/:id/cancel', wrap((req, res) => {
    const customerId = readMemberId(req.headers.cookie);
    const row = get<{ customer_id: string; payment_status: string }>('SELECT customer_id, payment_status FROM bookings WHERE id = ?', [String(req.params.id)]);
    if (!row || row.customer_id !== customerId) throw new AppError(404, 'BOOKING', 'Booking not found.');
    if (row.payment_status === 'PAID') throw new AppError(409, 'REFUND', 'Paid bookings are cancelled at the desk so the refund is recorded.');
    res.json({ booking: setBookingStatus(String(req.params.id), 'CANCELLED', 'member') });
  }));

  comms.registerCommsRoutes(app, { allow, allowAdmin, wrap, actor });
}
