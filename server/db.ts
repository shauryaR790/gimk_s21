import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from './env';

function openDatabase(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 4000');
  if (file !== ':memory:' && !file.startsWith('/tmp')) database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
CREATE TABLE IF NOT EXISTS cafes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tax_bps INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  qr_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'Ground Floor',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  category_id TEXT NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL,
  image_url TEXT,
  is_veg INTEGER NOT NULL,
  is_available INTEGER NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  shortcut_num TEXT,
  shortcut_alpha TEXT,
  sort_order INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS addon_groups (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  min_select INTEGER NOT NULL,
  max_select INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS addons (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES addon_groups(id),
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  is_available INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_item_addon_groups (
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  addon_group_id TEXT NOT NULL REFERENCES addon_groups(id),
  PRIMARY KEY (menu_item_id, addon_group_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  last_order_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(cafe_id, mobile)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  table_id TEXT REFERENCES tables(id),
  table_name TEXT NOT NULL DEFAULT '',
  customer_id TEXT REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_mobile TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  source TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  client_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT,
  UNIQUE(cafe_id, order_number)
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  menu_item_id TEXT,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_item_addons (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL REFERENCES order_items(id),
  addon_id TEXT,
  name_snapshot TEXT NOT NULL,
  price_snapshot INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  mobile TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_counters (
  cafe_id TEXT PRIMARY KEY REFERENCES cafes(id),
  next_number INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  table_id TEXT NOT NULL REFERENCES tables(id),
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  covers INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_order ON otp_challenges(order_id, created_at);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Raw material',
  unit TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  cost_per_unit INTEGER NOT NULL DEFAULT 0,
  supplier TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  kind TEXT NOT NULL,
  qty_delta REAL NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'staff'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_mov_ref ON inventory_movements(item_id, reference) WHERE reference != '';

CREATE TABLE IF NOT EXISTS menu_recipes (
  menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id),
  qty_per_portion REAL NOT NULL,
  PRIMARY KEY (menu_item_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_items_cafe ON inventory_items(cafe_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inv_mov_cafe ON inventory_movements(cafe_id, created_at);
`);
  migrate(database);
  return database;
}

function tableColumns(database: DatabaseSync, table: string) {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((col) => col.name);
}

function addColumn(database: DatabaseSync, table: string, name: string, definition: string) {
  if (!tableColumns(database, table).includes(name)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

function migrate(database: DatabaseSync) {
  addColumn(database, 'tables', 'area', "TEXT NOT NULL DEFAULT 'Ground Floor'");
  addColumn(database, 'menu_items', 'is_favorite', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'menu_items', 'shortcut_num', 'TEXT');
  addColumn(database, 'menu_items', 'shortcut_alpha', 'TEXT');
  addColumn(database, 'menu_items', 'menu_lead', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'menu_items', 'menu_subtitle', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'menu_items', 'kcal_label', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'menu_items', 'ingredients_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(database, 'menu_items', 'sheet_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(database, 'orders', 'session_id', 'TEXT');
  addColumn(database, 'order_items', 'course', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'order_items', 'sent_at', 'TEXT');
  addColumn(database, 'customers', 'email', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'street', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'street2', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'city', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'zip', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'state', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'country', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'gstin', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'barcode', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'tags', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
CREATE TABLE IF NOT EXISTS pos_configs (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  is_restaurant INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pos_sessions (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES pos_configs(id),
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opened_by TEXT NOT NULL,
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  counted_cash REAL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pos_cash_moves (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES pos_sessions(id),
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS floors (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  background TEXT NOT NULL DEFAULT 'wood'
);
CREATE TABLE IF NOT EXISTS table_geometry (
  table_id TEXT PRIMARY KEY REFERENCES tables(id),
  floor_id TEXT NOT NULL REFERENCES floors(id),
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 80,
  h REAL NOT NULL DEFAULT 80,
  seats INTEGER NOT NULL DEFAULT 4,
  shape TEXT NOT NULL DEFAULT 'square',
  color TEXT NOT NULL DEFAULT '#28a745'
);
`);
  addColumn(database, 'pos_sessions', 'sequence', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'customers', 'member_code', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'membership_status', "TEXT NOT NULL DEFAULT 'PENDING'");
  addColumn(database, 'customers', 'plan_id', 'TEXT');
  addColumn(database, 'customers', 'membership_expires_at', 'TEXT');
  addColumn(database, 'customers', 'photo_url', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'emergency_contact', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'notify_prefs', "TEXT NOT NULL DEFAULT 'sms,email'");
  addColumn(database, 'customers', 'frozen_until', 'TEXT');
  addColumn(database, 'customers', 'access_interest', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'govt_id_label', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'govt_id_url', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'coach_id', 'TEXT');
  addColumn(database, 'customers', 'notes', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'users', 'phone', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'users', 'specialization', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'users', 'schedule_json', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  sport TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 1,
  opens_at TEXT NOT NULL DEFAULT '06:00',
  closes_at TEXT NOT NULL DEFAULT '22:00',
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  member_price INTEGER NOT NULL DEFAULT 0,
  guest_price INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  maintenance_status TEXT NOT NULL DEFAULT 'OK',
  access_rule TEXT NOT NULL DEFAULT 'BOOKING',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS membership_plans (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  price INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  facility_access TEXT NOT NULL DEFAULT 'ALL',
  booking_privileges TEXT NOT NULL DEFAULT '',
  discount_bps INTEGER NOT NULL DEFAULT 0,
  guest_passes INTEGER NOT NULL DEFAULT 0,
  renewal_days INTEGER NOT NULL DEFAULT 7,
  freeze_days INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  plan_id TEXT NOT NULL REFERENCES membership_plans(id),
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  frozen_until TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  member_name TEXT NOT NULL,
  member_mobile TEXT NOT NULL DEFAULT '',
  sport TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  participants INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  payment_method TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_participants (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_bookings_facility ON bookings(facility_id, start_at, end_at, status);
CREATE TABLE IF NOT EXISTS trainers (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  specialization TEXT NOT NULL DEFAULT '',
  availability TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS gym_classes (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  trainer_id TEXT REFERENCES trainers(id),
  schedule TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  capacity INTEGER NOT NULL DEFAULT 12,
  price INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  is_private INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS class_registrations (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES gym_classes(id),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REGISTERED',
  attended INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equipment_rentals (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  member_name TEXT NOT NULL,
  equipment_name TEXT NOT NULL,
  inventory_item_id TEXT,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  fee INTEGER NOT NULL DEFAULT 0,
  deposit INTEGER NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'GOOD',
  status TEXT NOT NULL DEFAULT 'ISSUED'
);
CREATE TABLE IF NOT EXISTS check_ins (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  member_name TEXT NOT NULL,
  booking_id TEXT,
  facility_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'MEMBER',
  fee INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  checked_in_at TEXT NOT NULL,
  checked_out_at TEXT
);
CREATE TABLE IF NOT EXISTS maintenance_records (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  facility_id TEXT NOT NULL REFERENCES facilities(id),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  audience TEXT NOT NULL DEFAULT 'staff',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL REFERENCES cafes(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desk_shifts (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS employee_attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  noted_at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS trainer_sessions (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  trainer_id TEXT NOT NULL DEFAULT '',
  trainer_name TEXT NOT NULL,
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  facility TEXT NOT NULL DEFAULT '',
  activity TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'Group class',
  participants INTEGER NOT NULL DEFAULT 1,
  visitors TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL DEFAULT 0,
  payment TEXT NOT NULL DEFAULT 'Included in plan',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trainer_sessions_shift ON trainer_sessions(shift_id);
CREATE TABLE IF NOT EXISTS join_requests (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  ref_no INTEGER NOT NULL,
  sport TEXT NOT NULL,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  dob TEXT NOT NULL DEFAULT '',
  govt_id_label TEXT NOT NULL DEFAULT '',
  govt_id_url TEXT NOT NULL DEFAULT '',
  wants_trainer INTEGER NOT NULL DEFAULT 0,
  trainer_id TEXT NOT NULL DEFAULT '',
  preferred_slot TEXT NOT NULL DEFAULT '',
  plan_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  payment_method TEXT NOT NULL DEFAULT '',
  razorpay_order_id TEXT NOT NULL DEFAULT '',
  razorpay_payment_id TEXT NOT NULL DEFAULT '',
  order_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW',
  handled_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_join_requests_created ON join_requests(created_at);
CREATE TABLE IF NOT EXISTS seed_marks (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`);
  addColumn(database, 'trainers', 'email', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'trainers', 'govt_id_label', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'trainers', 'govt_id_url', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'trainers', 'notes', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'trainers', 'offers', "TEXT NOT NULL DEFAULT 'group,private'");
  addColumn(database, 'trainers', 'free_slots', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'join_requests', 'pincode', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'join_requests', 'is_member', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'join_requests', 'become_member', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'join_requests', 'photo_url', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'join_requests', 'password_hash', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'customers', 'dob', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'bookings', 'created_by', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'check_ins', 'checked_in_by', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'maintenance_records', 'actor', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'maintenance_records', 'category', "TEXT NOT NULL DEFAULT 'Repair'");
  addColumn(database, 'maintenance_records', 'priority', "TEXT NOT NULL DEFAULT 'NORMAL'");
  addColumn(database, 'maintenance_records', 'assigned_to', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'maintenance_records', 'cost', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(database, 'desk_shifts', 'phone', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'email', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'role_label', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'govt_id_label', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'govt_id_url', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'areas', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'notes', "TEXT NOT NULL DEFAULT ''");
  addColumn(database, 'desk_shifts', 'opened_by', "TEXT NOT NULL DEFAULT ''");
  database.exec(`
CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL UNIQUE,
  phone_number_id TEXT NOT NULL DEFAULT '',
  waba_id TEXT NOT NULL DEFAULT '',
  graph_version TEXT NOT NULL DEFAULT 'v21.0',
  webhook_verify_token TEXT NOT NULL DEFAULT '',
  test_number TEXT NOT NULL DEFAULT '',
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  booking_reminder_hours INTEGER NOT NULL DEFAULT 24,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS communication_consent (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNKNOWN',
  marketing_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  source TEXT NOT NULL DEFAULT '',
  wording TEXT NOT NULL DEFAULT '',
  consented_at TEXT,
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(cafe_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_comm_consent_customer ON communication_consent(customer_id);
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  key TEXT NOT NULL,
  meta_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL DEFAULT 'UTILITY',
  status TEXT NOT NULL DEFAULT 'NOT_SYNCED',
  body TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT,
  UNIQUE(cafe_id, key, language)
);
CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  type TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_events_type ON notification_events(cafe_id, type, created_at);
CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  template_key TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  audience TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_created ON whatsapp_campaigns(cafe_id, created_at);
CREATE TABLE IF NOT EXISTS notification_queue (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  campaign_id TEXT,
  customer_id TEXT NOT NULL DEFAULT '',
  to_mobile TEXT NOT NULL,
  template_key TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL,
  variables_json TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(cafe_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_wa_queue_next ON notification_queue(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  campaign_id TEXT,
  queue_id TEXT,
  customer_id TEXT NOT NULL DEFAULT '',
  to_mobile TEXT NOT NULL,
  template_key TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  wa_message_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_wa_id ON whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_customer ON whatsapp_messages(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status ON whatsapp_messages(cafe_id, status, created_at);
CREATE TABLE IF NOT EXISTS whatsapp_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'QUEUED',
  excluded_reason TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wa_recipients_campaign ON whatsapp_recipients(campaign_id);
CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  id TEXT PRIMARY KEY,
  cafe_id TEXT NOT NULL,
  wa_message_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);
`);
  const userVersion = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (userVersion < 2) {
    database.exec('UPDATE orders SET customer_id = NULL');
    database.exec('DELETE FROM customers');
    database.exec('PRAGMA user_version = 2');
  }
}

let current: DatabaseSync | null = null;

function live() {
  if (!current) current = openDatabase(env.dbPath);
  return current;
}

export const db: DatabaseSync = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const database = live();
    const value = database[prop as keyof DatabaseSync];
    if (typeof value === 'function') return (value as (...args: unknown[]) => unknown).bind(database);
    return value;
  },
});

export function adoptIncoming() {
  const incoming = `${env.dbPath}.incoming`;
  if (!existsSync(incoming)) return;
  try {
    current?.close();
  } catch {
    /* already closed */
  }
  current = null;
  rmSync(env.dbPath, { force: true });
  rmSync(`${env.dbPath}-wal`, { force: true });
  rmSync(`${env.dbPath}-shm`, { force: true });
  renameSync(incoming, env.dbPath);
  current = openDatabase(env.dbPath);
}

type SqlValue = string | number | null | bigint;

export function all<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, params: SqlValue[] = []) {
  return db.prepare(sql).run(...params);
}

let txDepth = 0;

export function tx<T>(fn: () => T): T {
  if (txDepth > 0) {
    txDepth += 1;
    try {
      return fn();
    } finally {
      txDepth -= 1;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already closed */
    }
    throw error;
  } finally {
    txDepth = 0;
  }
}
