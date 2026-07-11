/**
 * Fail-fast production config checks so a misconfigured Coolify deploy
 * refuses to start instead of silently serving a half-broken API.
 */

export type ProdConfigIssue = { key: string; message: string };

const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'ADMIN_TOKEN',
  'AUTH_RETURN_BASE_URL',
  'CREDENTIALS_ENCRYPTION_KEY',
  'STEAM_WEBAPI_KEY',
] as const;

/** Soft requirements: boot OK but readiness/media degraded until set. */
const WARN_IN_PRODUCTION = [
  'S3_ENDPOINT_URL',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV || '').toLowerCase() === 'production';
}

export function collectProdConfigIssues(
  env: NodeJS.ProcessEnv = process.env,
): { fatal: ProdConfigIssue[]; warnings: ProdConfigIssue[] } {
  const fatal: ProdConfigIssue[] = [];
  const warnings: ProdConfigIssue[] = [];

  if (!isProduction(env)) {
    return { fatal, warnings };
  }

  for (const key of REQUIRED_IN_PRODUCTION) {
    const v = (env[key] || '').trim();
    if (!v) {
      fatal.push({ key, message: `${key} is required in production` });
    }
  }

  const returnBase = (env.AUTH_RETURN_BASE_URL || '').trim();
  if (returnBase && !/^https:\/\//i.test(returnBase)) {
    fatal.push({
      key: 'AUTH_RETURN_BASE_URL',
      message: 'AUTH_RETURN_BASE_URL must be https://… in production (Steam OpenID return)',
    });
  }
  if (
    returnBase &&
    (/localhost|127\.0\.0\.1/i.test(returnBase) ||
      returnBase.includes('example.com'))
  ) {
    fatal.push({
      key: 'AUTH_RETURN_BASE_URL',
      message:
        'AUTH_RETURN_BASE_URL looks like a dev placeholder; set the public web origin (e.g. https://aimtracer.com)',
    });
  }

  const admin = (env.ADMIN_TOKEN || '').trim();
  if (admin && admin.length < 16) {
    fatal.push({
      key: 'ADMIN_TOKEN',
      message: 'ADMIN_TOKEN is too short for production (use ≥16 random chars)',
    });
  }

  const enc = (env.CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (enc) {
    try {
      const buf = Buffer.from(enc, 'base64');
      if (buf.length !== 32) {
        fatal.push({
          key: 'CREDENTIALS_ENCRYPTION_KEY',
          message:
            'CREDENTIALS_ENCRYPTION_KEY must be base64 of exactly 32 bytes',
        });
      }
    } catch {
      fatal.push({
        key: 'CREDENTIALS_ENCRYPTION_KEY',
        message: 'CREDENTIALS_ENCRYPTION_KEY is not valid base64',
      });
    }
  }

  for (const key of WARN_IN_PRODUCTION) {
    if (!(env[key] || '').trim()) {
      warnings.push({
        key,
        message: `${key} missing — private clip playback will 503 until S3 is configured`,
      });
    }
  }

  return { fatal, warnings };
}

/** Throws Error with a multi-line message if production config is invalid. */
export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const { fatal, warnings } = collectProdConfigIssues(env);
  for (const w of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[prod-config] WARN ${w.key}: ${w.message}`);
  }
  if (fatal.length) {
    const lines = fatal.map((f) => `  - ${f.key}: ${f.message}`).join('\n');
    throw new Error(
      `Production configuration invalid — refusing to start:\n${lines}`,
    );
  }
}
