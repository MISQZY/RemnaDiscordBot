/**
 * Runs `task` for every item, at most `limit` at a time, and resolves when all are done. A task's error is its own
 * to handle: the first one thrown rejects the whole run.
 */
export async function eachLimit<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await task(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
