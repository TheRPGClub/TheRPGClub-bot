/**
 * `count` with its noun, singular for one: `plural(2, "image")` is "2 images". `many` is
 * the plural when adding "s" will not do; `shown` is how the count is written (bold, say).
 */
export function plural(
  count: number,
  one: string,
  many = `${one}s`,
  shown = String(count),
): string {
  return `${shown} ${count === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
