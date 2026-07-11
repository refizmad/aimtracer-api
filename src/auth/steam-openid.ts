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

/**
 * Verify OpenID assertion with Steam via check_authentication.
 * `query` is the raw callback query object (openid.* keys).
 */
export async function verifySteamOpenId(
  query: Record<string, string | string[] | undefined>,
): Promise<{ ok: true; steamId64: string } | { ok: false; reason: string }> {
  const mode = first(query['openid.mode']);
  if (mode !== 'id_res') {
    return { ok: false, reason: `Unexpected openid.mode: ${mode}` };
  }

  const claimedId = first(query['openid.claimed_id']);
  const steamId64 = extractSteamId64(claimedId);
  if (!steamId64) {
    return { ok: false, reason: 'Invalid claimed_id' };
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

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
