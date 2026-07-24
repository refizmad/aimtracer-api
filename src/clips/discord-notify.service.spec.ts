import { ConfigService } from '@nestjs/config';
import { AnnouncedClip, DiscordNotifyService } from './discord-notify.service';

/** Config stub with just the two keys the service reads. */
function config(): ConfigService {
  const values: Record<string, string> = {
    DISCORD_WEBHOOK_URL: 'https://discord.test/webhook',
    PUBLIC_SITE_URL: 'https://aimtracer.test',
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function clips(n: number): AnnouncedClip[] {
  return Array.from({ length: n }, (_, i) => ({ publicCode: `code${i}` }));
}

function ok(): Response {
  return { ok: true, status: 204 } as Response;
}

/** A 429 carrying `retry_after` in the body, as Discord actually sends it. */
function rateLimited(retryAfter: number): Response {
  return {
    ok: false,
    status: 429,
    headers: { get: () => null },
    json: () => Promise.resolve({ retry_after: retryAfter }),
  } as unknown as Response;
}

function status(code: number): Response {
  return {
    ok: false,
    status: code,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

describe('DiscordNotifyService', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    // Sleeps are real time otherwise: the announce gap alone is 700ms/clip.
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  it('posts every clip when Discord accepts them', async () => {
    fetchMock.mockResolvedValue(ok());
    await new DiscordNotifyService(config()).announceNewClips(clips(5));
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  // The regression: a 429 mid-batch used to abort the loop, silently
  // dropping every remaining clip.
  it('retries a rate-limited clip and still posts the rest', async () => {
    fetchMock
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(rateLimited(0.5))
      .mockResolvedValue(ok());

    await new DiscordNotifyService(config()).announceNewClips(clips(4));

    // 4 clips + 1 retry of the rate-limited one.
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const posted = fetchMock.mock.calls.map(
      (c) => JSON.parse(c[1].body as string).content as string,
    );
    for (const clip of clips(4)) {
      expect(posted).toContain(`https://aimtracer.test/clip/${clip.publicCode}`);
    }
  });

  it('retries transient network failures instead of dropping the batch', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(ok());

    await new DiscordNotifyService(config()).announceNewClips(clips(3));

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('stops the batch on a dead webhook', async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockResolvedValue(status(404));

    await new DiscordNotifyService(config()).announceNewClips(clips(5));

    // First succeeds, second 404s and aborts — no further posts attempted.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is a no-op without a webhook configured', async () => {
    const empty = { get: () => undefined } as unknown as ConfigService;
    await new DiscordNotifyService(empty).announceNewClips(clips(3));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
