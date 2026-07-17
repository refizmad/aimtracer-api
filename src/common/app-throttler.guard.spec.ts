import { ExecutionContext } from '@nestjs/common';
import { AppThrottlerGuard } from './app-throttler.guard';

function mockHttpContext(
  url: string,
  headers: Record<string, string> = {},
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ url, headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('AppThrottlerGuard.shouldSkip', () => {
  // Avoid full ThrottlerGuard DI; only exercise our shouldSkip override.
  const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
  const shouldSkip = (ctx: ExecutionContext) =>
    (
      guard as unknown as {
        shouldSkip: (c: ExecutionContext) => Promise<boolean>;
      }
    ).shouldSkip(ctx);

  it('skips non-http contexts', async () => {
    const ctx = {
      getType: () => 'rpc',
    } as unknown as ExecutionContext;
    expect(await shouldSkip(ctx)).toBe(true);
  });

  it('skips health and root probes', async () => {
    expect(await shouldSkip(mockHttpContext('/health'))).toBe(true);
    expect(await shouldSkip(mockHttpContext('/health/ready'))).toBe(true);
    expect(await shouldSkip(mockHttpContext('/'))).toBe(true);
  });

  it('skips worker routes by path (with or without machine token)', async () => {
    expect(await shouldSkip(mockHttpContext('/worker'))).toBe(true);
    expect(await shouldSkip(mockHttpContext('/worker/jobs/lease'))).toBe(true);
    expect(
      await shouldSkip(mockHttpContext('/worker/jobs/lease?wait=25')),
    ).toBe(true);
    expect(
      await shouldSkip(
        mockHttpContext('/worker/jobs/abc', { 'x-machine-token': 'mt_x' }),
      ),
    ).toBe(true);
  });

  it('does NOT skip non-worker routes when X-Machine-Token is present', async () => {
    // Regression: header-only skip let anyone bypass rate limits with a dummy header.
    expect(
      await shouldSkip(
        mockHttpContext('/auth/steam', { 'x-machine-token': 'dummy' }),
      ),
    ).toBe(false);
    expect(
      await shouldSkip(
        mockHttpContext('/admin/stats', { 'x-machine-token': 'dummy' }),
      ),
    ).toBe(false);
    expect(
      await shouldSkip(
        mockHttpContext('/clips', { 'x-machine-token': 'x' }),
      ),
    ).toBe(false);
    expect(
      await shouldSkip(
        mockHttpContext('/bootstrap/worker', {
          'x-machine-token': 'dummy',
        }),
      ),
    ).toBe(false);
  });

  it('does not skip ordinary API paths without skip markers', async () => {
    expect(await shouldSkip(mockHttpContext('/jobs'))).toBe(false);
    expect(await shouldSkip(mockHttpContext('/players/me'))).toBe(false);
  });
});
