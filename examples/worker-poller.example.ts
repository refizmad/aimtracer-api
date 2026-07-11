/**
 * Example of what a Node worker client would look like.
 * The real clipper (Python) will do the equivalent using requests / httpx.
 *
 * Usage:
 *   X_MACHINE_TOKEN=mt_xxx npx ts-node examples/worker-poller.example.ts
 */

// NOTE: This is an illustrative example only.
// No external HTTP lib required — uses global fetch (Node 18+ / modern runtimes).

const BASE = process.env.API_BASE || 'http://localhost:3001';
const TOKEN = process.env.X_MACHINE_TOKEN || 'dev_machine_token_please_change';

const HEADERS = {
  'X-Machine-Token': TOKEN,
  'Content-Type': 'application/json',
};

async function apiGet<T>(path: string, params?: Record<string, any>): Promise<T> {
  const url = new URL(path, BASE);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(35_000) });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPatch<T>(path: string, body: any): Promise<T> {
  const res = await fetch(new URL(path, BASE), {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

interface LeasedJob {
  id: string;
  type: string;
  payload: {
    shareCode: string;
    trustedSteamIds?: string[];
    options?: Record<string, any>;
  };
  attempts: number;
  leaseExpiresAt: string;
}

async function pollLoop() {
  console.log('Worker starting. Polling for clip jobs...');

  while (true) {
    try {
      // Long-poll up to ~25s
      const { job } = await apiGet<{ job: LeasedJob | null }>('/worker/jobs/lease', { wait: 25 });

      if (!job) {
        console.log('No job, sleeping 3s...');
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      console.log('Leased job', job.id, job.payload.shareCode);

      // TODO: run the actual clipper here:
      // e.g. spawn python clipper.py fetch ...
      // stream progress via PATCH:

      await report(job.id, { status: 'PROCESSING', stage: 'downloading', progress: 5, message: 'Fetching demo' });

      // ... during render
      await report(job.id, { progress: 35, stage: 'rendering', message: 'Recording clip 2/5' });

      // on finish
      await report(job.id, {
        status: 'COMPLETED',
        progress: 100,
        stage: 'done',
        result: {
          clips: [{ id: 'clip_001_4k', url: 'https://...' }],
          manifestUrl: 'https://...',
        },
      });

      console.log('Job finished', job.id);
    } catch (err: any) {
      console.error('Lease or report error', err?.message || err);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function report(jobId: string, body: any) {
  await apiPatch(`/worker/jobs/${jobId}`, body);
}

pollLoop().catch(console.error);
