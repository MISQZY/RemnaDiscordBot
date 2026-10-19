import type { Logger } from '@bot/logger';

/**
 * In-process events between modules. Modules extend the interface:
 *
 * declare module '@bot/core' {
 *   interface BusEvents { 'leveling.levelUp': { guildId: string; userId: string; level: number } }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended via declaration merging
export interface BusEvents {}

type BusHandler<K extends keyof BusEvents> = (payload: BusEvents[K]) => Promise<void> | void;

export class EventBus {
  private readonly handlers = new Map<keyof BusEvents, Set<BusHandler<never>>>();

  constructor(private readonly logger: Logger) {}

  on<K extends keyof BusEvents>(event: K, handler: BusHandler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as BusHandler<never>);
    return () => set.delete(handler as BusHandler<never>);
  }

  /** Calls all subscribers; one subscriber's error does not affect the others. */
  async emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): Promise<void> {
    const set = this.handlers.get(event);
    if (!set) return;

    const results = await Promise.allSettled(
      [...set].map(async (handler) => (handler as BusHandler<K>)(payload)),
    );
    for (const result of results) {
      if (result.status === 'rejected') this.logger.error({ err: result.reason, event }, 'Bus handler failed');
    }
  }
}
