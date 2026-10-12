import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCitations, sanitiseCitations } from './citations.js';

// The web chat parses the same grammar (web/src/lib/chat-citations.ts) and
// replays the same cases: contracts/citations.json is the shared contract.
interface CitationCase {
  name: string;
  text: string;
  known: string[];
  slugs?: string[];
  sanitised?: { text: string; cited: string[]; dropped: string[] };
}
const contract = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../contracts/citations.json'),
    'utf8',
  ),
) as { cases: CitationCase[] };

const allowed = new Set(['zamalek-flat', 'laurel-villa']);

describe('sanitiseCitations', () => {
  it('keeps valid citations and reports each once, in order', () => {
    const result = sanitiseCitations(
      'Try [laurel-villa] or [zamalek-flat]; [laurel-villa] is bigger.',
      allowed,
    );
    expect(result.citedSlugs).toEqual(['laurel-villa', 'zamalek-flat']);
    expect(result.dropped).toEqual([]);
    expect(result.text).toBe(
      'Try [laurel-villa] or [zamalek-flat]; [laurel-villa] is bigger.',
    );
  });

  it('removes citations that are not in the allowed set', () => {
    const result = sanitiseCitations(
      'See [zamalek-flat] and [invented-penthouse].',
      allowed,
    );
    expect(result.text).toBe('See [zamalek-flat] and.');
    expect(result.citedSlugs).toEqual(['zamalek-flat']);
    expect(result.dropped).toEqual(['invented-penthouse']);
  });

  it('leaves other bracketed text alone', () => {
    const result = sanitiseCitations('Floor [4] and [Note] stay.', allowed);
    expect(result.text).toBe('Floor [4] and [Note] stay.');
    expect(result.dropped).toEqual([]);
  });

  it('does not touch markdown links, even when the link text looks like a slug', () => {
    const text =
      'See [zamalek-flat](https://evil.example/x) and [docs](https://a.b) or [invented-penthouse](http://c.d).';
    const result = sanitiseCitations(text, allowed);
    expect(result.text).toBe(text);
    expect(result.citedSlugs).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  it('still treats a bare slug followed by a space and a bracket as a citation', () => {
    const result = sanitiseCitations(
      'Try [zamalek-flat] (2 bedrooms).',
      allowed,
    );
    expect(result.citedSlugs).toEqual(['zamalek-flat']);
    expect(result.text).toBe('Try [zamalek-flat] (2 bedrooms).');
  });

  it('handles text without citations', () => {
    expect(sanitiseCitations('Nothing here.', allowed)).toEqual({
      text: 'Nothing here.',
      citedSlugs: [],
      dropped: [],
    });
  });
});

describe('extractCitations', () => {
  it('lists each cited slug once, in order, ignoring links and plain brackets', () => {
    expect(
      extractCitations(
        'See [b-two] then [a-one], [b-two] again, [Note], [4] and [x-link](http://a.b).',
      ),
    ).toEqual(['b-two', 'a-one']);
  });

  it('returns nothing for text without citations', () => {
    expect(extractCitations('Nothing here.')).toEqual([]);
  });
});

describe('shared citation contract (contracts/citations.json)', () => {
  it('has cases to replay', () => {
    expect(contract.cases.length).toBeGreaterThan(5);
  });

  // Cases about streaming belong to the web chat only.
  const shared = contract.cases.filter(
    ({ slugs, sanitised }) => slugs ?? sanitised,
  );
  describe.each(shared)('$name', (example) => {
    if (example.slugs) {
      it('extracts the cited slugs', () => {
        expect(extractCitations(example.text)).toEqual(example.slugs);
      });
    }
    if (example.sanitised) {
      it('sanitises against the known slugs', () => {
        const result = sanitiseCitations(example.text, new Set(example.known));
        expect(result).toEqual({
          text: example.sanitised?.text,
          citedSlugs: example.sanitised?.cited,
          dropped: example.sanitised?.dropped,
        });
      });
    }
  });
});
