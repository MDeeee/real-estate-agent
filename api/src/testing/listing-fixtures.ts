export interface ListingOverrides {
  slug?: string;
  title?: string;
  body?: string;
  extraFrontmatter?: string;
  fields?: Record<string, string | number | null>;
}

const DEFAULT_BODY = [
  '## Location',
  '',
  'A quiet street close to the Nile, with cafes and shops within walking distance.',
  '',
  '## The unit',
  '',
  'Bright two-bedroom apartment with a balcony, a fitted kitchen and central air conditioning.',
].join('\n');

export function listingMarkdown({
  slug = 'zamalek-test-flat',
  title = 'Test flat in Zamalek',
  body = DEFAULT_BODY,
  extraFrontmatter = '',
  fields = {},
}: ListingOverrides = {}): string {
  const frontmatter: Record<string, string | number | null> = {
    slug,
    title,
    type: 'apartment',
    listing: 'RENT',
    price: 45000,
    currency: 'EGP',
    bedrooms: 2,
    bathrooms: 1,
    areaM2: 110,
    city: 'Zamalek',
    district: '26th of July Street',
    ...fields,
  };
  const lines = [
    '---',
    ...Object.entries(frontmatter)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `${key}: ${value}`),
  ];
  if (extraFrontmatter) lines.push(extraFrontmatter);
  lines.push('---', '', body, '');
  return lines.join('\n');
}

export function longBody(sections = 6): string {
  const paragraph =
    'This listing has generous reception areas, a modern kitchen, quiet surroundings and secure parking. '.repeat(
      5,
    );
  return Array.from(
    { length: sections },
    (_, i) => `## Section ${i + 1}\n\n${paragraph}`,
  ).join('\n\n');
}
