import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it } from 'vitest';
import { propertyFilterShape } from '../properties/property-filters.schema.js';
import {
  bookingExtractionSchema,
  understandingSchema,
  llmFilterSchema,
} from './llm-schemas.js';

type ObjectSchema = {
  properties: Record<string, { anyOf: { type: string; enum?: string[] }[] }>;
  required: string[];
};

describe('llmFilterSchema', () => {
  const json = toJsonSchema(llmFilterSchema) as unknown as ObjectSchema;

  it('has exactly the keys of the regular search filters, all required', () => {
    const keys = Object.keys(propertyFilterShape).sort();
    expect(Object.keys(json.properties).sort()).toEqual(keys);
    expect([...json.required].sort()).toEqual(keys);
  });

  it('allows null for every field', () => {
    for (const field of Object.values(json.properties)) {
      expect(field.anyOf.map((option) => option.type)).toContain('null');
    }
  });

  it('keeps the enums of the search contract', () => {
    expect(json.properties['listing']?.anyOf.find((o) => o.enum)?.enum).toEqual(
      ['SALE', 'RENT'],
    );
    expect(json.properties['type']?.anyOf.find((o) => o.enum)?.enum).toContain(
      'villa',
    );
  });

  it('parses a model answer where unspecified filters are null', () => {
    const parsed = llmFilterSchema.parse({
      city: 'New Cairo',
      compound: null,
      district: null,
      type: 'apartment',
      listing: null,
      priceMin: null,
      priceMax: 7_000_000,
      bedroomsMin: 3,
      bathroomsMin: null,
      areaMin: null,
      areaMax: null,
    });
    expect(parsed.priceMax).toBe(7_000_000);
  });
});

describe('bookingExtractionSchema', () => {
  it('requires every key and allows null', () => {
    const json = toJsonSchema(
      bookingExtractionSchema,
    ) as unknown as ObjectSchema;
    expect([...json.required].sort()).toEqual([
      'anyTime',
      'name',
      'phone',
      'preferredDate',
      'preferredTime',
      'propertyRef',
      'timeVague',
    ]);
  });

  it('parses a time, and an explicit "any time"', () => {
    const base = {
      propertyRef: null,
      name: null,
      phone: null,
      preferredDate: '2026-10-19',
    };
    expect(
      bookingExtractionSchema.parse({
        ...base,
        preferredTime: '17:00',
        anyTime: false,
        timeVague: false,
      }),
    ).toMatchObject({ preferredTime: '17:00', anyTime: false });
    expect(
      bookingExtractionSchema.parse({
        ...base,
        preferredTime: null,
        anyTime: true,
        timeVague: false,
      }),
    ).toMatchObject({ preferredTime: null, anyTime: true });
  });
});

describe('understandingSchema', () => {
  const json = toJsonSchema(understandingSchema) as unknown as ObjectSchema;

  it('no longer asks the model for the reply language', () => {
    expect(Object.keys(json.properties)).not.toContain('language');
  });

  it('asks for the routing fields and the filters in one object, all required', () => {
    expect([...json.required].sort()).toEqual([
      'filters',
      'intent',
      'propertyRef',
      'searchMode',
      'semanticQuery',
    ]);
  });

  it('parses a non-search answer with all-null filters', () => {
    const nulls = Object.fromEntries(
      Object.keys(propertyFilterShape).map((key) => [key, null]),
    );
    expect(
      understandingSchema.parse({
        intent: 'details',
        searchMode: 'refine',
        semanticQuery: '',
        propertyRef: 'the second one',
        filters: nulls,
      }).propertyRef,
    ).toBe('the second one');
  });
});
