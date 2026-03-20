/**
 * Returns a subset of `items` containing the largest `topFraction` by `getSize`
 * (e.g. top 50% by effective world radius). Sorted by size descending; ties keep
 * input-relative order among equal sizes (stable for the pre-sorted slice).
 */
export function takeTopFractionBySize<T>(
  items: T[],
  getSize: (item: T) => number,
  topFraction: number
): T[] {
  if (items.length === 0) return []
  const f = Math.min(1, Math.max(0, topFraction))
  if (f <= 0) return []
  if (f >= 1) return [...items]
  const take = Math.min(items.length, Math.ceil(items.length * f))
  if (take <= 0) return []
  const indexed = items.map((item, index) => ({ item, index, size: getSize(item) }))
  indexed.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size
    return a.index - b.index
  })
  return indexed.slice(0, take).map((e) => e.item)
}
