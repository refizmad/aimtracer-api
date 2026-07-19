import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One freshly ingested clip, ready to announce. */
export type AnnouncedClip = {
  publicCode: string;
  playerName: string | null;
  map: string | null;
  kills: number | null;
  clipType: string | null;
};

/** Discord unfurls at most 5 links per message; chunk announcements to that. */
const LINKS_PER_MESSAGE = 5;

/**
 * Posts freshly rendered clips to a Discord channel via an incoming webhook
 * (DISCORD_WEBHOOK_URL). The clip share links are sent as plain message
 * content so Discord unfurls each one with the page's OpenGraph tags —
 * poster image and (og:video) inline playable video.
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

    for (let i = 0; i < clips.length; i += LINKS_PER_MESSAGE) {
      const chunk = clips.slice(i, i + LINKS_PER_MESSAGE);
      const content = chunk.map((c) => this.formatClipLine(c)).join('\n');
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
          return; // a rejected chunk means later chunks would fail the same way
        }
      } catch (e) {
        this.logger.warn(
          `Discord webhook unreachable: ${(e as Error).message}`,
        );
        return;
      }
    }
    this.logger.log(`Announced ${clips.length} new clip(s) to Discord`);
  }

  private formatClipLine(c: AnnouncedClip): string {
    const who = c.playerName || 'Unknown player';
    const what = c.clipType ? c.clipType.toUpperCase() : 'Highlight';
    const where = c.map ? ` on ${formatMap(c.map)}` : '';
    const kills =
      c.kills != null && Number.isFinite(c.kills) ? ` (${c.kills} kills)` : '';
    return `🎬 **${who}** — ${what}${where}${kills}\n${this.siteUrl}/clip/${encodeURIComponent(c.publicCode)}`;
  }
}

/** de_mirage → Mirage (display only; raw names pass through unchanged). */
function formatMap(map: string): string {
  const bare = map.replace(/^(de|cs|ar)_/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}
