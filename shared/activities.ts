export const SIGNUP_ACTIVITIES = ['Badminton', 'Basketball', 'Football', 'Gym', 'Skating', 'Swimming', 'Tennis', 'Table tennis'] as const;

export const ARENA_SPORTS = SIGNUP_ACTIVITIES;

export const ARENA_SLOTS = 30;

export type ArenaSport = (typeof ARENA_SPORTS)[number];

export function matchActivity(value: string) {
  const needle = value.trim().toLowerCase();
  return SIGNUP_ACTIVITIES.find((name) => name.toLowerCase() === needle) ?? '';
}

export function arenaSlug(sport: string) {
  return sport.trim().toLowerCase().replace(/\s+/g, '-');
}

export function sportFromSlug(slug: string): ArenaSport | '' {
  const needle = slug.trim().toLowerCase().replace(/-/g, ' ');
  return ARENA_SPORTS.find((name) => name.toLowerCase() === needle) ?? '';
}

export function gateNext(value: string | null | undefined) {
  const raw = (value ?? '').trim();
  if (raw === '/in') return '/in';
  if (!raw.startsWith('/in/')) return '';
  if (/[?#\\]/.test(raw) || raw.includes('//', 1)) return '';
  const sport = sportFromSlug(raw.slice('/in/'.length));
  return sport ? `/in/${arenaSlug(sport)}` : '';
}

export function matchArena(value: string): ArenaSport | '' {
  return listedArenas(value)[0] ?? '';
}

export function listedArenas(value: string): ArenaSport[] {
  const needle = value.trim().toLowerCase();
  if (!needle) return [];
  return ARENA_SPORTS.filter((sport) => {
    const name = sport.toLowerCase();
    if (name === 'table tennis') return needle.includes('table tennis') || needle.includes('table-tennis') || needle.includes('ping pong');
    if (name === 'tennis') return needle.includes('tennis') && !needle.includes('table tennis') && !needle.includes('table-tennis');
    if (name === 'gym') return needle.includes('gym') || needle.includes('fitness') || needle.includes('strength');
    if (name === 'football') return needle.includes('football') || needle.includes('soccer');
    if (name === 'basketball') return needle.includes('basket');
    if (name === 'swimming') return needle.includes('swim') || needle.includes('pool');
    if (name === 'skating') return needle.includes('skat') || needle.includes('rink');
    return needle.includes(name);
  });
}
