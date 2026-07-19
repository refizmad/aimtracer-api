import { AdminService } from './admin.service';

describe('AdminService', () => {
  it('workerSetup returns machine token and Windows snippets (no invite)', async () => {
    const prisma = {
      worker: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'w1',
          name: 'render-pc',
          machineToken: 'mt_test',
        }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'w1',
          ...data,
        })),
        upsert: jest.fn(),
      },
      invite: {
        create: jest.fn(),
      },
    };
    const svc = new AdminService(prisma as any, {} as any, {} as any);
    const out = await svc.workerSetup({
      publicApiUrl: 'https://api.example.com/',
    });
    expect(out.worker.machineToken).toBeTruthy();
    expect(out.snippets.workerCmd).toContain(
      'AIMTRACE_API=https://api.example.com',
    );
    expect(out.snippets.workerCmd).toContain('MACHINE_TOKEN=');
    expect(out.snippets.workerPs).toContain('$env:AIMTRACE_API=');
    expect((out as any).invite).toBeUndefined();
    expect(prisma.invite.create).not.toHaveBeenCalled();
  });

  it('overview aggregates totals from prisma counts', async () => {
    const prisma = {
      clip: {
        count: jest.fn().mockResolvedValue(36),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 1_500_000 } }),
      },
      match: {
        count: jest.fn().mockResolvedValue(10),
        groupBy: jest.fn().mockResolvedValue([{ status: 'RENDERED', _count: 8 }]),
      },
      job: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'PENDING', _count: 2 },
          { status: 'FAILED', _count: 1 },
        ]),
        count: jest.fn().mockResolvedValue(3),
      },
      player: { count: jest.fn().mockResolvedValue(4) },
      matchHistoryEnrollment: {
        groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: 2 }]),
      },
      invite: { count: jest.fn().mockResolvedValue(1) },
      worker: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'w1',
            name: 'render-pc',
            enabled: true,
            lastSeenAt: new Date('2026-07-11T12:00:00Z'),
          },
        ]),
      },
    };

    const svc = new AdminService(prisma as any, {} as any, {} as any);
    const out = await svc.overview();

    expect(out.totals.clipsRendered).toBe(36);
    expect(out.totals.demosDownloaded).toBe(10);
    expect(out.totals.players).toBe(4);
    expect(out.totals.queueDepth).toBe(3);
    expect(out.totals.storageBytes).toBe(1_500_000);
    expect(out.jobsByStatus.PENDING).toBe(2);
    expect(out.jobsByStatus.FAILED).toBe(1);
    expect(out.matchesByStatus.RENDERED).toBe(8);
    expect(out.enrollmentsByStatus.ACTIVE).toBe(2);
    expect(out.workers[0].name).toBe('render-pc');
  });
});
