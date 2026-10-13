import { describe, expect, it } from 'vitest';
import { longBody } from '../testing/listing-fixtures.js';
import {
  CHUNK_SIZE,
  contextualHeader,
  splitMarkdownBody,
  toEmbeddingInput,
} from './markdown-chunker.js';

describe('splitMarkdownBody', () => {
  it('returns no chunks for a blank body', async () => {
    await expect(splitMarkdownBody('  \n\n ')).resolves.toEqual([]);
  });

  it('keeps a short body in a single chunk', async () => {
    await expect(splitMarkdownBody('## Notes\n\nShort text.')).resolves.toEqual(
      ['## Notes\n\nShort text.'],
    );
  });

  it('splits a long body into chunks no larger than the chunk size', async () => {
    const chunks = await splitMarkdownBody(longBody());
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });
});

describe('contextualHeader', () => {
  const base = {
    title: 'Villa in Sheikh Zayed',
    type: 'villa',
    listing: 'SALE',
    city: 'Sheikh Zayed',
  } as const;

  it('joins compound, district and city', () => {
    expect(
      contextualHeader({
        ...base,
        compound: 'Allegria',
        district: 'Beverly Hills',
      }),
    ).toBe(
      'Villa in Sheikh Zayed | villa for sale | Allegria, Beverly Hills, Sheikh Zayed',
    );
  });

  it('omits missing location parts', () => {
    expect(contextualHeader(base)).toBe(
      'Villa in Sheikh Zayed | villa for sale | Sheikh Zayed',
    );
  });

  it('prefixes the chunk with the header', () => {
    expect(toEmbeddingInput('Header', 'Body')).toBe('Header\n\nBody');
  });
});
