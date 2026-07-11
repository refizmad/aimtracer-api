import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SHARECODE_API =
  'https://api.steampowered.com/ICSGOPlayers_730/GetNextMatchSharingCode/v1/';

export type SteamShareCodeResult =
  | { kind: 'next'; nextcode: string }
  | { kind: 'caught_up' }
  | { kind: 'invalid_auth' }
  | { kind: 'share_code_mismatch' }
  | { kind: 'soft_error'; status: number; body: string };

@Injectable()
export class SteamMatchHistoryClient {
  private readonly logger = new Logger(SteamMatchHistoryClient.name);

  constructor(private readonly config: ConfigService) {}

  getApiKey(): string {
    const key =
      this.config.get<string>('STEAM_WEBAPI_KEY') ||
      this.config.get<string>('STEAM_API_KEY') ||
      '';
    if (!key) {
      throw new Error('STEAM_WEBAPI_KEY (or STEAM_API_KEY) is required for match history');
    }
    return key;
  }

  /**
   * One page of GetNextMatchSharingCode.
   * 200 + nextcode → next match; 202 → caught up; 403 → bad key/auth; 412 → code ≠ account.
   */
  async getNextShareCode(opts: {
    steamId64: string;
    authCode: string;
    knownCode: string;
  }): Promise<SteamShareCodeResult> {
    const url = new URL(SHARECODE_API);
    url.searchParams.set('key', this.getApiKey());
    url.searchParams.set('steamid', opts.steamId64);
    url.searchParams.set('steamidkey', opts.authCode);
    url.searchParams.set('knowncode', opts.knownCode);

    let res: Response;
    try {
      res = await fetch(url.toString(), { method: 'GET' });
    } catch (e: any) {
      this.logger.warn(`Steam match history network error: ${e?.message}`);
      return { kind: 'soft_error', status: 0, body: e?.message || 'network' };
    }

    if (res.status === 403) return { kind: 'invalid_auth' };
    if (res.status === 412) return { kind: 'share_code_mismatch' };
    if (res.status === 202) return { kind: 'caught_up' };

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { kind: 'soft_error', status: res.status, body: body.slice(0, 200) };
    }

    const data = (await res.json().catch(() => ({}))) as {
      result?: { nextcode?: string };
    };
    const nextcode = data.result?.nextcode;
    if (!nextcode || nextcode === 'n/a') {
      return { kind: 'caught_up' };
    }
    return { kind: 'next', nextcode };
  }
}
