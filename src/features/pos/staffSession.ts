const KEY = 'ad_pos_staff_session';
const DESK_KEY = 'gk_pos_desk';

export type DeskMode = 'owner' | 'employee' | 'trainer';

export const DESK_HOMES: Record<DeskMode, string> = {
  owner: '/pos',
  employee: '/pos',
  trainer: '/pos',
};

export const EMPLOYEE_LINKS = [
  { to: '/pos', label: 'Dashboard', end: true },
  { to: '/pos/backend/bookings', label: 'Bookings' },
  { to: '/pos/backend/check-in', label: 'Check-in' },
  { to: '/pos/backend/people', label: 'Active users' },
  { to: '/pos/backend/communications', label: 'Communications' },
  { to: '/pos/backend/shift', label: 'Shift' },
  { to: '/pos/backend/facilities', label: 'Activities' },
  { to: '/pos/backend/maintenance', label: 'Maintenance' },
  { to: '/pos/backend/inventory', label: 'Inventory' },
] as const;

export const ACTIVE_USER_TABS = [
  { id: 'all', label: 'All', to: '/pos/backend/people' },
  { id: 'in', label: 'In now', to: '/pos/backend/people?tab=in' },
  { id: 'members', label: 'Members', to: '/pos/backend/people?tab=members' },
  { id: 'expiring', label: 'Expiring', to: '/pos/backend/people?tab=expiring' },
  { id: 'requests', label: 'Requests', to: '/pos/backend/people?tab=requests' },
  { id: 'plans', label: 'Plans', to: '/pos/backend/people?tab=plans' },
] as const;

export function peopleTabId(pathname: string, tab: string | null) {
  if (pathname.includes('/membership-requests')) return 'requests';
  if (pathname.includes('/plans') && !pathname.includes('/people')) return 'plans';
  return tab || 'all';
}

export const COMMUNICATIONS_TABS = [
  { id: 'overview', label: 'Overview', to: '/pos/backend/communications' },
  { id: 'compose', label: 'Compose', to: '/pos/backend/communications/compose' },
  { id: 'audience', label: 'Active members', to: '/pos/backend/communications/audience' },
  { id: 'automations', label: 'Automations', to: '/pos/backend/communications/automations' },
  { id: 'templates', label: 'Templates', to: '/pos/backend/communications/templates' },
  { id: 'history', label: 'History', to: '/pos/backend/communications/history' },
  { id: 'reports', label: 'Reports', to: '/pos/backend/communications/reports' },
  { id: 'settings', label: 'Settings', to: '/pos/backend/communications/settings' },
] as const;

export function communicationsTabId(pathname: string) {
  if (pathname.includes('/communications/compose')) return 'compose';
  if (pathname.includes('/communications/audience')) return 'audience';
  if (pathname.includes('/communications/automations')) return 'automations';
  if (pathname.includes('/communications/templates')) return 'templates';
  if (pathname.includes('/communications/history')) return 'history';
  if (pathname.includes('/communications/reports')) return 'reports';
  if (pathname.includes('/communications/settings')) return 'settings';
  return 'overview';
}

export const TRAINER_LINKS = [
  { to: '/pos/backend/shift', label: 'My shift' },
  { to: '/pos/backend/sessions', label: 'Sessions' },
  { to: '/pos/backend/classes', label: 'Classes' },
  { to: '/pos/backend/trainer-requests', label: 'Trainer requests' },
  { to: '/pos/backend/facilities', label: 'Activities' },
] as const;

export function markStaffSession() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

export function setDeskMode(mode: DeskMode) {
  try {
    sessionStorage.setItem(DESK_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function getDeskMode(): DeskMode {
  try {
    const value = sessionStorage.getItem(DESK_KEY);
    if (value === 'employee' || value === 'trainer' || value === 'owner') return value;
  } catch {
    /* ignore */
  }
  return 'owner';
}

export function hasDeskMode() {
  try {
    const value = sessionStorage.getItem(DESK_KEY);
    return value === 'employee' || value === 'trainer' || value === 'owner';
  } catch {
    return false;
  }
}

export function clearStaffSession() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(DESK_KEY);
  } catch {
    /* ignore */
  }
}

export function hasStaffSession() {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function isPeopleListPath(pathname: string) {
  return /\/backend\/people\/?$/.test(pathname);
}

export function deskLinkActive(to: string, pathname: string, end = false) {
  if (end || to === '/pos') return pathname === '/pos' || pathname.endsWith('/pos');
  if (to === '/pos/backend/people') {
    return pathname.startsWith('/pos/backend/people')
      || pathname.startsWith('/pos/backend/visitors')
      || pathname.startsWith('/pos/backend/memberships')
      || pathname.startsWith('/pos/backend/membership-requests')
      || pathname.startsWith('/pos/backend/plans');
  }
  if (to === '/pos/backend/memberships') {
    return pathname.startsWith('/pos/backend/memberships') || pathname.startsWith('/pos/backend/plans');
  }
  if (to === '/pos/backend/classes') {
    return pathname.startsWith('/pos/backend/classes')
      || pathname.startsWith('/pos/backend/trainers')
      || pathname.startsWith('/pos/backend/participants');
  }
  if (to === '/pos/backend/communications') {
    return pathname.startsWith('/pos/backend/communications');
  }
  return pathname.startsWith(to);
}
