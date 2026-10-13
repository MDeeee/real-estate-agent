import type { FacetValue } from './property.dto.js';

/**
 * Merges raw `groupBy` rows whose values differ only by case or surrounding
 * whitespace ("New Cairo" / "new cairo"), because the filters that consume
 * these values match case-insensitively. Counts are summed and the most
 * frequent spelling is shown (ties go to the alphabetically first one).
 */
export function mergeFacetValues(rows: readonly FacetValue[]): FacetValue[] {
  const groups = new Map<
    string,
    { count: number; spellings: Map<string, number> }
  >();
  for (const { value, count } of rows) {
    const display = value.trim();
    if (!display) continue;
    const key = display.toLowerCase();
    const group = groups.get(key) ?? { count: 0, spellings: new Map() };
    group.count += count;
    group.spellings.set(display, (group.spellings.get(display) ?? 0) + count);
    groups.set(key, group);
  }

  return [...groups.values()].map(({ count, spellings }) => {
    const [value] = [...spellings].sort(
      ([a, aCount], [b, bCount]) =>
        bCount - aCount || (a < b ? -1 : a > b ? 1 : 0),
    ) as [[string, number]];
    return { value: value[0], count };
  });
}
