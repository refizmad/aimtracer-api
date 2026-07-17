import { MatchStatus } from '../prisma/client';
import { AdminService } from './admin.service';

describe('AdminService.listMatches merge by shareCode', () => {
  it('collapses two player rows for the same demo into one', async () => {
    const share = 'CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE';
    const job = {
      id: 'j1',
      status: 'COMPLETED',
      stage: 'done',
      progress: 100,
      error: null,
      attempts: 1,
      maxAttempts: 3,
      source: 'auto_match_history',
      createdAt: new Date('2026-07-10T12:00:00Z'),
    };
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            shareCode: share,
            status: MatchStatus.RENDERED,
            map: 'de_cache',
            demoName: 'match_1.dem',
            matchDate: new Date('2026-07-10T11:00:00Z'),
            discoveredAt: new Date('2026-07-10T11:05:00Z'),
            player: {
              id: 'p1',
              steamId64: '765111',
              displayName: 'refi',
            },
            job,
            _count: { clips: 1 },
          },
          {
            id: 'm2',
            shareCode: share,
            status: MatchStatus.RENDERED,
            map: 'de_cache',
            demoName: 'match_1.dem',
            matchDate: new Date('2026-07-10T11:00:00Z'),
            discoveredAt: new Date('2026-07-10T11:06:00Z'),
            player: {
              id: 'p2',
              steamId64: '765222',
              displayName: 'bucky',
            },
            job,
            _count: { clips: 1 },
          },
          {
            id: 'm3',
            shareCode: 'CSGO-ZZZZZ-YYYYY-XXXXX-WWWWW-VVVVV',
            status: MatchStatus.DETECTED,
            map: 'de_mirage',
            demoName: null,
            matchDate: new Date('2026-07-11T10:00:00Z'),
            discoveredAt: new Date('2026-07-11T10:00:00Z'),
            player: {
              id: 'p1',
              steamId64: '765111',
              displayName: 'refi',
            },
            job: null,
            _count: { clips: 0 },
          },
        ]),
      },
    };

    const svc = new AdminService(prisma as any, {} as any);
    const out = await svc.listMatches({ limit: 50 });

    expect(out.matches).toHaveLength(2);
    const cache = out.matches.find((m) => m.shareCode === share)!;
    expect(cache.matchIds).toEqual(['m1', 'm2']);
    expect(cache.clipCount).toBe(2);
    expect(cache.players).toHaveLength(2);
    expect(cache.players.map((p) => p.displayName).sort()).toEqual([
      'bucky',
      'refi',
    ]);
    expect(cache.job?.id).toBe('j1');
  });
});
