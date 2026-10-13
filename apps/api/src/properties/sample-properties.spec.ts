import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { propertyFrontmatterSchema } from './property-frontmatter.schema.js';

const samplesDir = resolve(
  import.meta.dirname,
  '../../../../samples/properties',
);
const ARABIC_LETTERS = /\p{Script=Arabic}/u;

const samples = readdirSync(samplesDir)
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => {
    const parsed = matter(readFileSync(resolve(samplesDir, file), 'utf8'));
    const words = parsed.content.split(/\s+/).filter(Boolean);
    return {
      file,
      data: parsed.data,
      wordCount: words.length,
      isArabic: ARABIC_LETTERS.test(parsed.content),
    };
  });

describe('samples/properties', () => {
  it('contains 20 listings', () => {
    expect(samples).toHaveLength(20);
  });

  it.each(samples)(
    '$file has valid frontmatter and a slug matching its filename',
    ({ file, data }) => {
      const result = propertyFrontmatterSchema.safeParse(data);
      expect(result.error?.message).toBeUndefined();
      expect(result.data?.slug).toBe(basename(file, '.md'));
    },
  );

  it.each(samples)('$file has a body of 120 to 250 words', ({ wordCount }) => {
    expect(wordCount).toBeGreaterThanOrEqual(120);
    expect(wordCount).toBeLessThanOrEqual(250);
  });

  it('has unique slugs and five Arabic bodies', () => {
    const slugs = new Set(samples.map((sample) => sample.data['slug']));
    expect(slugs.size).toBe(samples.length);
    expect(samples.filter((sample) => sample.isArabic)).toHaveLength(5);
  });

  it('covers every property type and both listing kinds', () => {
    const types = new Set(samples.map((sample) => sample.data['type']));
    const listings = new Set(samples.map((sample) => sample.data['listing']));
    expect(types).toEqual(
      new Set([
        'apartment',
        'chalet',
        'duplex',
        'office',
        'studio',
        'townhouse',
        'villa',
      ]),
    );
    expect(listings).toEqual(new Set(['RENT', 'SALE']));
  });
});
