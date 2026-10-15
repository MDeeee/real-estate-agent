import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/common/frontmatter.js';
import { loadCases, parseCases } from './cases.js';

const SAMPLES_DIR = resolve(import.meta.dirname, '../../../samples/properties');
const ARABIC = /\p{Script=Arabic}/u;

async function sampleSlugs(): Promise<Set<string>> {
  const files = (await readdir(SAMPLES_DIR)).filter((f) => f.endsWith('.md'));
  const slugs = await Promise.all(
    files.map(async (file) => {
      const { data } = parseFrontmatter(
        await readFile(resolve(SAMPLES_DIR, file), 'utf8'),
      );
      return String(data['slug']);
    }),
  );
  return new Set(slugs);
}

describe('cases.json', () => {
  it('is valid and has the planned mix', async () => {
    const cases = await loadCases(resolve(import.meta.dirname, 'cases.json'));
    expect(cases).toHaveLength(26);

    const multiTurn = cases.filter(({ turns }) => turns.length > 1);
    const singleTurn = cases.filter(({ turns }) => turns.length === 1);
    const arabic = singleTurn.filter(({ turns }) =>
      turns.some((turn) => ARABIC.test(turn)),
    );
    // Single-turn English cases include the Arabizi and the no-results one.
    expect(multiTurn).toHaveLength(10);
    expect(arabic).toHaveLength(6);
    expect(singleTurn.length - arabic.length).toBe(10);

    expect(cases.filter(({ expect: e }) => e.expectRefusal)).toHaveLength(2);
    expect(cases.filter(({ expect: e }) => e.intent === 'book')).toHaveLength(
      3,
    );
    expect(cases.filter(({ expect: e }) => e.expectNoHits)).toHaveLength(1);
    expect(
      cases.filter(({ expect: e }) => e.replyLanguage === 'ar'),
    ).toHaveLength(3);
    expect(
      cases.filter(({ expect: e }) => e.replyLanguage === 'en'),
    ).toHaveLength(1);
  });

  it('only names listings that exist in samples/properties', async () => {
    const known = await sampleSlugs();
    expect(known.size).toBe(20);
    const cases = await loadCases(resolve(import.meta.dirname, 'cases.json'));
    const named = cases.flatMap(({ expect: e }) => [
      ...(e.anyOfSlugs ?? []),
      ...(e.noneOfSlugs ?? []),
      ...(e.focusSlug ?? []),
    ]);
    expect(named.filter((slug) => !known.has(slug))).toEqual([]);
  });

  it('never lists a slug as both wanted and forbidden', async () => {
    const cases = await loadCases(resolve(import.meta.dirname, 'cases.json'));
    for (const { id, expect: e } of cases) {
      const overlap = (e.anyOfSlugs ?? []).filter((slug) =>
        (e.noneOfSlugs ?? []).includes(slug),
      );
      expect(overlap, id).toEqual([]);
    }
  });
});

describe('parseCases', () => {
  const valid = {
    id: 'x',
    turns: ['hello'],
    expect: { intent: 'smalltalk' },
  };

  it('rejects an unknown intent, filter field or case key', () => {
    expect(() =>
      parseCases([{ ...valid, expect: { intent: 'dance' } }]),
    ).toThrow();
    expect(() =>
      parseCases([
        { ...valid, expect: { intent: 'search', filters: { colour: 'red' } } },
      ]),
    ).toThrow();
    expect(() => parseCases([{ ...valid, extra: true }])).toThrow();
  });

  it('rejects duplicate ids and empty conversations', () => {
    expect(() => parseCases([valid, valid])).toThrow(/Duplicate/);
    expect(() => parseCases([{ ...valid, turns: [] }])).toThrow();
  });

  it('accepts focusSlug as one slug or a list and stores a list', () => {
    const [one, many] = parseCases([
      { ...valid, id: 'one', expect: { intent: 'details', focusSlug: 'a-b' } },
      {
        ...valid,
        id: 'many',
        expect: { intent: 'details', focusSlug: ['a-b', 'c-d'] },
      },
    ]);
    expect(one?.expect.focusSlug).toEqual(['a-b']);
    expect(many?.expect.focusSlug).toEqual(['a-b', 'c-d']);
    expect(() =>
      parseCases([{ ...valid, expect: { intent: 'details', focusSlug: [] } }]),
    ).toThrow();
  });

  it('accepts expectNoHits and a reply language, and rejects an unknown language', () => {
    const [parsed] = parseCases([
      {
        ...valid,
        expect: { intent: 'search', expectNoHits: true, replyLanguage: 'ar' },
      },
    ]);
    expect(parsed?.expect.expectNoHits).toBe(true);
    expect(parsed?.expect.replyLanguage).toBe('ar');
    expect(() =>
      parseCases([
        { ...valid, expect: { intent: 'search', replyLanguage: 'fr' } },
      ]),
    ).toThrow();
  });

  it('normalises filter values the way the search does', () => {
    const [parsed] = parseCases([
      {
        ...valid,
        expect: {
          intent: 'search',
          filters: { listing: 'rent', priceMax: '5' },
        },
      },
    ]);
    expect(parsed?.expect.filters).toEqual({ listing: 'RENT', priceMax: 5 });
  });
});
