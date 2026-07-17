/**
 * Documents the gallery "Newest" key: match played time first, then ingest.
 * Mirrors clips.service listClips orderBy for sort=date.
 */
function compareClipDateOrder(
  a: { matchDate: string | null; createdAt: string; id: string },
  b: { matchDate: string | null; createdAt: string; id: string },
  order: 'asc' | 'desc' = 'desc',
): number {
  const dir = order === 'asc' ? 1 : -1;
  // null matchDate sinks (treat as -Infinity for desc / +Infinity for asc)
  const ta =
    a.matchDate != null
      ? Date.parse(a.matchDate)
      : order === 'desc'
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY;
  const tb =
    b.matchDate != null
      ? Date.parse(b.matchDate)
      : order === 'desc'
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY;
  if (ta !== tb) return (ta - tb) * dir;
  const ca = Date.parse(a.createdAt) || 0;
  const cb = Date.parse(b.createdAt) || 0;
  if (ca !== cb) return (ca - cb) * dir;
  return a.id < b.id ? -dir : a.id > b.id ? dir : 0;
}

describe('clip date order (Newest)', () => {
  it('puts later matchDate first when order=desc', () => {
    const clips = [
      {
        id: 'old',
        matchDate: '2026-07-01T12:00:00.000Z',
        createdAt: '2026-07-17T10:00:00.000Z',
      },
      {
        id: 'new',
        matchDate: '2026-07-16T20:00:00.000Z',
        createdAt: '2026-07-17T09:00:00.000Z', // rendered earlier than old
      },
      {
        id: 'mid',
        matchDate: '2026-07-10T12:00:00.000Z',
        createdAt: '2026-07-17T11:00:00.000Z',
      },
    ];
    const sorted = [...clips].sort((a, b) => compareClipDateOrder(a, b, 'desc'));
    expect(sorted.map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('does not put a later-rendered older match above a newer match', () => {
    const olderMatchLaterRender = {
      id: 'a',
      matchDate: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-07-17T23:00:00.000Z',
    };
    const newerMatch = {
      id: 'b',
      matchDate: '2026-07-15T00:00:00.000Z',
      createdAt: '2026-07-15T01:00:00.000Z',
    };
    expect(compareClipDateOrder(newerMatch, olderMatchLaterRender, 'desc')).toBeLessThan(
      0,
    );
  });

  it('sinks null matchDate below dated clips for newest', () => {
    const dated = {
      id: 'd',
      matchDate: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    };
    const undated = {
      id: 'u',
      matchDate: null,
      createdAt: '2026-07-17T00:00:00.000Z',
    };
    const sorted = [undated, dated].sort((a, b) =>
      compareClipDateOrder(a, b, 'desc'),
    );
    expect(sorted.map((c) => c.id)).toEqual(['d', 'u']);
  });
});
