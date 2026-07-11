import { randomBytes } from 'crypto';

/**
 * Ambiguity-safe alphabet (no 0/O/1/I/l). ~57 symbols → 6 chars ≈ 34e9 space.
 */
export const PUBLIC_CODE_ALPHABET =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const PUBLIC_CODE_LENGTH = 6;

/** Cryptographically random public share code (default 6 chars). */
export function generatePublicCode(length = PUBLIC_CODE_LENGTH): string {
  const alphabet = PUBLIC_CODE_ALPHABET;
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function isClipUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}
