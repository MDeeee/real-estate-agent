export interface ListingOverrides {
  slug?: string;
  title?: string;
  body?: string;
  extraFrontmatter?: string;
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
}: ListingOverrides = {}): string {
  const lines = [
    '---',
    `slug: ${slug}`,
    `title: ${title}`,
    'type: apartment',
    'listing: RENT',
    'price: 45000',
    'currency: EGP',
    'bedrooms: 2',
    'bathrooms: 1',
    'areaM2: 110',
    'city: Zamalek',
    'district: 26th of July Street',
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
