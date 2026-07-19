import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
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
   * Every object key belonging to one clip file: the mp4 itself plus its
   * companions by upload.py convention — `<stem>.jpg` poster, `<stem>.json`
   * metadata sidecar.
   */
  keysForClipFile(file: string): string[] {
    const base = file.replace(/^\/+/, '');
    const stem = base.replace(/\.[^.]+$/, '');
    return [base, `${stem}.jpg`, `${stem}.json`].map((f) =>
      this.objectKeyForFile(f),
    );
  }

  /**
   * Best-effort bucket delete for clip files (mp4 + poster + sidecar each).
   * Never throws — a bucket hiccup or missing delete permission must not
   * block the DB delete that triggered it. Missing keys count as deleted
   * (standard S3 DeleteObjects semantics).
   */
  async deleteClipObjects(
    files: string[],
  ): Promise<{ deleted: number; errors: string[] }> {
    return this.deleteObjectKeys([
      ...new Set(files.flatMap((f) => this.keysForClipFile(f))),
    ]);
  }

  /** Best-effort delete of exact (already-prefixed) object keys. Never throws. */
  async deleteObjectKeys(
    keys: string[],
  ): Promise<{ deleted: number; errors: string[] }> {
    if (keys.length === 0) return { deleted: 0, errors: [] };
    if (!this.configured || !this.client || !this.bucket) {
      return { deleted: 0, errors: ['S3 not configured'] };
    }
    let deleted = 0;
    const errors: string[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      try {
        const res = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: chunk.map((Key) => ({ Key })),
              Quiet: false,
            },
          }),
        );
        deleted += res.Deleted?.length ?? 0;
        for (const err of res.Errors ?? []) {
          errors.push(`${err.Key}: ${err.Code} ${err.Message ?? ''}`.trim());
        }
      } catch (e) {
        const msg = (e as Error).message;
        this.logger.warn(`S3 delete failed for ${chunk.length} key(s): ${msg}`);
        errors.push(msg);
      }
    }
    if (errors.length > 0) {
      this.logger.warn(
        `S3 clip delete finished with ${errors.length} error(s): ${errors[0]}`,
      );
    }
    return { deleted, errors };
  }

  /**
   * All object keys under the clip prefix (paginated). Throws when S3 is not
   * configured — callers gate on isConfigured() first.
   */
  async listAllObjects(): Promise<Array<{ key: string; size: number }>> {
    if (!this.configured || !this.client || !this.bucket) {
      throw new ServiceUnavailableException('S3 is not configured');
    }
    const out: Array<{ key: string; size: number }> = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix ? `${this.prefix}/` : undefined,
          ContinuationToken: token,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key) out.push({ key: obj.Key, size: obj.Size ?? 0 });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
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
