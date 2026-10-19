import type { ClusterClient } from 'discord-hybrid-sharding';

declare module 'discord.js' {
  interface Client {
    cluster: ClusterClient<Client>;
    /** This process's metrics for the manager's `/metrics` (see metrics.ts). */
    metricsSnapshot: () => Promise<unknown[]>;
  }
}
