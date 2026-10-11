import type { INestApplication } from '@nestjs/common';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import {
  TEST_ADMIN_TOKEN,
  createIntegrationApp,
  resetDatabase,
} from '../testing/integration-app.js';
import { listingMarkdown, longBody } from '../testing/listing-fixtures.js';
import type {
  PropertyCard,
  PropertyDetail,
  PropertyFacets,
} from './property.dto.js';

const databaseUrl = inject('integrationDatabaseUrl');

interface PageBody {
  items: PropertyCard[];
  total: number;
  page: number;
  pageSize: number;
}

type Fields = Record<string, string | number | null>;

const LISTINGS: Record<
  string,
  { title: string; fields: Fields; body?: string }
> = {
  'laurel-villa': {
    title: 'Corner villa at Laurel Hills',
    fields: {
      type: 'villa',
      listing: 'SALE',
      price: 28_500_000,
      bedrooms: 4,
      bathrooms: 5,
      areaM2: 420,
      city: 'New Cairo',
      district: 'Golden Square',
      compound: 'Laurel Hills',
    },
    body: `## Overview\n\nA **spacious** corner villa.

${longBody(2)}`,
  },
  'laurel-apartment': {
    title: 'Three-bedroom apartment at Laurel Heights',
    fields: {
      type: 'apartment',
      listing: 'SALE',
      price: 6_000_000,
      bedrooms: 3,
      bathrooms: 2,
      areaM2: 180,
      city: 'New Cairo',
      compound: 'Laurel Heights',
    },
  },
  'zamalek-flat': {
    title: 'Furnished flat in Zamalek',
    fields: {
      type: 'apartment',
      listing: 'RENT',
      price: 55_000,
      bedrooms: 2,
      bathrooms: 2,
      areaM2: 140,
      city: 'Zamalek',
    },
  },
  'cairo-rental-villa': {
    title: 'Rental villa in New Cairo',
    fields: {
      type: 'villa',
      listing: 'RENT',
      price: 120_000,
      bedrooms: 5,
      bathrooms: 4,
      areaM2: 500,
      city: 'New Cairo',
      compound: 'Palm Gardens',
    },
  },
};

describe.skipIf(!databaseUrl)('properties API (integration)', () => {
  const embeddings = new FakeEmbeddings();
  let app: INestApplication;
  let prisma: PrismaService;
  let apiUrl: string;

  beforeAll(async () => {
    const created = await createIntegrationApp(
      databaseUrl as string,
      embeddings,
    );
    app = created.app;
    prisma = created.prisma;
    apiUrl = created.apiUrl;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function ingest(
    slug: string,
    title: string,
    fields: Fields,
    body?: string,
  ) {
    const form = new FormData();
    form.append(
      'files',
      new Blob([listingMarkdown({ slug, title, fields, body })]),
      `${slug}.md`,
    );
    const response = await fetch(`${apiUrl}/admin/documents`, {
      method: 'POST',
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
      body: form,
    });
    const [result] = (await response.json()) as { outcome: string }[];
    return result;
  }

  beforeEach(async () => {
    embeddings.failure = undefined;
    await resetDatabase(prisma);

    let day = 1;
    for (const [slug, { title, fields, body }] of Object.entries(LISTINGS)) {
      expect((await ingest(slug, title, fields, body))?.outcome).toBe(
        'created',
      );
      await prisma.property.update({
        where: { slug },
        data: { createdAt: new Date(Date.UTC(2026, 9, day++)) },
      });
    }

    await ingest('failed-reindex', 'Listing whose re-index failed', {});
    await prisma.document.updateMany({
      where: { property: { slug: 'failed-reindex' } },
      data: { status: 'FAILED', error: 'Embedding service unavailable' },
    });

    await ingest('pending-listing', 'Listing still being indexed', {});
    await prisma.document.updateMany({
      where: { property: { slug: 'pending-listing' } },
      data: { status: 'PENDING' },
    });
  });

  async function search(query = ''): Promise<PageBody> {
    const response = await fetch(`${apiUrl}/properties${query}`);
    expect(response.status).toBe(200);
    return (await response.json()) as PageBody;
  }

  const slugs = (page: PageBody) => page.items.map((item) => item.slug);

  it('is public and returns only properties of INDEXED documents', async () => {
    expect(await prisma.property.count()).toBe(6);

    const body = await search('?sort=price_asc');

    expect(body).toMatchObject({ total: 4, page: 1, pageSize: 12 });
    expect(slugs(body)).toEqual([
      'zamalek-flat',
      'cairo-rental-villa',
      'laurel-apartment',
      'laurel-villa',
    ]);
  });

  it('separates sale from rent', async () => {
    expect(slugs(await search('?listing=SALE&sort=price_asc'))).toEqual([
      'laurel-apartment',
      'laurel-villa',
    ]);
    expect(slugs(await search('?listing=RENT&sort=price_asc'))).toEqual([
      'zamalek-flat',
      'cairo-rental-villa',
    ]);
  });

  it('combines filters', async () => {
    expect(
      slugs(await search('?city=new%20cairo&bedroomsMin=4&sort=price_asc')),
    ).toEqual(['cairo-rental-villa', 'laurel-villa']);
    expect(
      slugs(await search('?city=New%20Cairo&type=villa&listing=SALE')),
    ).toEqual(['laurel-villa']);
    expect(
      slugs(await search('?listing=SALE&priceMin=5000000&priceMax=10000000')),
    ).toEqual(['laurel-apartment']);
    expect(slugs(await search('?areaMin=150&areaMax=200'))).toEqual([
      'laurel-apartment',
    ]);
    expect(slugs(await search('?bathroomsMin=5'))).toEqual(['laurel-villa']);
  });

  it('matches compound by case-insensitive substring', async () => {
    expect(slugs(await search('?compound=LAUREL&sort=price_asc'))).toEqual([
      'laurel-apartment',
      'laurel-villa',
    ]);
  });

  it('accepts the listing kind in any letter case', async () => {
    const expected = ['zamalek-flat', 'cairo-rental-villa'];
    expect(slugs(await search('?listing=rent&sort=price_asc'))).toEqual(
      expected,
    );
    expect(slugs(await search('?listing=Rent&sort=price_asc'))).toEqual(
      expected,
    );
    expect((await fetch(`${apiUrl}/properties?listing=lease`)).status).toBe(
      400,
    );
  });

  it('keeps a live listing visible, with its old content, when an edit cannot be embedded', async () => {
    embeddings.failure = new Error('embedding down');
    const edited = await ingest(
      'zamalek-flat',
      'Edited title that never lands',
      LISTINGS['zamalek-flat']?.fields as Fields,
      longBody(2),
    );
    embeddings.failure = undefined;

    expect(edited?.outcome).toBe('failed');
    const detail = await fetch(`${apiUrl}/properties/zamalek-flat`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as PropertyDetail).title).toBe(
      'Furnished flat in Zamalek',
    );
    expect(slugs(await search('?listing=RENT'))).toContain('zamalek-flat');
  });

  it('treats blank query values as absent', async () => {
    const body = await search('?city=&priceMin=&listing=');
    expect(body.total).toBe(4);
  });

  it('sorts by price, area and recency', async () => {
    expect(slugs(await search('?sort=price_desc'))).toEqual([
      'laurel-villa',
      'laurel-apartment',
      'cairo-rental-villa',
      'zamalek-flat',
    ]);
    expect(slugs(await search('?sort=area_desc'))).toEqual([
      'cairo-rental-villa',
      'laurel-villa',
      'laurel-apartment',
      'zamalek-flat',
    ]);
    expect(slugs(await search('?sort=newest'))).toEqual([
      'cairo-rental-villa',
      'zamalek-flat',
      'laurel-apartment',
      'laurel-villa',
    ]);
    expect(slugs(await search())).toEqual(slugs(await search('?sort=newest')));
  });

  it('paginates', async () => {
    const first = await search('?sort=price_asc&pageSize=3&page=1');
    const second = await search('?sort=price_asc&pageSize=3&page=2');
    const beyond = await search('?sort=price_asc&pageSize=3&page=3');

    expect(first).toMatchObject({ total: 4, page: 1, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(slugs(second)).toEqual(['laurel-villa']);
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(4);
  });

  it('returns card DTOs with numeric prices and a plain-text excerpt', async () => {
    const body = await search('?city=New%20Cairo&compound=Laurel%20Hills');
    const [card] = body.items;

    expect(card).toMatchObject({
      slug: 'laurel-villa',
      title: 'Corner villa at Laurel Hills',
      type: 'villa',
      listing: 'SALE',
      price: 28_500_000,
      currency: 'EGP',
      bedrooms: 4,
      bathrooms: 5,
      areaM2: 420,
      city: 'New Cairo',
      district: 'Golden Square',
      compound: 'Laurel Hills',
      finishing: null,
      deliveryDate: null,
    });
    expect(card?.excerpt.startsWith('A spacious corner villa.')).toBe(true);
    expect(card?.excerpt).not.toMatch(/[#*]/);
    expect(card?.excerpt.length).toBeLessThanOrEqual(181);
    expect(card).not.toHaveProperty('body');
  });

  it('rejects invalid queries with readable errors', async () => {
    const inverted = await fetch(
      `${apiUrl}/properties?priceMin=5000000&priceMax=1000`,
    );
    const body = (await inverted.json()) as { message: string };
    expect(inverted.status).toBe(400);
    expect(body.message).toContain(
      'priceMin must not be greater than priceMax',
    );

    for (const query of [
      'pageSize=51',
      'sort=cheapest',
      'colour=red',
      'type=castle',
    ]) {
      expect((await fetch(`${apiUrl}/properties?${query}`)).status, query).toBe(
        400,
      );
    }
  });

  it('reports facets for indexed properties only, with sale and rent prices apart', async () => {
    const response = await fetch(`${apiUrl}/properties/facets`);
    const facets = (await response.json()) as PropertyFacets;

    expect(response.status).toBe(200);
    expect(facets.cities).toEqual([
      { value: 'New Cairo', count: 3 },
      { value: 'Zamalek', count: 1 },
    ]);
    expect(facets.compounds).toEqual([
      { value: 'Laurel Heights', count: 1 },
      { value: 'Laurel Hills', count: 1 },
      { value: 'Palm Gardens', count: 1 },
    ]);
    expect(facets.types).toEqual([
      { value: 'apartment', count: 2 },
      { value: 'villa', count: 2 },
    ]);
    expect(facets.listings).toEqual([
      { value: 'RENT', count: 2 },
      { value: 'SALE', count: 2 },
    ]);
    expect(facets.price).toEqual({
      SALE: { min: 6_000_000, max: 28_500_000 },
      RENT: { min: 55_000, max: 120_000 },
    });
  });

  describe('facets with mixed letter case and a city filter', () => {
    async function facetsFor(query = ''): Promise<PropertyFacets> {
      const response = await fetch(`${apiUrl}/properties/facets${query}`);
      expect(response.status).toBe(200);
      return (await response.json()) as PropertyFacets;
    }

    beforeEach(async () => {
      const base = { type: 'apartment', listing: 'SALE', price: 3_000_000 };
      await ingest('sz-1', 'Beverly Hills flat', {
        ...base,
        city: 'Sheikh Zayed',
        compound: 'Beverly Hills',
      });
      await ingest('sz-2', 'Beverly hills flat two', {
        ...base,
        city: 'sheikh zayed',
        compound: 'beverly hills',
      });
      await ingest('sz-3', 'Beverly Hills flat three', {
        ...base,
        city: 'Sheikh Zayed',
        compound: 'Beverly Hills',
      });
      await ingest('nc-1', 'Lowercase New Cairo flat', {
        ...base,
        city: 'new cairo',
        compound: 'laurel hills',
      });
    });

    it('merges case variants into one entry with summed counts', async () => {
      const facets = await facetsFor();

      expect(facets.cities).toEqual([
        { value: 'New Cairo', count: 4 },
        { value: 'Sheikh Zayed', count: 3 },
        { value: 'Zamalek', count: 1 },
      ]);
      expect(facets.compounds).toEqual([
        { value: 'Beverly Hills', count: 3 },
        { value: 'Laurel Heights', count: 1 },
        { value: 'Laurel Hills', count: 2 },
        { value: 'Palm Gardens', count: 1 },
      ]);
    });

    it('narrows compounds to the selected city, case-insensitively, but keeps every city', async () => {
      const facets = await facetsFor('?city=SHEIKH%20zayed');

      expect(facets.compounds).toEqual([{ value: 'Beverly Hills', count: 3 }]);
      expect(facets.cities.map((city) => city.value)).toEqual([
        'New Cairo',
        'Sheikh Zayed',
        'Zamalek',
      ]);
    });

    it('returns no compounds for a city without listings and ignores a blank city', async () => {
      expect((await facetsFor('?city=Nowhere')).compounds).toEqual([]);
      expect((await facetsFor('?city=')).compounds).toHaveLength(4);
      expect(
        (await fetch(`${apiUrl}/properties/facets?colour=red`)).status,
      ).toBe(400);
    });
  });

  it('returns null price ranges when a listing kind has no properties', async () => {
    await resetDatabase(prisma);
    const facets = (await (
      await fetch(`${apiUrl}/properties/facets`)
    ).json()) as PropertyFacets;
    expect(facets).toEqual({
      cities: [],
      compounds: [],
      types: [],
      listings: [],
      price: { SALE: null, RENT: null },
    });
  });

  it('returns the full detail by slug', async () => {
    const response = await fetch(`${apiUrl}/properties/laurel-villa`);
    const detail = (await response.json()) as PropertyDetail;

    expect(response.status).toBe(200);
    expect(detail.slug).toBe('laurel-villa');
    expect(detail.price).toBe(28_500_000);
    expect(detail.body.startsWith('## Overview')).toBe(true);
    expect(detail.body).toContain('Section 2');
    expect(detail.body).not.toContain('slug:');
    expect(detail.excerpt.length).toBeLessThanOrEqual(181);
  });

  it('returns 404 for unknown slugs and for non-indexed documents', async () => {
    for (const slug of [
      'does-not-exist',
      'failed-reindex',
      'pending-listing',
    ]) {
      const response = await fetch(`${apiUrl}/properties/${slug}`);
      expect(response.status, slug).toBe(404);
    }
  });
});
