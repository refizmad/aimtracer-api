import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobSource, JobStatus, MatchStatus } from '../prisma/client';
import { JobsService } from './jobs.service';

function makeService(prisma: any) {
  return new JobsService(prisma, { get: () => 300 } as any, {} as any);
}

const SHARE = 'CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE';

describe('JobsService.reclipByShareCode', () => {
  it('requeues COMPLETED with union of all match players trusted', async () => {
    const job = {
      id: 'j1',
      status: JobStatus.COMPLETED,
      shareCode: SHARE,
      payload: {
        shareCode: SHARE,
        trustedSteamIds: ['765111'],
        options: { minKills: 4 },
      },
      createdAt: new Date('2026-07-01'),
    };
    const matches = [
      {
        id: 'm1',
        shareCode: SHARE,
        playerId: 'p1',
        player: { id: 'p1', steamId64: '765111', displayName: 'refi' },
        job,
      },
      {
        id: 'm2',
        shareCode: SHARE,
        playerId: 'p2',
        player: { id: 'p2', steamId64: '765222', displayName: 'bucky' },
        job,
      },
    ];
    const updated = {
      ...job,
      status: JobStatus.PENDING,
      payload: {
        shareCode: SHARE,
        trustedSteamIds: ['765111', '765222'],
        options: { minKills: 4 },
      },
    };
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue(matches),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([job]),
        update: jest.fn().mockResolvedValue(updated),
        create: jest.fn(),
      },
    };
    const svc = makeService(prisma);
    const out = await svc.reclipByShareCode(SHARE);

    expect(out.status).toBe(JobStatus.PENDING);
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'j1' },
        data: expect.objectContaining({
          status: JobStatus.PENDING,
          payload: expect.objectContaining({
            trustedSteamIds: expect.arrayContaining(['765111', '765222']),
            options: { minKills: 4 },
          }),
        }),
      }),
    );
    expect(prisma.match.updateMany).toHaveBeenCalledWith({
      where: { shareCode: SHARE },
      data: { jobId: 'j1', status: MatchStatus.DETECTED },
    });
  });

  it('refuses LEASED/PROCESSING', async () => {
    const job = {
      id: 'j1',
      status: JobStatus.PROCESSING,
      shareCode: SHARE,
      payload: { shareCode: SHARE, trustedSteamIds: ['765111'] },
      createdAt: new Date(),
    };
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            shareCode: SHARE,
            playerId: 'p1',
            player: { id: 'p1', steamId64: '765111', displayName: 'refi' },
            job,
          },
        ]),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([job]),
      },
    };
    const svc = makeService(prisma);
    await expect(svc.reclipByShareCode(SHARE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when nothing known for share code', async () => {
    const prisma = {
      match: { findMany: jest.fn().mockResolvedValue([]) },
      job: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = makeService(prisma);
    await expect(svc.reclipByShareCode(SHARE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates a job when only match rows exist', async () => {
    const created = {
      id: 'j-new',
      status: JobStatus.PENDING,
      shareCode: SHARE,
      source: JobSource.manual,
    };
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            shareCode: SHARE,
            playerId: 'p1',
            player: { id: 'p1', steamId64: '765111', displayName: 'refi' },
            job: null,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(created),
        update: jest.fn(),
      },
    };
    const svc = makeService(prisma);
    const out = await svc.reclipByShareCode(SHARE);
    expect(out.id).toBe('j-new');
    expect(prisma.job.create).toHaveBeenCalled();
  });
});
