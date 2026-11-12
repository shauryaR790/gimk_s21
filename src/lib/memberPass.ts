const KEY = 'gk_member_pass';
const CLIENT_COOKIE = 'gk_member_client';
const MAX_AGE = 400 * 24 * 60 * 60;

function writeClientCookie(token: string) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CLIENT_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    /* private mode */
  }
}

function clearClientCookie() {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CLIENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    /* private mode */
  }
}

export function saveMemberPass(token?: string | null) {
  if (!token) return;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    /* private mode */
  }
  writeClientCookie(token);
}

export function readMemberPass() {
  try {
    const stored = window.localStorage.getItem(KEY) || '';
    if (stored) return stored;
  } catch {
    /* private mode */
  }
  try {
    const match = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${CLIENT_COOKIE}=`));
    if (!match) return '';
    return decodeURIComponent(match.slice(CLIENT_COOKIE.length + 1)) || '';
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
  clearClientCookie();
}
