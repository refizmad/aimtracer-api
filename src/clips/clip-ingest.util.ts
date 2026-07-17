import { Prisma } from '../prisma/client';

/**
 * One entry of a worker's `result.clips[]` — the clipper's metadata sidecar
 * (snake_case, see cs2-clip write_clip_metadata) plus the worker's own
 * `file`/`url`/`sizeBytes` annotations. Everything except `file` is optional:
 * pre-M2 workers reported only `{file, url}`, and a missing/corrupt sidecar
 * degrades to that same shape.
 */
export interface WorkerClipEntry {
  file?: unknown;
  url?: unknown;
  sizeBytes?: unknown;
  type?: unknown;
  map?: unknown;
  round?: unknown;
  kills?: unknown;
  headshots?: unknown;
  score?: unknown;
  duration_s?: unknown;
  specials?: unknown;
  clutch?: unknown;
  kill_events?: unknown;
  player?: unknown;
  player_steamid?: unknown;
  demo?: unknown;
  reason?: unknown;
}

/** Scalar Clip columns derivable from a single result entry (ownership
 * fields — playerId/matchId/jobId — are the caller's job). */
export interface ClipRowData {
  file: string;
  url?: string;
  sizeBytes?: number;
  clipType?: string;
  map?: string;
  round?: number;
  kills?: number;
  headshots?: number;
  score?: number;
  durationS?: number;
  specials?: Prisma.InputJsonValue;
  clutch?: Prisma.InputJsonValue;
  killEvents?: Prisma.InputJsonValue;
  playerName?: string;
  playerSteamId?: string;
  demoName?: string;
  reason?: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const int = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.trunc(n);
};

/** JSON columns: only pass through actual objects/arrays; a sidecar `null`
 * (e.g. "clutch": null) or a scalar of the wrong shape is left unset. */
const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v !== null && typeof v === 'object' ? (v as Prisma.InputJsonValue) : undefined;

/**
 * Ownership columns for one clip of a (possibly multi-player) job.
 *
 * A merged job renders clips for several players in the same match, so blanket
 * `job.playerId` attribution would hand every clip to whichever player queued
 * first. Each sidecar entry names its player by steamid (names are spoofable;
 * the clipper's --trusted gate guarantees the steamid is one we asked for), so
 * resolve per entry: steamid → player → that player's Match row. Falls back to
 * the job's own player/first match for legacy results without a steamid.
 */
export function resolveClipOwnership(
  clipPlayerSteamId: string | undefined,
  job: { id: string; playerId: string | null },
  matches: Array<{ id: string; playerId: string }>,
  playerIdBySteamId: Map<string, string>,
): { playerId: string | null; matchId: string | null; jobId: string } {
  const ownerId =
    (clipPlayerSteamId && playerIdBySteamId.get(clipPlayerSteamId)) ||
    job.playerId ||
    null;
  const ownMatch =
    (ownerId && matches.find((m) => m.playerId === ownerId)) || matches[0] || null;
  return { playerId: ownerId, matchId: ownMatch?.id ?? null, jobId: job.id };
}

/**
 * Map one worker result entry to Clip column data. Returns null for entries
 * that can't identify a clip (no usable `file`) — the caller skips those.
 * Defensive by design: the result JSON crossed a machine boundary.
 */
export function clipRowFromResultEntry(
  entry: WorkerClipEntry | null | undefined,
): ClipRowData | null {
  const file = str(entry?.file);
  if (!file) return null;
  return {
    file,
    url: str(entry!.url),
    sizeBytes: int(entry!.sizeBytes),
    clipType: str(entry!.type),
    map: str(entry!.map),
    round: int(entry!.round),
    kills: int(entry!.kills),
    headshots: int(entry!.headshots),
    score: int(entry!.score),
    durationS: num(entry!.duration_s),
    specials: json(entry!.specials),
    clutch: json(entry!.clutch),
    killEvents: json(entry!.kill_events),
    playerName: str(entry!.player),
    playerSteamId: str(entry!.player_steamid),
    demoName: str(entry!.demo),
    reason: str(entry!.reason),
  };
}
