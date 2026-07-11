import {
  assertProductionConfig,
  collectProdConfigIssues,
  isProduction,
} from './prod-config';

describe('prod-config', () => {
  const good: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@db:5432/aimtrace',
    ADMIN_TOKEN: 'a'.repeat(32),
    AUTH_RETURN_BASE_URL: 'https://aimtracer.com',
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    STEAM_WEBAPI_KEY: 'steam-key',
    S3_ENDPOINT_URL: 'https://s3.example',
    S3_BUCKET: 'clips',
    S3_ACCESS_KEY_ID: 'ak',
    S3_SECRET_ACCESS_KEY: 'sk',
  };

  it('isProduction only when NODE_ENV=production', () => {
    expect(isProduction({ NODE_ENV: 'production' })).toBe(true);
    expect(isProduction({ NODE_ENV: 'development' })).toBe(false);
  });

  it('skips checks outside production', () => {
    const { fatal } = collectProdConfigIssues({ NODE_ENV: 'development' });
    expect(fatal).toHaveLength(0);
  });

  it('accepts a complete production config', () => {
    const { fatal, warnings } = collectProdConfigIssues(good);
    expect(fatal).toHaveLength(0);
    expect(warnings).toHaveLength(0);
    expect(() => assertProductionConfig(good)).not.toThrow();
  });

  it('fatals on missing ADMIN_TOKEN and http return base', () => {
    const { fatal } = collectProdConfigIssues({
      ...good,
      ADMIN_TOKEN: '',
      AUTH_RETURN_BASE_URL: 'http://aimtracer.com',
    });
    expect(fatal.map((f) => f.key).sort()).toEqual(
      ['ADMIN_TOKEN', 'AUTH_RETURN_BASE_URL'].sort(),
    );
  });

  it('warns when S3 is missing but still boots', () => {
    const env = { ...good };
    delete env.S3_ENDPOINT_URL;
    delete env.S3_BUCKET;
    delete env.S3_ACCESS_KEY_ID;
    delete env.S3_SECRET_ACCESS_KEY;
    const { fatal, warnings } = collectProdConfigIssues(env);
    expect(fatal).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
