const KEY = 'gk_member_pass';

export function saveMemberPass(token?: string | null) {
  if (!token) return;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* private mode */
  }
}

export function readMemberPass() {
  try {
    return window.localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function clearMemberPass() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
