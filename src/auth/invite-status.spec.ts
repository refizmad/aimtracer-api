import { classifyInvite } from './auth.service';

describe('classifyInvite', () => {
  const now = Date.parse('2026-07-17T12:00:00.000Z');

  it('invalid when missing', () => {
    expect(classifyInvite(null, now)).toBe('invalid');
  });

  it('ok when uses remain', () => {
    expect(
      classifyInvite({ useCount: 0, maxUses: 1, expiresAt: null }, now),
    ).toBe('ok');
    expect(
      classifyInvite({ useCount: 2, maxUses: 5, expiresAt: null }, now),
    ).toBe('ok');
  });

  it('used when useCount >= maxUses', () => {
    expect(
      classifyInvite({ useCount: 1, maxUses: 1, expiresAt: null }, now),
    ).toBe('used');
    expect(
      classifyInvite({ useCount: 5, maxUses: 5, expiresAt: null }, now),
    ).toBe('used');
  });

  it('expired when past expiresAt', () => {
    expect(
      classifyInvite(
        {
          useCount: 0,
          maxUses: 1,
          expiresAt: new Date('2026-07-16T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('expired');
  });

  it('prefers expired over used when both apply', () => {
    expect(
      classifyInvite(
        {
          useCount: 1,
          maxUses: 1,
          expiresAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('expired');
  });
});
