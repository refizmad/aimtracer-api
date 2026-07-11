import { clipRowFromResultEntry, WorkerClipEntry } from './clip-ingest.util';

const fullSidecar: WorkerClipEntry = {
  file: 'refi_4k_mirage_001.mp4',
  url: 'https://s3.example/clips/refi_4k_mirage_001.mp4?X-Amz-Signature=abc',
  sizeBytes: 4_200_000,
  type: '4k',
  map: 'de_mirage',
  round: 7,
  kills: 4,
  headshots: 2,
  score: 210,
  duration_s: 12.5,
  specials: { wallbang: 1 },
  clutch: null,
  kill_events: [{ tick: 100, victim: 'a', weapon: 'ak47', headshot: true }],
  player: 'refi',
  player_steamid: '76561198000000001',
  demo: 'match_123.dem',
  reason: '4 kills in round 7',
};

describe('clipRowFromResultEntry', () => {
  it('maps a full post-M2 worker entry (sidecar + annotations)', () => {
    const row = clipRowFromResultEntry(fullSidecar);
    expect(row).toEqual({
      file: 'refi_4k_mirage_001.mp4',
      url: fullSidecar.url,
      sizeBytes: 4_200_000,
      clipType: '4k',
      map: 'de_mirage',
      round: 7,
      kills: 4,
      headshots: 2,
      score: 210,
      durationS: 12.5,
      specials: { wallbang: 1 },
      clutch: undefined, // null clutch left unset
      killEvents: fullSidecar.kill_events,
      playerName: 'refi',
      playerSteamId: '76561198000000001',
      demoName: 'match_123.dem',
      reason: '4 kills in round 7',
    });
  });

  it('accepts pre-M2 {file,url}-only results (backward compatible)', () => {
    const row = clipRowFromResultEntry({
      file: 'old_clip.mp4',
      url: 'https://s3.example/old_clip.mp4',
    });
    expect(row).toMatchObject({
      file: 'old_clip.mp4',
      url: 'https://s3.example/old_clip.mp4',
    });
    expect(row!.map).toBeUndefined();
    expect(row!.kills).toBeUndefined();
    expect(row!.clipType).toBeUndefined();
  });

  it('returns null when file is missing or blank', () => {
    expect(clipRowFromResultEntry({})).toBeNull();
    expect(clipRowFromResultEntry({ file: '  ' })).toBeNull();
    expect(clipRowFromResultEntry(null)).toBeNull();
    expect(clipRowFromResultEntry(undefined)).toBeNull();
  });

  it('truncates non-integer numerics for int columns', () => {
    const row = clipRowFromResultEntry({
      file: 'x.mp4',
      kills: 3.9,
      round: 1.1,
      sizeBytes: 99.7,
    });
    expect(row!.kills).toBe(3);
    expect(row!.round).toBe(1);
    expect(row!.sizeBytes).toBe(99);
  });

  it('ignores non-object JSON fields and non-finite numbers', () => {
    const row = clipRowFromResultEntry({
      file: 'x.mp4',
      specials: 'nope' as unknown as object,
      clutch: 1 as unknown as object,
      kill_events: null,
      kills: Number.NaN,
      duration_s: Infinity,
    });
    expect(row!.specials).toBeUndefined();
    expect(row!.clutch).toBeUndefined();
    expect(row!.killEvents).toBeUndefined();
    expect(row!.kills).toBeUndefined();
    expect(row!.durationS).toBeUndefined();
  });
});
