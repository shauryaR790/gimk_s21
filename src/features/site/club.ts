export function clubDay(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

export function renewDay(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
}

export function yearOn(start: string | null | undefined) {
  if (!start) return null;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return null;
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

export function badgeCode(code: string) {
  const digits = code.replace(/^GK/i, '').replace(/\D/g, '');
  return digits || code || '—';
}

export function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export function upcomingDates(count = 21) {
  const start = new Date(`${todayIso()}T12:00:00+05:30`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      value: date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      label: date.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    };
  });
}

export type ClubNews = { title: string; body: string };

export function dashboardNews(announcements: { title?: string; body?: string }[]): ClubNews {
  const top = announcements.find((row) => row.title || row.body);
  if (top?.title || top?.body) {
    return { title: top.title?.trim() || 'Gymkhana', body: (top.body || '').trim() };
  }
  const fest = festivalLine();
  if (fest) return { title: 'Gymkhana', body: fest };
  return { title: 'Gymkhana', body: 'Welcome in. Courts, racks, and water. The rest is you.' };
}

function festivalLine(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit' }).formatToParts(now);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!day || !month) return '';
  const stamp = month * 100 + day;
  if (stamp >= 101 && stamp <= 104) return 'Happy New Year from Gymkhana. Book a morning slot while the year is still quiet.';
  if (stamp >= 124 && stamp <= 128) return 'Republic Day week. The grounds stay open. Come play.';
  if (stamp >= 308 && stamp <= 318) return 'Holi week. Drink water, then take the court.';
  if (stamp >= 810 && stamp <= 817) return 'Independence Day week at Sector 21.';
  if (stamp >= 1018 && stamp <= 1102) return 'Diwali glow on the silk. Play, then go home to the lamps.';
  if (stamp >= 1115 && stamp <= 1126) return 'Guru Nanak Jayanti. A calm court is still a court.';
  if (stamp >= 1220 && stamp <= 1228) return 'Christmas week at Gymkhana. Early slots go first.';
  return '';
}

export const CLOUD_LINES = [
  'Water first. Then the smash.',
  'A rest day is still a training day.',
  'Knees over toes on the lunge. Your future self said thanks.',
  'The birdie is not a snack.',
  'Swim like the lane lines owe you money.',
  'Tape, water, shoes — then talk.',
  'Missed a shot. Take the next one.',
  'Rackets sleep better in the bag.',
  'Breathe out on the serve.',
  'Slow strength still counts.',
  'If it hurts sharp, stop. If it aches, ease.',
  'The gym is a room. You are the work.',
];

export function cloudLine(seed = Date.now()) {
  return CLOUD_LINES[Math.abs(seed) % CLOUD_LINES.length];
}
