import type { Redis } from 'ioredis';
import { STATE_KEY, topologyOf, type State } from './state.js';

const READ = `
local clock = redis.call('TIME')
return {redis.call('GET', KEYS[1]) or '', clock[1] * 1000 + math.floor(clock[2] / 1000)}
`;
const CAS = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
if now - tonumber(ARGV[3]) > 2000 then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

/** A persistent key: volatile-ttl eviction must never erase ownership early. */
export async function readState(redis: Redis): Promise<{ raw: string; state: State | null; now: number }> {
  const [raw, now] = await redis.eval(READ, 1, STATE_KEY) as [string, number];
  return { raw, state: raw ? JSON.parse(raw) as State : null, now: Number(now) };
}

export async function updateState(redis: Redis, mutate: (state: State | null, now: number) => State): Promise<State> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { raw, state, now } = await readState(redis);
    const next = mutate(state, now);
    next.topology = topologyOf(next.topology);
    if (await redis.eval(CAS, 1, STATE_KEY, raw, JSON.stringify(next), String(now))) return next;
  }
  throw new Error('Orchestration state contention or slow Redis; retry next tick');
}

export function coordinationRedisOptions() {
  return { maxRetriesPerRequest: 0, enableOfflineQueue: false, commandTimeout: 2_000, connectTimeout: 2_000 } as const;
}
