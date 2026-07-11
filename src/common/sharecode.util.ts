const SHARE_CODE_RE = /^CSGO(-[A-Za-z0-9]{5}){5}$/i;

/** Normalize CSGO-… share codes (and steam:// match links). Returns null if invalid. */
export function normalizeShareCode(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const fromSteamUrl = s.match(/CSGO(-[A-Za-z0-9]{5}){5}/i);
  const code = fromSteamUrl ? fromSteamUrl[0] : s;
  if (!SHARE_CODE_RE.test(code)) return null;
  return code.replace(/^csgo/i, 'CSGO');
}
