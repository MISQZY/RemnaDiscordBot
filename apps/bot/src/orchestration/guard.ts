import type { Redis } from 'ioredis';
import { performance } from 'node:perf_hooks';
import { readState } from './store.js';
import { SAFETY_MS } from './state.js';

/** Checked before login and independently of the manager, including when Redis disappears. */
export async function startLeaseGuard(redis: Redis, cluster: number, token: string, revoke: () => void): Promise<() => void> {
  let stopped = false;
  let deadline = 0;
  let expiry: NodeJS.Timeout | undefined;
  const check = async () => {
    const started = performance.now();
    try {
      const { state, now } = await readState(redis);
      if (stopped) return;
      const lease = state?.leases[String(cluster)];
      const remaining = lease?.token === token ? lease.expiresAt - now - SAFETY_MS : 0;
      if (remaining <= 0) { revoke(); return; }
      // Include round trip time; delayed replies must never extend a lease locally.
      deadline = started + remaining;
      clearTimeout(expiry);
      expiry = setTimeout(revoke, Math.max(0, deadline - performance.now()));
    } catch {
      if (!deadline || performance.now() >= deadline) revoke();
    }
  };
  await check();
  const timer = setInterval(() => { void check(); }, 2_000);
  return () => { stopped = true; clearInterval(timer); clearTimeout(expiry); };
}
