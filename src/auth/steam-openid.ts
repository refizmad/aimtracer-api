/**
 * Steam Community OpenID 2.0 helpers.
 * Spec: https://steamcommunity.com/dev
 */

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const STEAM_CLAIMED_ID_RE =
  /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export interface SteamOpenIdBeginParams {
  returnTo: string;
  realm: string;
}

export function buildSteamOpenIdUrl(params: SteamOpenIdBeginParams): string {
  const q = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': params.returnTo,
    'openid.realm': params.realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_OPENID_URL}?${q.toString()}`;
}

export function extractSteamId64(claimedId: string | undefined | null): string | null {
  if (!claimedId) return null;
  const m = claimedId.trim().match(STEAM_CLAIMED_ID_RE);
  return m ? m[1] : null;
}

/** Fields Steam must have signed, or a valid signature proves nothing about them. */
const REQUIRED_SIGNED_FIELDS = [
  'op_endpoint',
  'claimed_id',
  'identity',
  'return_to',
  'response_nonce',
  'assoc_handle',
];

/**
 * Verify OpenID assertion with Steam via check_authentication.
 * `query` is the raw callback query object (openid.* keys).
 * `expectedReturnTo` is the exact return_to we sent Steam for this login.
 *
 * check_authentication only proves Steam issued the assertion — not that it
 * was issued for us. Without the return_to check, any site offering "Sign in
 * through Steam" could replay a visitor's assertion here and log in as them.
 */
export async function verifySteamOpenId(
  query: Record<string, string | string[] | undefined>,
  expectedReturnTo: string,
): Promise<{ ok: true; steamId64: string } | { ok: false; reason: string }> {
  const mode = first(query['openid.mode']);
  if (mode !== 'id_res') {
    return { ok: false, reason: `Unexpected openid.mode: ${mode}` };
  }

  if (first(query['openid.op_endpoint']) !== STEAM_OPENID_URL) {
    return { ok: false, reason: 'Unexpected openid.op_endpoint' };
  }

  if (!sameReturnTo(first(query['openid.return_to']), expectedReturnTo)) {
    return { ok: false, reason: 'openid.return_to does not match this login' };
  }

  const signed = new Set((first(query['openid.signed']) || '').split(','));
  const unsigned = REQUIRED_SIGNED_FIELDS.filter((f) => !signed.has(f));
  if (unsigned.length > 0) {
    return { ok: false, reason: `Unsigned fields: ${unsigned.join(', ')}` };
  }

  const claimedId = first(query['openid.claimed_id']);
  const steamId64 = extractSteamId64(claimedId);
  if (!steamId64) {
    return { ok: false, reason: 'Invalid claimed_id' };
  }
  if (first(query['openid.identity']) !== claimedId) {
    return { ok: false, reason: 'identity does not match claimed_id' };
  }

  // Rebuild signed fields for check_authentication
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith('openid.') || value === undefined) continue;
    const v = first(value);
    if (v === undefined) continue;
    body.set(key, v);
  }
  body.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    return { ok: false, reason: `Steam check_authentication HTTP ${res.status}` };
  }

  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const map = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }

  if (map.get('is_valid') !== 'true') {
    return { ok: false, reason: 'Steam is_valid != true' };
  }

  return { ok: true, steamId64 };
}

/**
 * Same URL as the one we sent, compared parsed so harmless re-encoding by
 * Steam or the BFF does not matter. Every query param (the auth state among
 * them) must match too.
 */
export function sameReturnTo(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    if (a.origin !== e.origin || a.pathname !== e.pathname) return false;
    const aParams = [...a.searchParams].sort().join('&');
    const eParams = [...e.searchParams].sort().join('&');
    return aParams === eParams;
  } catch {
    return false;
  }
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
