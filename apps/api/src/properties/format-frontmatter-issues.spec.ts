import { describe, expect, it } from 'vitest';
import { formatFrontmatterIssues } from './format-frontmatter-issues.js';
import { propertyFrontmatterSchema } from './property-frontmatter.schema.js';

function format(input: Record<string, unknown>): string[] {
  const result = propertyFrontmatterSchema.safeParse(input);
  if (result.success) throw new Error('expected the input to be invalid');
  return formatFrontmatterIssues(result.error, input).split('\n');
}

const valid = {
  slug: 'flat',
  title: 'Flat',
  type: 'apartment',
  listing: 'SALE',
  price: 100,
  bedrooms: 1,
  bathrooms: 1,
  areaM2: 50,
  city: 'Cairo',
};

describe('formatFrontmatterIssues', () => {
  it('writes one "<field>: <message>" line per problem', () => {
    const lines = format({
      ...valid,
      city: undefined,
      price: 0,
      bedrooms: 'many',
      areaM2: 50.5,
      slug: 'Not Kebab',
    });

    expect(lines).toEqual(
      expect.arrayContaining([
        'city: required',
        'price: must be greater than 0',
        'bedrooms: must be a number',
        'areaM2: must be a whole number',
        'slug: must be lowercase kebab-case',
      ]),
    );
    expect(lines).toHaveLength(5);
  });

  it('lists the allowed values for enums and flags unknown fields', () => {
    const lines = format({ ...valid, type: 'castle', bedroom: 3 });

    expect(lines).toContain('bedroom: unknown field');
    expect(
      lines.find((line) => line.startsWith('type: must be one of: ')),
    ).toContain('apartment, villa');
  });

  it('explains empty values and blank text', () => {
    const lines = format({ ...valid, district: null, title: '   ' });

    expect(lines).toContain('title: must not be empty');
    expect(lines.find((line) => line.startsWith('district: '))).toContain(
      'is empty',
    );
  });

  it('uses the delivery-date message from the schema', () => {
    expect(format({ ...valid, deliveryDate: 2027 })).toEqual([
      'deliveryDate: deliveryDate must be a date like 2027-06-30',
    ]);
  });
});
