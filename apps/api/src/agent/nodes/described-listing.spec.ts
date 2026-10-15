import { describe, expect, it } from 'vitest';
import { makeCard } from '../../testing/chat-fixtures.js';
import type { RetrievedListing } from '../agent-graph.types.js';
import { chooseDescribedListing } from './described-listing.js';

const sale: RetrievedListing = {
  card: makeCard('zamalek-apartment-sale', {
    title: 'Nile-view apartment in a classic Zamalek building',
  }),
  snippet: '',
  similarity: 0.6,
};
const rent: RetrievedListing = {
  card: makeCard('zamalek-apartment-rent', {
    title: 'Furnished two-bedroom apartment for rent in Zamalek',
  }),
  snippet: '',
  similarity: 0.5,
};
const villa: RetrievedListing = {
  card: makeCard('villa-one', { title: 'Corner villa in Laurel Hills' }),
  snippet: '',
  similarity: 0.4,
};

const retrieving = (results: RetrievedListing[]) => ({
  retrieve: () => Promise.resolve(results),
});
const lookup = { filters: { city: 'Zamalek' }, semanticQuery: '' };

describe('chooseDescribedListing', () => {
  it('chooses the only result of a filtered search', async () => {
    const result = await chooseDescribedListing(
      retrieving([villa]),
      lookup,
      'book the house',
    );
    expect(result.chosen?.card.slug).toBe('villa-one');
  });

  it('does not accept a single result when nothing was filtered on', async () => {
    const result = await chooseDescribedListing(
      retrieving([villa]),
      { filters: {}, semanticQuery: 'quiet' },
      'book something quiet',
    );
    expect(result.chosen).toBeUndefined();
    expect(result.options).toHaveLength(1);
  });

  it('chooses the result whose title the message clearly echoes', async () => {
    const result = await chooseDescribedListing(
      retrieving([rent, sale]),
      lookup,
      'book the Nile-view apartment in Zamalek',
    );
    expect(result.chosen?.card.slug).toBe('zamalek-apartment-sale');
  });

  it('offers the top three instead of guessing between equals', async () => {
    const result = await chooseDescribedListing(
      retrieving([sale, rent, villa, villa]),
      lookup,
      'book an apartment in Zamalek',
    );
    expect(result.chosen).toBeUndefined();
    expect(result.options.map(({ card }) => card.slug)).toEqual([
      'zamalek-apartment-sale',
      'zamalek-apartment-rent',
      'villa-one',
    ]);
  });

  it('offers nothing when nothing matches', async () => {
    const result = await chooseDescribedListing(retrieving([]), lookup, 'book');
    expect(result).toEqual({ options: [] });
  });
});
