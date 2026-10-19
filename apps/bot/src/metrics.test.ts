import { createLogger } from '@bot/logger';
import type { ClusterManager } from 'discord-hybrid-sharding';
import { Gauge, Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import { aggregateMetrics } from './metrics.js';

const logger = createLogger({ service: 'test', level: 'silent' });

async function clusterSnapshot(clusterId: number, guilds: number) {
  const registry = new Registry();
  new Gauge({ name: 'bot_guilds', help: 'guilds', labelNames: ['cluster'], registers: [registry] }).set({ cluster: String(clusterId) }, guilds);
  return registry.getMetricsAsJSON();
}

function fakeManager(clusters: Array<() => Promise<unknown>>): ClusterManager {
  return { clusters: new Map(clusters.map((evaluate, id) => [id, { id, eval: evaluate }])) } as unknown as ClusterManager;
}

describe('aggregateMetrics', () => {
  it('merges metrics of every cluster', async () => {
    const text = await aggregateMetrics(fakeManager([() => clusterSnapshot(0, 10), () => clusterSnapshot(1, 7)]), logger);

    expect(text).toContain('bot_guilds{cluster="0"} 10');
    expect(text).toContain('bot_guilds{cluster="1"} 7');
  });

  it('skips a cluster that does not answer', async () => {
    const text = await aggregateMetrics(fakeManager([() => clusterSnapshot(0, 10), () => Promise.reject(new Error('dead'))]), logger);

    expect(text).toContain('bot_guilds{cluster="0"} 10');
  });
});
