export const COMM_CONSENT = ['OPT_IN', 'UNKNOWN', 'OPT_OUT'] as const;
export type CommConsent = (typeof COMM_CONSENT)[number];

export const COMM_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'] as const;
export type CommCategory = (typeof COMM_CATEGORIES)[number];

export const COMM_TEMPLATE_KEYS = [
  'membership_welcome',
  'membership_expiry_14d',
  'membership_renewed',
  'membership_expired',
  'payment_success',
  'payment_failed',
  'booking_confirmed',
  'booking_reminder',
  'booking_cancelled',
  'booking_rescheduled',
  'facility_maintenance',
  'facility_reopened',
  'trainer_assigned',
  'session_scheduled',
  'session_rescheduled',
  'session_cancelled',
  'announcement',
] as const;
export type CommTemplateKey = (typeof COMM_TEMPLATE_KEYS)[number];

export type CommTemplateVar = { key: string; label: string };

export type CommTemplateDef = {
  key: CommTemplateKey;
  metaName: string;
  label: string;
  category: CommCategory;
  event?: string;
  variables: CommTemplateVar[];
  body: string;
};

export const COMM_TEMPLATES: CommTemplateDef[] = [
  {
    key: 'membership_welcome',
    metaName: 'membership_welcome',
    label: 'Membership activated',
    category: 'UTILITY',
    event: 'MEMBERSHIP_ACTIVATED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'membership_id', label: 'Membership ID' },
      { key: 'expiry_date', label: 'Expiry date' },
    ],
    body: 'Hello {{name}}, welcome to Gymkhana! Your membership has been successfully activated. Your membership ID is {{membership_id}} and your membership is valid until {{expiry_date}}. We look forward to seeing you!',
  },
  {
    key: 'membership_expiry_14d',
    metaName: 'membership_expiry_14d',
    label: '14-day expiry reminder',
    category: 'UTILITY',
    event: 'MEMBERSHIP_EXPIRY_14D',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'expiry_date', label: 'Expiry date' },
      { key: 'membership_id', label: 'Membership ID' },
    ],
    body: 'Hello {{name}}, this is a reminder that your Gymkhana membership expires on {{expiry_date}}. Please renew your membership to continue enjoying our facilities. Member ID: {{membership_id}}.',
  },
  {
    key: 'membership_renewed',
    metaName: 'membership_renewed',
    label: 'Membership renewed',
    category: 'UTILITY',
    event: 'MEMBERSHIP_RENEWED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'new_expiry_date', label: 'New expiry date' },
    ],
    body: 'Hello {{name}}, thank you for renewing your Gymkhana membership! Your membership has been successfully renewed and is valid until {{new_expiry_date}}.',
  },
  {
    key: 'membership_expired',
    metaName: 'membership_expired',
    label: 'Membership expired',
    category: 'UTILITY',
    event: 'MEMBERSHIP_EXPIRED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'membership_id', label: 'Membership ID' },
    ],
    body: 'Hello {{name}}, your Gymkhana membership ({{membership_id}}) has expired. Visit reception to renew and keep using the facilities.',
  },
  {
    key: 'payment_success',
    metaName: 'payment_success',
    label: 'Payment successful',
    category: 'UTILITY',
    event: 'PAYMENT_SUCCESS',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'amount', label: 'Amount' },
      { key: 'transaction_id', label: 'Transaction ID' },
      { key: 'payment_date', label: 'Payment date' },
      { key: 'membership_ref', label: 'Reference' },
    ],
    body: 'Hello {{name}}, we received your Gymkhana payment of {{amount}} on {{payment_date}}. Transaction {{transaction_id}}. Reference: {{membership_ref}}.',
  },
  {
    key: 'payment_failed',
    metaName: 'payment_failed',
    label: 'Payment failed',
    category: 'UTILITY',
    event: 'PAYMENT_FAILED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'amount', label: 'Amount' },
    ],
    body: 'Hello {{name}}, we could not complete your Gymkhana payment of {{amount}}. You can try again from the desk or the join page.',
  },
  {
    key: 'booking_confirmed',
    metaName: 'booking_confirmed',
    label: 'Booking confirmed',
    category: 'UTILITY',
    event: 'BOOKING_CONFIRMED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'booking_id', label: 'Booking ID' },
      { key: 'facility', label: 'Facility' },
      { key: 'sport', label: 'Sport' },
      { key: 'booking_date', label: 'Date' },
      { key: 'start_time', label: 'Start' },
      { key: 'end_time', label: 'End' },
      { key: 'amount', label: 'Amount' },
    ],
    body: 'Hello {{name}}, your Gymkhana booking {{booking_id}} is confirmed. {{facility}} ({{sport}}) on {{booking_date}} from {{start_time}} to {{end_time}}. Amount: {{amount}}.',
  },
  {
    key: 'booking_reminder',
    metaName: 'booking_reminder',
    label: 'Booking reminder',
    category: 'UTILITY',
    event: 'BOOKING_REMINDER',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'facility', label: 'Facility' },
      { key: 'booking_date', label: 'Date' },
      { key: 'start_time', label: 'Start' },
    ],
    body: 'Hello {{name}}, reminder: you have {{facility}} booked on {{booking_date}} at {{start_time}}. See you at Gymkhana.',
  },
  {
    key: 'booking_cancelled',
    metaName: 'booking_cancelled',
    label: 'Booking cancelled',
    category: 'UTILITY',
    event: 'BOOKING_CANCELLED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'booking_id', label: 'Booking ID' },
      { key: 'facility', label: 'Facility' },
      { key: 'refund_status', label: 'Refund' },
    ],
    body: 'Hello {{name}}, booking {{booking_id}} for {{facility}} has been cancelled. Refund: {{refund_status}}.',
  },
  {
    key: 'booking_rescheduled',
    metaName: 'booking_rescheduled',
    label: 'Booking rescheduled',
    category: 'UTILITY',
    event: 'BOOKING_RESCHEDULED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'facility', label: 'Facility' },
      { key: 'old_when', label: 'Previous slot' },
      { key: 'new_when', label: 'New slot' },
    ],
    body: 'Hello {{name}}, your {{facility}} booking moved from {{old_when}} to {{new_when}}.',
  },
  {
    key: 'facility_maintenance',
    metaName: 'facility_maintenance',
    label: 'Facility maintenance',
    category: 'UTILITY',
    event: 'FACILITY_MAINTENANCE',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'facility', label: 'Facility' },
      { key: 'booking_date', label: 'Date' },
      { key: 'start_time', label: 'Start' },
    ],
    body: 'Hello {{name}}, {{facility}} is under maintenance. Your booking on {{booking_date}} at {{start_time}} is affected. Please check with reception.',
  },
  {
    key: 'facility_reopened',
    metaName: 'facility_reopened',
    label: 'Facility reopened',
    category: 'UTILITY',
    event: 'FACILITY_REOPENED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'facility', label: 'Facility' },
    ],
    body: 'Hello {{name}}, {{facility}} is available again at Gymkhana.',
  },
  {
    key: 'trainer_assigned',
    metaName: 'trainer_assigned',
    label: 'Trainer assigned',
    category: 'UTILITY',
    event: 'TRAINER_ASSIGNED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'trainer_name', label: 'Trainer' },
      { key: 'sport', label: 'Sport' },
    ],
    body: 'Hello {{name}}, {{trainer_name}} is now your Gymkhana trainer{{sport}}.',
  },
  {
    key: 'session_scheduled',
    metaName: 'session_scheduled',
    label: 'Session scheduled',
    category: 'UTILITY',
    event: 'SESSION_SCHEDULED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'trainer_name', label: 'Trainer' },
      { key: 'session_date', label: 'Date' },
      { key: 'start_time', label: 'Time' },
      { key: 'location', label: 'Location' },
      { key: 'session_ref', label: 'Reference' },
    ],
    body: 'Hello {{name}}, your session with {{trainer_name}} is on {{session_date}} at {{start_time}} ({{location}}). Ref {{session_ref}}.',
  },
  {
    key: 'session_rescheduled',
    metaName: 'session_rescheduled',
    label: 'Session rescheduled',
    category: 'UTILITY',
    event: 'SESSION_RESCHEDULED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'trainer_name', label: 'Trainer' },
      { key: 'session_date', label: 'Date' },
      { key: 'start_time', label: 'Time' },
    ],
    body: 'Hello {{name}}, your session with {{trainer_name}} moved to {{session_date}} at {{start_time}}.',
  },
  {
    key: 'session_cancelled',
    metaName: 'session_cancelled',
    label: 'Session cancelled',
    category: 'UTILITY',
    event: 'SESSION_CANCELLED',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'trainer_name', label: 'Trainer' },
      { key: 'session_date', label: 'Date' },
    ],
    body: 'Hello {{name}}, your session with {{trainer_name}} on {{session_date}} has been cancelled.',
  },
  {
    key: 'announcement',
    metaName: 'club_announcement',
    label: 'Club announcement',
    category: 'MARKETING',
    variables: [
      { key: 'name', label: 'Name' },
      { key: 'headline', label: 'Headline' },
      { key: 'details', label: 'Details' },
    ],
    body: 'Hello {{name}}, Gymkhana update: {{headline}}. {{details}}',
  },
];

export const COMM_AUDIENCES = [
  { id: 'eligible', label: 'All eligible opted-in members' },
  { id: 'selected', label: 'Selected members' },
  { id: 'expiring14', label: 'Membership expiring in 14 days' },
  { id: 'expiring7', label: 'Membership expiring in 7 days' },
  { id: 'expiring30', label: 'Membership expiring in 30 days' },
  { id: 'booked', label: 'Members with confirmed bookings' },
  { id: 'sport', label: 'Members booked for a sport' },
  { id: 'trainer', label: 'Members assigned to a trainer' },
  { id: 'maintenance', label: 'Members affected by facility maintenance' },
  { id: 'renewed_recent', label: 'Recently purchased or renewed' },
] as const;

export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

export function templateByKey(key: string) {
  return COMM_TEMPLATES.find((row) => row.key === key);
}

export function templateByEvent(event: string) {
  return COMM_TEMPLATES.find((row) => row.event === event);
}
