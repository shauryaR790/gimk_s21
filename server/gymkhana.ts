import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { AppError } from './appError';
import { env, exposeDevOtp, isProduction } from './env';
import { CAFE_ID } from './ids';
import { all, get, run, tx } from './db';
import { createStaffOrder, markPaid } from './logic';

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

export function memberCookie(customerId: string) {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const body = `m1.${customerId}.${exp}`;
  const token = `${body}.${sign(body)}`;
  const secure = isProduction() ? '; Secure' : '';
  return `gym_member=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 60 * 60}${secure}`;
}

export function readMemberId(header: string | undefined) {
  if (!header) return null;
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith('gym_member='));
  if (!match) return null;
  const token = decodeURIComponent(match.slice('gym_member='.length));
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'm1') return null;
  const [, customerId, expStr, sig] = parts;
  const body = `m1.${customerId}.${expStr}`;
  if (!safeEqual(sign(body), sig)) return null;
  if (Number(expStr) < Date.now()) return null;
  return customerId;
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

export function listMembers(filter = 'all', query = '') {
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
  return rows
    .map((row) => {
      const membership = activeMembership(row.id);
      const status = membership?.status ?? row.membership_status;
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
      };
    })
    .filter((member) => {
      if (needle) {
        const hay = `${member.name} ${member.mobile} ${member.memberCode} ${member.email} ${member.accessInterest} ${member.coachName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (filter === 'all') return true;
      if (filter === 'expiring') {
        return member.membershipStatus === 'ACTIVE' && Boolean(member.expiresAt) && new Date(member.expiresAt!).getTime() <= soon;
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
     WHERE b.customer_id = ? ORDER BY b.start_at DESC LIMIT 40`,
    [customerId],
  );
  const payments = all(
    `SELECT o.id, o.order_number, o.total, o.payment_status, o.created_at, o.notes
     FROM orders o WHERE o.customer_id = ? AND o.status NOT IN ('DRAFT','OTP_PENDING') ORDER BY o.created_at DESC LIMIT 40`,
    [customerId],
  );
  const checkIns = all(
    'SELECT id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at FROM check_ins WHERE customer_id = ? ORDER BY checked_in_at DESC LIMIT 40',
    [customerId],
  );
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
  return { member, bookings, payments, checkIns, upcoming, outstanding: dues, timeUsedMinutes: visitMinutes + bookingMinutes };
}

function assignPlan(customerId: string, planId: string, actor: string, status = 'ACTIVE') {
  const plan = get<PlanRow>('SELECT * FROM membership_plans WHERE id = ? AND cafe_id = ?', [planId, CAFE_ID]);
  if (!plan || plan.is_active !== 1) throw new AppError(400, 'PLAN', 'Choose an active membership plan.');
  const customer = get<{ id: string }>('SELECT id FROM customers WHERE id = ? AND cafe_id = ?', [customerId, CAFE_ID]);
  if (!customer) throw new AppError(404, 'MEMBER', 'Member not found.');
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
    ? get<{ id: string }>('SELECT id FROM customers WHERE id = ? AND cafe_id = ?', [input.id, CAFE_ID])
    : get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, mobile]);
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
  if (input.planId) return assignPlan(id, input.planId, actor);
  return memberProfile(id);
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
  return getBooking(id);
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

export function updateBooking(id: string, patch: { startAt?: string; facilityId?: string; participants?: number; memberName?: string; memberMobile?: string; notes?: string }, actor: string) {
  const current = get<{ facility_id: string; start_at: string; end_at: string; status: string; participants: number; member_name: string; member_mobile: string; notes: string }>(
    'SELECT facility_id, start_at, end_at, status, participants, member_name, member_mobile, notes FROM bookings WHERE id = ? AND cafe_id = ?',
    [id, CAFE_ID],
  );
  if (!current) throw new AppError(404, 'BOOKING', 'Booking not found.');
  if (!OPEN_BOOKING.includes(current.status)) throw new AppError(409, 'BOOKING', 'This booking can no longer be changed.');
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
    if (overlaps(facilityId, startAt, endAt, id)) throw new AppError(409, 'OVERLAP', 'That time is already booked.');
    run(
      'UPDATE bookings SET facility_id = ?, sport = ?, start_at = ?, end_at = ?, participants = ?, member_name = ?, member_mobile = ?, notes = ?, updated_at = ? WHERE id = ?',
      [facilityId, facility.sport, startAt, endAt, people, patch.memberName?.trim() || current.member_name, mobile ?? '', (patch.notes ?? current.notes ?? '').slice(0, 240), nowIso(), id],
    );
  });
  audit(actor, 'RESCHEDULE', 'booking', id, facility.name);
  return getBooking(id);
}

export function setBookingStatus(id: string, status: 'CANCELLED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW', actor: string) {
  const current = get<{ status: string; order_id: string | null; payment_status: string }>('SELECT status, order_id, payment_status FROM bookings WHERE id = ?', [id]);
  if (!current) throw new AppError(404, 'BOOKING', 'Booking not found.');
  if (status === 'CANCELLED' && current.payment_status === 'PAID') {
    throw new AppError(409, 'REFUND', 'Refund the payment before cancelling a paid booking.');
  }
  run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
  audit(actor, status, 'booking', id, status);
  return getBooking(id);
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
  return {
    booking: getBooking(id),
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
  return listFacilities().find((row) => row.id === facilityId);
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

export function checkIn(input: { query: string; guestFee?: number; payFee?: boolean; method?: 'CASH' | 'UPI' | 'CARD' }, actor: string) {
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
  const needsBooking = !membership?.active;
  if (needsBooking && !booking && !(input.guestFee && input.payFee && input.method)) {
    throw new AppError(403, 'ACCESS', 'Membership is not active. Take a booking or collect an entry fee before check-in.');
  }
  let fee = 0;
  let paymentStatus = 'UNPAID';
  if (!membership?.active && input.payFee && input.method && input.guestFee && input.guestFee > 0) {
    const pass = get('SELECT id FROM menu_items WHERE id = ?', ['gym_item_day_pass']);
    if (!pass) throw new AppError(409, 'CATALOG', 'Day pass is not on the register.');
    const order = createStaffOrder({
      customerName: member.name,
      customerMobile: member.mobile,
      items: [{ menuItemId: 'gym_item_day_pass', quantity: 1, addonIds: [] }],
      notes: 'CHECKIN',
    });
    markPaid(order.id, input.method, order.total);
    run('UPDATE orders SET customer_id = ? WHERE id = ?', [member.id, order.id]);
    fee = order.total;
    paymentStatus = 'PAID';
  }
  const id = randomUUID();
  run(
    `INSERT INTO check_ins (id, cafe_id, customer_id, member_name, booking_id, facility_name, kind, fee, payment_status, checked_in_at, checked_out_at, checked_in_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [id, CAFE_ID, member.id, member.name, booking?.id ?? null, booking?.facility ?? 'Reception', membership?.active ? 'MEMBER' : 'VISITOR', fee, paymentStatus, nowIso(), actor],
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
  };
}

export function listTrainers() {
  return all<TrainerRow>(
    'SELECT id, name, phone, email, specialization, availability, is_active, govt_id_label, notes, offers FROM trainers WHERE cafe_id = ? ORDER BY name',
    [CAFE_ID],
  ).map(mapTrainer);
}

export function trainerProfile(id: string) {
  const row = get<TrainerRow>('SELECT * FROM trainers WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
  if (!row) throw new AppError(404, 'TRAINER', 'Trainer not found.');
  return {
    trainer: mapTrainer(row),
    classes: all('SELECT id, name, category, schedule, duration_minutes, capacity, price FROM gym_classes WHERE trainer_id = ? ORDER BY name', [id]),
    sessions: listTrainerSessions(id),
  };
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
}, actor: string) {
  const name = String(input.name ?? '').trim();
  if (name.length < 2) throw new AppError(400, 'NAME', 'Enter the trainer name.');
  const phoneText = String(input.phone ?? '').trim();
  const phone = phoneText ? digits(phoneText) : '';
  if (phoneText && !phone) throw new AppError(400, 'MOBILE', 'Enter a valid 10-digit mobile number.');
  const values = [
    name,
    phone ?? '',
    String(input.email ?? '').trim().slice(0, 120),
    String(input.specialization ?? '').trim().slice(0, 80),
    String(input.availability ?? '').trim().slice(0, 120),
    input.isActive === false ? 0 : 1,
    String(input.govtIdLabel ?? '').trim().slice(0, 80),
    String(input.govtIdUrl ?? '').slice(0, 1_500_000),
    String(input.notes ?? '').slice(0, 2000),
    String(input.offers ?? '').trim().slice(0, 60),
  ];
  if (input.id) {
    const current = get('SELECT id FROM trainers WHERE id = ? AND cafe_id = ?', [input.id, CAFE_ID]);
    if (!current) throw new AppError(404, 'TRAINER', 'Trainer not found.');
    run(
      'UPDATE trainers SET name = ?, phone = ?, email = ?, specialization = ?, availability = ?, is_active = ?, govt_id_label = ?, govt_id_url = ?, notes = ?, offers = ? WHERE id = ?',
      [...values, input.id],
    );
    audit(actor, 'EDIT_TRAINER', 'trainer', input.id, name);
    return trainerProfile(input.id);
  }
  const id = randomUUID();
  run(
    `INSERT INTO trainers (name, phone, email, specialization, availability, is_active, govt_id_label, govt_id_url, notes, offers, id, cafe_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [...values, id, CAFE_ID],
  );
  audit(actor, 'ADD_TRAINER', 'trainer', id, name);
  return trainerProfile(id);
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
    { id: 'user_coach', name: 'Head Coach', email: 'coach@gymkhana.local', role: 'COACH', phone: '9000000004', specialization: 'Badminton' },
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
    }
  }
  const facilities = [
    ['fac_badminton', 'Badminton Court 1', 'Badminton', 'Indoor hall', 4, 400, 600, 'BOOKING'],
    ['fac_tennis', 'Tennis Court 1', 'Tennis', 'Outdoor', 4, 700, 1000, 'BOOKING'],
    ['fac_pool', 'Swimming Pool', 'Swimming', 'Pool deck', 30, 200, 350, 'EITHER'],
    ['fac_basketball', 'Basketball Court', 'Basketball', 'Main court', 10, 800, 1200, 'BOOKING'],
    ['fac_squash', 'Squash Court', 'Squash', 'Indoor', 2, 350, 500, 'BOOKING'],
    ['fac_gym', 'Gym', 'Fitness', 'Strength floor', 40, 0, 150, 'MEMBERSHIP'],
    ['fac_football', 'Football Ground', 'Football', 'Field', 22, 2500, 4000, 'BOOKING'],
  ] as const;
  for (const [id, name, sport, location, capacity, memberPrice, guestPrice, access] of facilities) {
    run(
      `INSERT OR IGNORE INTO facilities (id, cafe_id, name, sport, image_url, location, description, capacity, opens_at, closes_at, slot_minutes, member_price, guest_price, is_available, maintenance_status, access_rule, updated_at)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, '06:00', '22:00', 60, ?, ?, 1, 'OK', ?, ?)`,
      [id, CAFE_ID, name, sport, location, `${name} at Gymkhana`, capacity, memberPrice, guestPrice, access, nowIso()],
    );
  }
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
    ['trainer_imran', 'Imran Qureshi', '9810000004', 'imran.qureshi@gymkhana.local', 'Football', 'Mon–Sat 16:00–20:00'],
  ];
  for (const [id, name, phone, email, sport, hours] of trainers) {
    run(
      `INSERT OR IGNORE INTO trainers (id, cafe_id, name, phone, specialization, availability, is_active, email) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [id, CAFE_ID, name, phone, sport, hours, email],
    );
    run('UPDATE trainers SET name = ?, phone = ?, email = ?, specialization = ?, availability = ? WHERE id = ?', [name, phone, email, sport, hours, id]);
  }
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
  if (get("SELECT id FROM customers WHERE id = 'visitor_meera' AND membership_status != 'ACTIVE'")) assignPlan('visitor_meera', 'plan_monthly', 'seed');
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
  const inside: [string, string, string, string, string][] = [
    ['cin_rahul', 'visitor_rahul', 'Rahul Iyer', 'Badminton Court 1', 'VISITOR'],
    ['cin_kabir', 'visitor_kabir', 'Kabir Das', 'Football Ground', 'VISITOR'],
    ['cin_leela', 'visitor_leela', 'Leela Nair', 'Swimming Pool', 'MEMBER'],
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
  const actor = (req: Request): Actor => ({ id: req.user?.id ?? '', name: req.user?.name ?? 'Staff', role: req.user?.role ?? '' });

  app.get('/api/gym/overview', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER', 'INVENTORY_MANAGER'), wrap((_req, res) => {
    res.json(overview());
  }));
  app.get('/api/gym/reports', allow('RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json(gymReport());
  }));
  app.get('/api/gym/members', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json({ members: listMembers(String(req.query.filter ?? 'all'), String(req.query.q ?? '')) });
  }));
  app.get('/api/gym/members/:id', allow('RECEPTIONIST', 'CASHIER', 'COACH', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json(memberProfile(String(req.params.id)));
  }));
  app.post('/api/gym/members', allow('RECEPTIONIST'), wrap((req, res) => {
    res.json(saveMember(req.body, actor(req).name));
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
    }
    audit(actor(req).name, 'MAINTENANCE', 'facility', id, title);
    res.json({ facilities: listFacilities() });
  }));
  app.post('/api/gym/maintenance', allow('FACILITY_MANAGER', 'RECEPTIONIST'), wrap((req, res) => {
    const facilityId = String(req.body?.facilityId ?? '');
    const title = String(req.body?.title ?? '').trim();
    if (!facilityId || !title) throw new AppError(400, 'MAINTENANCE', 'Choose a facility and a task.');
    const facility = get('SELECT id FROM facilities WHERE id = ? AND cafe_id = ?', [facilityId, CAFE_ID]);
    if (!facility) throw new AppError(404, 'FACILITY', 'Facility not found.');
    const who = actor(req).name;
    const id = randomUUID();
    run(
      `INSERT INTO maintenance_records (id, cafe_id, facility_id, title, notes, status, starts_at, ends_at, created_at, actor) VALUES (?, ?, ?, ?, ?, 'OPEN', ?, NULL, ?, ?)`,
      [id, CAFE_ID, facilityId, title.slice(0, 120), String(req.body?.notes ?? '').slice(0, 2000), nowIso(), nowIso(), who],
    );
    if (req.body?.block) {
      run(`UPDATE facilities SET is_available = 0, maintenance_status = 'MAINTENANCE', updated_at = ? WHERE id = ?`, [nowIso(), facilityId]);
    }
    audit(who, 'MAINTENANCE', 'maintenance', id, title);
    res.json({ id });
  }));
  app.patch('/api/gym/maintenance/:id', allow('FACILITY_MANAGER', 'RECEPTIONIST'), wrap((req, res) => {
    const id = String(req.params.id);
    const row = get<{ facility_id: string; title: string; notes: string }>('SELECT facility_id, title, notes FROM maintenance_records WHERE id = ? AND cafe_id = ?', [id, CAFE_ID]);
    if (!row) throw new AppError(404, 'MAINTENANCE', 'Task not found.');
    const title = String(req.body?.title ?? row.title).trim();
    if (!title) throw new AppError(400, 'MAINTENANCE', 'Enter the task.');
    const facilityId = String(req.body?.facilityId ?? row.facility_id);
    if (!get('SELECT id FROM facilities WHERE id = ? AND cafe_id = ?', [facilityId, CAFE_ID])) throw new AppError(404, 'FACILITY', 'Facility not found.');
    run('UPDATE maintenance_records SET title = ?, notes = ?, facility_id = ? WHERE id = ?', [title.slice(0, 120), String(req.body?.notes ?? row.notes).slice(0, 2000), facilityId, id]);
    audit(actor(req).name, 'EDIT_TASK', 'maintenance', id, title);
    res.json({ id });
  }));
  app.get('/api/gym/maintenance', allow('FACILITY_MANAGER', 'RECEPTIONIST'), wrap((_req, res) => {
    res.json({
      records: all(
        `SELECT m.id, m.title, m.notes, m.status, m.starts_at, m.ends_at, m.actor, m.facility_id, f.name AS facility
         FROM maintenance_records m JOIN facilities f ON f.id = m.facility_id WHERE m.cafe_id = ? ORDER BY m.starts_at DESC`,
        [CAFE_ID],
      ),
    });
  }));
  app.post('/api/gym/maintenance/:id/close', allow('FACILITY_MANAGER', 'RECEPTIONIST'), wrap((req, res) => {
    const row = get<{ facility_id: string }>('SELECT facility_id FROM maintenance_records WHERE id = ?', [String(req.params.id)]);
    if (!row) throw new AppError(404, 'MAINTENANCE', 'Record not found.');
    run(`UPDATE maintenance_records SET status = 'CLOSED', ends_at = ? WHERE id = ?`, [nowIso(), String(req.params.id)]);
    run(`UPDATE facilities SET is_available = 1, maintenance_status = 'OK', updated_at = ? WHERE id = ?`, [nowIso(), row.facility_id]);
    audit(actor(req).name, 'TASK_DONE', 'maintenance', String(req.params.id), 'Marked done');
    res.json({ ok: true });
  }));

  app.get('/api/gym/plans', allow('RECEPTIONIST', 'CASHIER'), wrap((_req, res) => {
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
    if (!['CANCELLED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW'].includes(status)) throw new AppError(400, 'STATUS', 'Unknown booking status.');
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
      registrations: all(`SELECT r.*, c.name AS class_name FROM class_registrations r LEFT JOIN gym_classes c ON c.id = r.class_id ORDER BY r.created_at DESC LIMIT 100`),
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
  app.get('/api/gym/trainers', allow('COACH', 'RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((_req, res) => {
    res.json({ trainers: listTrainers() });
  }));
  app.get('/api/gym/trainers/:id', allow('COACH', 'RECEPTIONIST', 'CASHIER', 'FACILITY_MANAGER'), wrap((req, res) => {
    res.json(trainerProfile(String(req.params.id)));
  }));
  app.post('/api/gym/trainers', allow('COACH', 'MANAGER'), wrap((req, res) => {
    res.json(saveTrainer(req.body ?? {}, actor(req).name));
  }));
  app.patch('/api/gym/trainers/:id', allow('COACH', 'MANAGER'), wrap((req, res) => {
    res.json(saveTrainer({ ...(req.body ?? {}), id: String(req.params.id) }, actor(req).name));
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
    const customerId = readMemberId(req.headers.cookie);
    res.json({
      plans: listPlans(false),
      facilities: listFacilities(),
      announcements: all('SELECT id, title, body, created_at FROM announcements WHERE cafe_id = ? ORDER BY created_at DESC', [CAFE_ID]),
      classes: all('SELECT id, name, category, schedule, duration_minutes, capacity, price, description, is_private FROM gym_classes WHERE cafe_id = ? AND is_active = 1', [CAFE_ID]),
      member: customerId ? memberProfile(customerId) : null,
      razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    });
  }));
  app.post('/api/portal/login', wrap((req, res) => {
    if (!exposeDevOtp()) {
      throw new AppError(503, 'OTP', 'Member sign-in needs the SMS OTP provider. Set OTP_PROVIDER, or sign in at the desk.');
    }
    const mobile = digits(String(req.body?.mobile ?? ''));
    const member = mobile
      ? get<{ id: string }>('SELECT id FROM customers WHERE cafe_id = ? AND mobile = ?', [CAFE_ID, mobile])
      : undefined;
    if (!member) throw new AppError(404, 'MEMBER', 'No member uses that mobile.');
    res.setHeader('Set-Cookie', memberCookie(member.id));
    res.json({ ok: true, dev: true });
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
  app.get('/api/portal/slots', wrap((req, res) => {
    res.json(slotsFor(String(req.query.facilityId ?? ''), String(req.query.date ?? ''), Number(req.query.duration ?? 0)));
  }));
  app.post('/api/portal/bookings', wrap((req, res) => {
    const customerId = readMemberId(req.headers.cookie);
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
}
