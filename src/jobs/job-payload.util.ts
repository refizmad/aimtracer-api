/**
 * Clip-job payload helpers.
 *
 * The payload is the worker contract (see cs2-clip worker.py): shareCode,
 * trustedSteamIds and render options. A share code identifies a MATCH, not a
 * player, so several enrolled players can be served by one render — merging a
 * player into an existing pending job means adding their steamid to
 * trustedSteamIds.
 */

export interface ClipJobPayload {
  shareCode?: unknown;
  trustedSteamIds?: unknown;
  options?: unknown;
  [key: string]: unknown;
}

/** The payload's trustedSteamIds as a clean string list (tolerates a payload
 * that crossed a JSON boundary: missing field, non-array, non-strings). */
export function trustedSteamIdsOf(payload: ClipJobPayload | null | undefined): string[] {
  const raw = payload?.trustedSteamIds;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
    .filter((v) => v.length > 0);
}

/**
 * Payload with `steamId64` present in trustedSteamIds (deduped, original
 * order kept, other fields untouched). Returns null when the payload already
 * trusts the steamid — callers can skip the write.
 */
export function withTrustedSteamId(
  payload: ClipJobPayload | null | undefined,
  steamId64: string,
): ClipJobPayload | null {
  const current = trustedSteamIdsOf(payload);
  if (current.includes(steamId64)) return null;
  return {
    ...(payload ?? {}),
    trustedSteamIds: [...current, steamId64],
  };
}
