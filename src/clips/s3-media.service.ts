import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Default playable URL lifetime for gallery loads (1 hour). */
const DEFAULT_EXPIRY_S = 3600;

/**
 * Mints short-lived GET URLs for private S3 objects (ADR-0004).
 * When S3 is not configured (local UI work), falls back to CLIP_MEDIA_DEV_FALLBACK_URL
 * so galleries can still exercise the <video> path without real bucket credentials.
 */
@Injectable()
export class S3MediaService {
  private readonly logger = new Logger(S3MediaService.name);
  private client: S3Client | null = null;
  private readonly bucket: string | null;
  private readonly prefix: string;
  private readonly expiryS: number;
  private readonly devFallbackUrl: string | null;
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('S3_ENDPOINT_URL')?.trim() || '';
    const bucket = this.config.get<string>('S3_BUCKET')?.trim() || '';
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID')?.trim() || '';
    const secretAccessKey =
      this.config.get<string>('S3_SECRET_ACCESS_KEY')?.trim() || '';
    const region = this.config.get<string>('S3_REGION')?.trim() || 'us-east-1';
    this.prefix = (this.config.get<string>('S3_PREFIX') || '').replace(
      /^\/+|\/+$/g,
      '',
    );
    this.expiryS = Math.min(
      Math.max(
        parseInt(String(this.config.get('S3_PRESIGN_EXPIRY') || DEFAULT_EXPIRY_S), 10) ||
          DEFAULT_EXPIRY_S,
        60,
      ),
      604800,
    );
    this.devFallbackUrl =
      this.config.get<string>('CLIP_MEDIA_DEV_FALLBACK_URL')?.trim() ||
      // Public sample H.264 for local UI only — never used when S3 is configured.
      (this.config.get<string>('NODE_ENV') !== 'production'
        ? 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'
        : null);

    this.configured = !!(endpoint && bucket && accessKeyId && secretAccessKey);
    this.bucket = this.configured ? bucket : null;

    if (this.configured) {
      const ep = endpoint.match(/^https?:\/\//i) ? endpoint : `https://${endpoint}`;
      this.client = new S3Client({
        endpoint: ep,
        region,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });
      this.logger.log(`S3 media signing enabled (bucket=${bucket})`);
    } else {
      this.logger.warn(
        'S3 not configured — clip media uses dev fallback URL when available',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  objectKeyForFile(file: string): string {
    const base = file.replace(/^\/+/, '');
    return this.prefix ? `${this.prefix}/${base}` : base;
  }

  /**
   * Resolve a playable HTTPS URL for a clip file basename (mp4 or jpg poster).
   * Prefer live presign; otherwise dev fallback (local UI). Never throws for
   * missing S3 when a fallback exists.
   */
  async getPlayableUrl(
    file: string,
    storedUrl?: string | null,
    opts?: { contentType?: string; allowDevFallback?: boolean },
  ): Promise<{
    url: string;
    source: 'presign' | 'dev_fallback' | 'stored';
    expiresIn: number | null;
  }> {
    const contentType =
      opts?.contentType ||
      (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'video/mp4');
    const allowDevFallback = opts?.allowDevFallback !== false;

    if (this.configured && this.client && this.bucket) {
      const key = this.objectKeyForFile(file);
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
      });
      const url = await getSignedUrl(this.client, command, {
        expiresIn: this.expiryS,
      });
      return { url, source: 'presign', expiresIn: this.expiryS };
    }

    // Dev sample is a video — only use it for video requests.
    if (allowDevFallback && contentType.startsWith('video/') && this.devFallbackUrl) {
      return {
        url: this.devFallbackUrl,
        source: 'dev_fallback',
        expiresIn: null,
      };
    }

    // Only use a stored URL if it is still a usable signed GET (or a public URL).
    // Bare iDrive/S3 object paths (fixtures / expired manifests) 403 on private buckets
    // and look like "clips not loading" in the gallery.
    if (storedUrl && isPlayableStoredUrl(storedUrl)) {
      return { url: storedUrl, source: 'stored', expiresIn: null };
    }

    throw new ServiceUnavailableException({
      code: 'MEDIA_UNAVAILABLE',
      message: this.configured
        ? 'Could not mint a playable URL for this clip'
        : 'Clip media signing is not configured — set S3_* env vars on the API (private bucket, ADR-0004)',
    });
  }
}

/** True if the URL is likely to stream without API re-signing. */
export function isPlayableStoredUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // SigV4 / older S3 query signatures
  if (/[?&]X-Amz-Signature=/i.test(url) || /[?&]Signature=/i.test(url)) {
    return true;
  }
  // Known private object hosts without a signature will AccessDenied
  if (
    /idrivee2|amazonaws\.com|\.r2\.cloudflarestorage\.com|s3[.-]/i.test(url)
  ) {
    return false;
  }
  // Other https URLs (CDN / public samples) — allow
  return true;
}
