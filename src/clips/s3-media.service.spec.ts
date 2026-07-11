import { ConfigService } from '@nestjs/config';
import { isPlayableStoredUrl, S3MediaService } from './s3-media.service';

function makeConfig(map: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => map[key],
  } as ConfigService;
}

describe('S3MediaService', () => {
  it('uses dev fallback when S3 is not configured', async () => {
    const svc = new S3MediaService(
      makeConfig({
        NODE_ENV: 'development',
        CLIP_MEDIA_DEV_FALLBACK_URL: 'https://example.test/sample.mp4',
      }),
    );
    expect(svc.isConfigured()).toBe(false);
    const result = await svc.getPlayableUrl('clip.mp4', null);
    expect(result).toEqual({
      url: 'https://example.test/sample.mp4',
      source: 'dev_fallback',
      expiresIn: null,
    });
  });

  it('falls back to stored URL when no S3 and no dev URL in production', async () => {
    const svc = new S3MediaService(
      makeConfig({
        NODE_ENV: 'production',
      }),
    );
    const result = await svc.getPlayableUrl(
      'clip.mp4',
      'https://bucket.example/clip.mp4?sig=1',
    );
    expect(result.source).toBe('stored');
    expect(result.url).toContain('bucket.example');
  });

  it('isPlayableStoredUrl rejects bare private S3/e2 object URLs', () => {
    expect(
      isPlayableStoredUrl(
        'https://s3.eu-central-1.idrivee2.com/aimtracer-clips/clips/a.mp4',
      ),
    ).toBe(false);
    expect(
      isPlayableStoredUrl(
        'https://s3.example/bucket/a.mp4?X-Amz-Signature=abc',
      ),
    ).toBe(true);
    expect(
      isPlayableStoredUrl(
        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/x.mp4',
      ),
    ).toBe(true);
  });

  it('builds object keys with prefix', () => {
    const svc = new S3MediaService(
      makeConfig({
        S3_ENDPOINT_URL: 'https://s3.example',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'k',
        S3_SECRET_ACCESS_KEY: 's',
        S3_PREFIX: 'clips/',
        NODE_ENV: 'production',
      }),
    );
    expect(svc.isConfigured()).toBe(true);
    expect(svc.objectKeyForFile('a.mp4')).toBe('clips/a.mp4');
  });
});
