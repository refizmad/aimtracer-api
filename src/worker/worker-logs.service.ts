import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerLogLineDto } from './dto/ship-logs.dto';

/** Live-tail retention per worker; older rows are pruned on ingest. */
const MAX_LINES_PER_WORKER = 4000;

@Injectable()
export class WorkerLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Store a batch of worker console lines and prune that worker's tail down
   * to MAX_LINES_PER_WORKER. Ingest is best-effort by design: the worker
   * drops batches on failure rather than retrying them.
   */
  async ingest(workerId: string, lines: WorkerLogLineDto[]) {
    if (lines.length === 0) return { stored: 0 };

    await this.prisma.workerLog.createMany({
      data: lines.map((l) => ({
        workerId,
        jobId: l.jobId || null,
        line: l.line.slice(0, 2000),
        at: l.at ? new Date(l.at) : new Date(),
      })),
    });

    // Prune: everything at or below the id that sits MAX_LINES back.
    const cutoff = await this.prisma.workerLog.findMany({
      where: { workerId },
      orderBy: { id: 'desc' },
      skip: MAX_LINES_PER_WORKER,
      take: 1,
      select: { id: true },
    });
    if (cutoff.length > 0) {
      await this.prisma.workerLog.deleteMany({
        where: { workerId, id: { lte: cutoff[0].id } },
      });
    }

    return { stored: lines.length };
  }

  /**
   * Newest `limit` lines for a worker, returned oldest-first for terminal-style
   * rendering. `afterId` fetches only lines newer than a previous poll's last
   * id, so the dashboard can tail incrementally.
   */
  async tail(workerId: string, opts?: { limit?: number; afterId?: string }) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      select: { id: true, name: true },
    });
    if (!worker) throw new NotFoundException('Worker not found');

    const limit = Math.min(1000, Math.max(1, opts?.limit ?? 200));
    const afterId =
      opts?.afterId && /^\d+$/.test(opts.afterId) ? BigInt(opts.afterId) : null;

    const rows = await this.prisma.workerLog.findMany({
      where: {
        workerId,
        ...(afterId != null ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit,
    });
    rows.reverse();

    return {
      worker,
      lines: rows.map((r) => ({
        id: r.id.toString(),
        jobId: r.jobId,
        line: r.line,
        at: r.at.toISOString(),
      })),
    };
  }
}
