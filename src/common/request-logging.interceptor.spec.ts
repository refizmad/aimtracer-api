import { clientIp } from './request-logging.interceptor';
import { FastifyRequest } from 'fastify';

describe('clientIp', () => {
  it('prefers first X-Forwarded-For hop', () => {
    const req = {
      headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
      ip: '10.0.0.2',
    } as unknown as FastifyRequest;
    expect(clientIp(req)).toBe('203.0.113.1');
  });

  it('falls back to req.ip', () => {
    const req = {
      headers: {},
      ip: '198.51.100.9',
    } as unknown as FastifyRequest;
    expect(clientIp(req)).toBe('198.51.100.9');
  });
});
