import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('CredentialsCrypto');

/**
 * AES-256-GCM encryption for match-history auth codes.
 * Package format: v1:<ivB64>:<tagB64>:<ciphertextB64>
 */
export class CredentialsCrypto {
  private readonly key: Buffer;

  constructor(keyBase64: string | undefined) {
    if (!keyBase64) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY is required (base64 of 32 random bytes). Generate: openssl rand -base64 32',
      );
    }
    let key: Buffer;
    try {
      key = Buffer.from(keyBase64, 'base64');
    } catch {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY must be valid base64');
    }
    if (key.length !== 32) {
      throw new Error(
        `CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate: openssl rand -base64 32`,
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
  }

  decrypt(packageStr: string): string {
    const parts = packageStr.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Invalid ciphertext package');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}

let singleton: CredentialsCrypto | null = null;

export function getCredentialsCrypto(keyBase64: string | undefined): CredentialsCrypto {
  if (!singleton) {
    singleton = new CredentialsCrypto(keyBase64);
    logger.log('Credentials encryption ready (AES-256-GCM)');
  }
  return singleton;
}

/** Reset between tests only */
export function resetCredentialsCryptoForTests(): void {
  singleton = null;
}
