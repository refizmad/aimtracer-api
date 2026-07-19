import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One freshly ingested clip, ready to announce. */
export type AnnouncedClip = {
  publicCode: string;
};

/** Pause between multi-clip drops so the channel doesn't get a spam wall. */
const ANNOUNCE_GAP_MS = 400;

/**
 * Posts freshly rendered clips to a Discord channel via an incoming webhook
 * (DISCORD_WEBHOOK_URL). Each clip is its own message: the share URL is
 * spoiler-wrapped (||url||) so the raw link is hidden, but Discord still
 * unfurls OpenGraph (poster + og:video). One link per message keeps embeds
 * clean; a short gap between posts keeps multi-clip drops readable.
 *
 * Strictly best-effort: unset webhook = silent no-op, and a Discord failure
 * only logs a warning — it can never fail the job report that triggered it.
 */
@Injectable()
export class DiscordNotifyService {
  private readonly logger = new Logger(DiscordNotifyService.name);
  private readonly webhookUrl: string | null;
  private readonly siteUrl: string;

  constructor(config: ConfigService) {
    this.webhookUrl = config.get<string>('DISCORD_WEBHOOK_URL')?.trim() || null;
    this.siteUrl = (
      config.get<string>('PUBLIC_SITE_URL')?.trim() || 'https://aimtracer.com'
    ).replace(/\/+$/, '');
    if (this.webhookUrl) {
      this.logger.log('Discord clip announcements enabled');
    }
  }

  /** Fire-and-forget announce; callers should not await job-critical work on it. */
  async announceNewClips(clips: AnnouncedClip[]): Promise<void> {
    if (!this.webhookUrl || clips.length === 0) return;

    let announced = 0;
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]!;
      // One message per clip. Spoiler hides the raw URL; Discord still unfurls.
      // Embed title (player | type [style] | map) already says everything.
      const url = `${this.siteUrl}/clip/${encodeURIComponent(clip.publicCode)}`;
      const content = `||${url}||`;
      try {
        const res = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            allowed_mentions: { parse: [] },
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          this.logger.warn(
            `Discord webhook rejected clip announcement: HTTP ${res.status} ${body.slice(0, 200)}`,
          );
          return; // further posts would fail the same way
        }
        announced++;
        if (i < clips.length - 1) {
          await sleep(ANNOUNCE_GAP_MS);
        }
      } catch (e) {
        this.logger.warn(
          `Discord webhook unreachable: ${(e as Error).message}`,
        );
        return;
      }
    }
    this.logger.log(`Announced ${announced} new clip(s) to Discord`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
