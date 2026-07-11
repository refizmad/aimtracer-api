import {
  generatePublicCode,
  isClipUuid,
  PUBLIC_CODE_ALPHABET,
  PUBLIC_CODE_LENGTH,
} from './public-code.util';

describe('public-code.util', () => {
  it('generates fixed-length codes from the safe alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePublicCode();
      expect(code).toHaveLength(PUBLIC_CODE_LENGTH);
      for (const ch of code) {
        expect(PUBLIC_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it('detects UUIDs vs short codes', () => {
    expect(isClipUuid('a1b2c3d4-e5f6-4890-abcd-ef1234567890')).toBe(true);
    expect(isClipUuid('xK9mQ2')).toBe(false);
    expect(isClipUuid('not-a-uuid')).toBe(false);
  });
});
