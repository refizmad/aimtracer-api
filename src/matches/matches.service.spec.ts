import { MatchStatus } from '../prisma/client';
import { MatchesService } from './matches.service';

describe('MatchesService.listMine shape (integration-light)', () => {
  it('maps rows to PublicMatch and fills summary zeros', async () => {
    const playerId = 'p1';
    const prisma = {
      match: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            shareCode: 'CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE',
            status: MatchStatus.RENDERED,
            map: 'de_mirage',
            demoName: 'match_1.dem',
            matchDate: new Date('2026-07-01T12:00:00Z'),
            discoveredAt: new Date('2026-07-01T12:05:00Z'),
            job: {
              id: 'j1',
              status: 'COMPLETED',
              progress: 100,
              stage: 'done',
              source: 'auto_match_history',
              error: null,
            },
            _count: { clips: 3 },
          },
        ]),
        groupBy: jest.fn().mockResolvedValue([
          { status: MatchStatus.RENDERED, _count: 1 },
          { status: MatchStatus.FAILED, _count: 2 },
        ]),
      },
    };

    const svc = new MatchesService(prisma as any);
    const result = await svc.listMine({ playerId, page: 1, pageSize: 10 });

    expect(prisma.match.count).toHaveBeenCalledWith({
      where: { playerId },
    });
    expect(result.total).toBe(1);
    expect(result.matches[0]).toMatchObject({
      id: 'm1',
      map: 'de_mirage',
      status: 'RENDERED',
      clipCount: 3,
      job: { id: 'j1', status: 'COMPLETED' },
    });
    expect(result.summary).toEqual({
      DETECTED: 0,
      DOWNLOADED: 0,
      RENDERED: 1,
      FAILED: 2,
    });
  });

  it('scopes by playerId only (never other players)', async () => {
    const prisma = {
      match: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = new MatchesService(prisma as any);
    await svc.listMine({ playerId: 'only-me', status: MatchStatus.DETECTED });
    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { playerId: 'only-me', status: MatchStatus.DETECTED },
      }),
    );
  });
});
