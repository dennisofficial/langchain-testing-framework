/**
 * Run `fn` over every item with at most `limit` in flight. Preserves input order in the
 * returned array. Never rejects on a single item — `fn` is expected to capture its own
 * errors (the runner stores them on the case result).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
