import { Injectable } from '@nestjs/common';
import { MatchStatus, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type MatchListQuery = {
  playerId: string;
  status?: MatchStatus;
  page?: number;
  pageSize?: number;
};

export type PublicMatch = {
  id: string;
  shareCode: string;
  status: MatchStatus;
  map: string | null;
  demoName: string | null;
  matchDate: string;
  discoveredAt: string;
  clipCount: number;
  job: {
    id: string;
    status: string;
    progress: number;
    stage: string | null;
    source: string;
    error: string | null;
  } | null;
};

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(q: MatchListQuery): Promise<{
    matches: PublicMatch[];
    total: number;
    page: number;
    pageSize: number;
    summary: Record<MatchStatus, number>;
  }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 30));

    const where: Prisma.MatchWhereInput = { playerId: q.playerId };
    if (q.status) where.status = q.status;

    // Separate queries (avoid Prisma groupBy + $transaction typing bugs).
    const [total, rows, grouped] = await Promise.all([
      this.prisma.match.count({ where }),
      this.prisma.match.findMany({
        where,
        orderBy: { matchDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          job: {
            select: {
              id: true,
              status: true,
              progress: true,
              stage: true,
              source: true,
              error: true,
            },
          },
          _count: { select: { clips: true } },
        },
      }),
      this.prisma.match.groupBy({
        by: ['status'],
        where: { playerId: q.playerId },
        _count: true,
      }),
    ]);

    const summary: Record<MatchStatus, number> = {
      DETECTED: 0,
      DOWNLOADED: 0,
      RENDERED: 0,
      FAILED: 0,
    };
    for (const g of grouped) {
      summary[g.status] = g._count;
    }

    return {
      matches: rows.map((m) => ({
        id: m.id,
        shareCode: m.shareCode,
        status: m.status,
        map: m.map,
        demoName: m.demoName,
        matchDate: m.matchDate.toISOString(),
        discoveredAt: m.discoveredAt.toISOString(),
        clipCount: m._count.clips,
        job: m.job
          ? {
              id: m.job.id,
              status: m.job.status,
              progress: m.job.progress,
              stage: m.job.stage,
              source: m.job.source,
              error: m.job.error,
            }
          : null,
      })),
      total,
      page,
      pageSize,
      summary,
    };
  }
}
