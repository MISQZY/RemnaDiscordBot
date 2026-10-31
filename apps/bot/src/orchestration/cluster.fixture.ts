import { Redis } from 'ioredis';
import { startLeaseGuard } from './guard.js';
import { coordinationRedisOptions } from './store.js';

// A real OS process for ownership tests, with no Discord token or Gateway connection.
const redis = new Redis(process.env.REDIS_URL!, { ...coordinationRedisOptions(), lazyConnect: true });
redis.on('error', () => undefined);
await redis.connect();
await startLeaseGuard(redis, Number(process.env.TEST_CLUSTER_ID), process.env.SHARD_LEASE_TOKEN!, () => process.exit(12));
process.once('disconnect', () => process.exit(13));
process.send?.({ ready: true });
