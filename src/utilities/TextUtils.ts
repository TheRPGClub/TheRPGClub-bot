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
