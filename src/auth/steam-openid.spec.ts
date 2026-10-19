import { sameReturnTo, verifySteamOpenId } from './steam-openid';

const RETURN_TO = 'https://aimtracer.com/api/auth/steam/callback?state=as_abc123';
const CLAIMED = 'https://steamcommunity.com/openid/id/76561198000000001';

function assertion(overrides: Record<string, string> = {}) {
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': CLAIMED,
    'openid.identity': CLAIMED,
    'openid.return_to': RETURN_TO,
    'openid.response_nonce': '2026-10-19T12:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2ln',
    ...overrides,
  };
}

describe('verifySteamOpenId', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('accepts a valid assertion issued for this login', async () => {
    const res = await verifySteamOpenId(assertion(), RETURN_TO);
    expect(res).toEqual({ ok: true, steamId64: '76561198000000001' });
  });

  it('rejects an assertion issued for another site, without asking Steam', async () => {
    const res = await verifySteamOpenId(
      assertion({ 'openid.return_to': 'https://evil.example/steam/callback' }),
      RETURN_TO,
    );
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an assertion for a different login attempt (state mismatch)', async () => {
    const res = await verifySteamOpenId(
      assertion({
        'openid.return_to': 'https://aimtracer.com/api/auth/steam/callback?state=as_other',
      }),
      RETURN_TO,
    );
    expect(res.ok).toBe(false);
  });

  it('rejects when return_to or claimed_id is not signed', async () => {
    const res = await verifySteamOpenId(
      assertion({ 'openid.signed': 'signed,op_endpoint,identity,response_nonce,assoc_handle' }),
      RETURN_TO,
    );
    expect(res.ok).toBe(false);
  });

  it('rejects a foreign op_endpoint', async () => {
    const res = await verifySteamOpenId(
      assertion({ 'openid.op_endpoint': 'https://evil.example/openid/login' }),
      RETURN_TO,
    );
    expect(res.ok).toBe(false);
  });

  it('rejects when Steam says the signature is invalid', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'is_valid:false\n' });
    const res = await verifySteamOpenId(assertion(), RETURN_TO);
    expect(res.ok).toBe(false);
  });
});

describe('sameReturnTo', () => {
  it('ignores param order and encoding differences', () => {
    expect(
      sameReturnTo('https://aimtracer.com/api/auth/steam/callback?b=2&state=as%5Fabc', 'https://aimtracer.com/api/auth/steam/callback?state=as_abc&b=2'),
    ).toBe(true);
  });

  it('rejects missing, malformed, or different URLs', () => {
    expect(sameReturnTo(undefined, RETURN_TO)).toBe(false);
    expect(sameReturnTo('not a url', RETURN_TO)).toBe(false);
    expect(sameReturnTo('http://aimtracer.com/api/auth/steam/callback?state=as_abc123', RETURN_TO)).toBe(false);
  });
});
