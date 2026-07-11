import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuthGuard } from '../common/admin-auth.guard';
import { randomToken } from '../common/crypto.util';

@ApiTags('admin')
@ApiSecurity('admin-token')
@UseGuards(AdminAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('invites')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a friends-only invite code' })
  async createInvite(
    @Body()
    body: {
      note?: string;
      maxUses?: number;
      expiresInDays?: number;
      /** Optional fixed code (default: random) */
      code?: string;
    },
  ) {
    const code =
      body.code?.trim() ||
      randomToken('inv_', 9).replace(/^inv_/, '').toUpperCase().slice(0, 12);

    const expiresAt =
      body.expiresInDays && body.expiresInDays > 0
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const invite = await this.prisma.invite.create({
      data: {
        code,
        note: body.note || null,
        maxUses: body.maxUses && body.maxUses > 0 ? body.maxUses : 1,
        expiresAt,
      },
    });

    return {
      invite: {
        id: invite.id,
        code: invite.code,
        note: invite.note,
        maxUses: invite.maxUses,
        useCount: invite.useCount,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      },
    };
  }

  @Get('invites')
  @ApiOperation({ summary: 'List invite codes' })
  async listInvites() {
    const invites = await this.prisma.invite.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        usedBy: { select: { steamId64: true, displayName: true } },
      },
    });
    return { invites };
  }
}
