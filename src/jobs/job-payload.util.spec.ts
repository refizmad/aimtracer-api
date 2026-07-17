import { trustedSteamIdsOf, withTrustedSteamId } from './job-payload.util';

describe('trustedSteamIdsOf', () => {
  it('returns the clean string list', () => {
    expect(trustedSteamIdsOf({ trustedSteamIds: ['765A', ' 765B '] })).toEqual([
      '765A',
      '765B',
    ]);
  });

  it('tolerates missing/malformed fields from a JSON boundary', () => {
    expect(trustedSteamIdsOf(undefined)).toEqual([]);
    expect(trustedSteamIdsOf({})).toEqual([]);
    expect(trustedSteamIdsOf({ trustedSteamIds: 'nope' })).toEqual([]);
    expect(trustedSteamIdsOf({ trustedSteamIds: [null, '', 765] })).toEqual(['765']);
  });
});

describe('withTrustedSteamId', () => {
  it('appends a new steamid, keeping order and other fields', () => {
    const payload = {
      shareCode: 'CSGO-x',
      trustedSteamIds: ['765A'],
      options: { limit: 2 },
    };
    expect(withTrustedSteamId(payload, '765B')).toEqual({
      shareCode: 'CSGO-x',
      trustedSteamIds: ['765A', '765B'],
      options: { limit: 2 },
    });
    // Input untouched (the caller may still hold the Prisma row).
    expect(payload.trustedSteamIds).toEqual(['765A']);
  });

  it('returns null when the steamid is already trusted (no write needed)', () => {
    expect(
      withTrustedSteamId({ trustedSteamIds: ['765A', '765B'] }, '765B'),
    ).toBeNull();
  });

  it('handles a payload without the field', () => {
    expect(withTrustedSteamId({ shareCode: 'CSGO-x' }, '765A')).toEqual({
      shareCode: 'CSGO-x',
      trustedSteamIds: ['765A'],
    });
  });
});
