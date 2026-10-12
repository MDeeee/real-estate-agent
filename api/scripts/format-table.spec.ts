import { describe, expect, it } from 'vitest';
import { renderTable } from './format-table.js';

describe('renderTable', () => {
  it('pads columns to the widest cell and honours alignment', () => {
    const table = renderTable(
      [{ header: 'name' }, { header: 'n', align: 'right' }],
      [
        ['alpha', '1'],
        ['b', '22'],
      ],
    );
    expect(table.split('\n')).toEqual([
      'name    n',
      '-----  --',
      'alpha   1',
      'b      22',
    ]);
  });

  it('renders only the header and rule when there are no rows', () => {
    expect(renderTable([{ header: 'x' }], []).split('\n')).toEqual(['x', '-']);
  });
});
