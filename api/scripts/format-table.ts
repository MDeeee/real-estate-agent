export type Align = 'left' | 'right';

export interface Column {
  header: string;
  align?: Align;
}

/** Plain-text table with padded columns, for terminal and CI logs. */
export function renderTable(
  columns: readonly Column[],
  rows: readonly (readonly string[])[],
): string {
  const widths = columns.map(({ header }, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => {
        const width = widths[index] ?? cell.length;
        return columns[index]?.align === 'right'
          ? cell.padStart(width)
          : cell.padEnd(width);
      })
      .join('  ')
      .trimEnd();
  const rule = widths.map((width) => '-'.repeat(width)).join('  ');
  return [
    line(columns.map(({ header }) => header)),
    rule,
    ...rows.map(line),
  ].join('\n');
}
