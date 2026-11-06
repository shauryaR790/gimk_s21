export const SLOT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const SLOT_HOURS = Array.from({ length: 16 }, (_, index) => `${String(index + 6).padStart(2, '0')}:00`);

export type SlotDay = (typeof SLOT_DAYS)[number];

export function slotKey(day: SlotDay, hour: string) {
  return `${day} ${hour}`;
}

function parts(slot: string) {
  const [day, hour] = slot.split(' ');
  return { day: SLOT_DAYS.indexOf(day as SlotDay), hour: SLOT_HOURS.indexOf(hour ?? '') };
}

export function normalizeSlots(input: unknown): string[] {
  const list = Array.isArray(input) ? input : typeof input === 'string' && input.trim() ? safeParse(input) : [];
  const seen = new Set<string>();
  for (const value of list) {
    const slot = String(value).trim();
    const { day, hour } = parts(slot);
    if (day >= 0 && hour >= 0) seen.add(slot);
  }
  return [...seen].sort((a, b) => {
    const left = parts(a);
    const right = parts(b);
    return left.day - right.day || left.hour - right.hour;
  });
}

function safeParse(text: string): unknown[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function hourEnd(index: number) {
  return `${String(index + 7).padStart(2, '0')}:00`;
}

export function slotLabel(slot: string) {
  const { day, hour } = parts(slot);
  if (day < 0 || hour < 0) return slot;
  return `${SLOT_DAYS[day]} ${SLOT_HOURS[hour]}–${hourEnd(hour)}`;
}

function dayRanges(hours: number[]) {
  const ranges: string[] = [];
  let start = -1;
  let last = -1;
  for (const hour of [...hours, Number.POSITIVE_INFINITY]) {
    if (start >= 0 && hour === last + 1) {
      last = hour;
      continue;
    }
    if (start >= 0) ranges.push(`${SLOT_HOURS[start]}–${hourEnd(last)}`);
    start = hour;
    last = hour;
  }
  return ranges.join(', ');
}

export function summarizeSlots(slots: string[]) {
  const byDay = SLOT_DAYS.map(() => [] as number[]);
  for (const slot of normalizeSlots(slots)) {
    const { day, hour } = parts(slot);
    byDay[day].push(hour);
  }
  const signatures = byDay.map((hours) => (hours.length ? dayRanges(hours) : ''));
  const groups: string[] = [];
  let index = 0;
  while (index < SLOT_DAYS.length) {
    const signature = signatures[index];
    if (!signature) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < SLOT_DAYS.length && signatures[end + 1] === signature) end += 1;
    const days = end - index >= 2
      ? `${SLOT_DAYS[index]}–${SLOT_DAYS[end]}`
      : SLOT_DAYS.slice(index, end + 1).join(', ');
    groups.push(`${days} ${signature}`);
    index = end + 1;
  }
  return groups.join(' · ');
}

export function slotsBetween(days: SlotDay[], fromHour: number, toHour: number) {
  const slots: string[] = [];
  for (const day of days) {
    for (let hour = fromHour; hour < toHour; hour += 1) {
      const label = `${String(hour).padStart(2, '0')}:00`;
      if (SLOT_HOURS.includes(label)) slots.push(slotKey(day, label));
    }
  }
  return slots;
}
