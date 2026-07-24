import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** One freshly ingested clip, ready to announce. */
export type AnnouncedClip = {
  publicCode: string;
};

/**
 * Pause between multi-clip drops so the channel doesn't get a spam wall.
 * Discord's per-webhook bucket is 5 requests / 2 s (= 2.5/s); 400 ms sat
 * exactly on that limit and tripped 429s on bigger drops, so stay under it.
 */
const ANNOUNCE_GAP_MS = 700;

/** Attempts per clip before giving up on that one and moving to the next. */
const MAX_ATTEMPTS = 4;

/** Cap on an honoured 429 `retry_after`, so a huge value can't stall the run. */
const MAX_RETRY_WAIT_MS = 15_000;

/**
 * Posts freshly rendered clips to a Discord channel via an incoming webhook
 * (DISCORD_WEBHOOK_URL). Each clip is its own message with a bare share URL
 * so Discord unfurls OpenGraph (poster + og:video). One link per message
 * keeps embeds clean; a short gap between posts keeps multi-clip drops readable.
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
      // One message per clip: bare link only — the unfurled embed title
      // (player | type [style] | map) already says everything.
      const content = `${this.siteUrl}/clip/${encodeURIComponent(clip.publicCode)}`;
      const outcome = await this.postClip(content);
      if (outcome === 'fatal') {
        // Bad/deleted webhook (401/403/404): every remaining post fails the
        // same way, so bail — but say how many clips that cost.
        this.logger.warn(
          `Discord announcements aborted: ${clips.length - announced} clip(s) not posted`,
        );
        return;
      }
      if (outcome === 'sent') announced++;
      if (i < clips.length - 1) {
        await sleep(ANNOUNCE_GAP_MS);
      }
    }
    if (announced < clips.length) {
      this.logger.warn(
        `Announced ${announced}/${clips.length} new clip(s) to Discord — ${clips.length - announced} dropped`,
      );
    } else {
      this.logger.log(`Announced ${announced} new clip(s) to Discord`);
    }
  }

  /**
   * Post one clip, retrying the retryable failures.
   *
   * 429 is the common one on multi-clip drops and is explicitly recoverable —
   * Discord tells us how long to wait — so it must never abort the batch.
   * 5xx/network errors get a backoff too. Only an auth/not-found status means
   * the webhook itself is dead and the rest of the batch is pointless.
   */
  private async postClip(content: string): Promise<'sent' | 'dropped' | 'fatal'> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(this.webhookUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        });
        if (res.ok) return 'sent';

        if (res.status === 429) {
          const wait = await retryAfterMs(res);
          this.logger.debug(
            `Discord rate-limited (attempt ${attempt}/${MAX_ATTEMPTS}); waiting ${wait} ms`,
          );
          await sleep(wait);
          continue;
        }
        if (res.status >= 500) {
          await sleep(backoffMs(attempt));
          continue;
        }

        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Discord webhook rejected clip announcement: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
        // 4xx other than 429: a malformed payload is this clip's problem,
        // a dead webhook is the whole batch's.
        return res.status === 401 || res.status === 403 || res.status === 404
          ? 'fatal'
          : 'dropped';
      } catch (e) {
        this.logger.warn(
          `Discord webhook unreachable (attempt ${attempt}/${MAX_ATTEMPTS}): ${(e as Error).message}`,
        );
        if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt));
      }
    }
    this.logger.warn(`Giving up on clip announcement after ${MAX_ATTEMPTS} attempts`);
    return 'dropped';
  }
}

/**
 * How long a 429 wants us to wait. Discord sends `retry_after` (seconds, may
 * be fractional) in the JSON body and mirrors it in the `Retry-After` header;
 * fall back to a fixed pause if neither parses.
 */
async function retryAfterMs(res: Response): Promise<number> {
  let seconds = Number(res.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const body = (await res.json().catch(() => null)) as {
      retry_after?: number;
    } | null;
    seconds = Number(body?.retry_after);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) return 1_000;
  // Pad slightly — Discord's clock and ours won't agree exactly.
  return Math.min(Math.ceil(seconds * 1000) + 250, MAX_RETRY_WAIT_MS);
}

function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
