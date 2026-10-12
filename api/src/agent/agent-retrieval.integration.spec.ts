import type { INestApplication } from '@nestjs/common';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from 'vitest';
import { ChunkRepository } from '../ingestion/chunk.repository.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { createChatIntegrationApp } from '../testing/chat-integration-app.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import { TEST_ADMIN_TOKEN, resetDatabase } from '../testing/integration-app.js';
import { listingMarkdown } from '../testing/listing-fixtures.js';
import { AgentRetrievalService } from './agent-retrieval.service.js';

const databaseUrl = inject('integrationDatabaseUrl');

const BODIES: Record<string, string> = {
  'garden-villa': '## Garden\n\nA villa with a private garden and a pool.',
  'city-flat': '## City\n\nA flat above the busy market with metro access.',
  'quiet-flat': '## Quiet\n\nA flat on a quiet street, facing a park.',
};

describe.skipIf(!databaseUrl)('listing retrieval (integration)', () => {
  const embeddings = new FakeEmbeddings();
  let app: INestApplication;
  let prisma: PrismaService;
  let apiUrl: string;

  beforeAll(async () => {
    const created = await createChatIntegrationApp(databaseUrl as string, {
      embeddings,
    });
    app = created.app;
    prisma = created.prisma;
    apiUrl = created.apiUrl;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    for (const [slug, body] of Object.entries(BODIES)) {
      const form = new FormData();
      form.append(
        'files',
        new Blob([
          listingMarkdown({
            slug,
            title: slug,
            body,
            fields: {
              city: slug === 'garden-villa' ? 'Sheikh Zayed' : 'Zamalek',
            },
          }),
        ]),
        `${slug}.md`,
      );
      await fetch(`${apiUrl}/admin/documents`, {
        method: 'POST',
        headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
        body: form,
      });
    }
  });

  /** The vector stored for a listing's first chunk, exactly as pgvector holds it. */
  async function storedVectorOf(slug: string): Promise<number[]> {
    const [row] = await prisma.$queryRaw<{ embedding: string }[]>`
      SELECT c."embedding"::text AS embedding
      FROM "Chunk" c JOIN "Property" p ON p."id" = c."propertyId"
      WHERE p."slug" = ${slug} AND c."index" = 0
    `;
    return JSON.parse(row?.embedding ?? '[]') as number[];
  }

  it('rankProperties orders properties by their best chunk and returns it', async () => {
    const repository = app.get(ChunkRepository);
    const properties = await prisma.property.findMany({
      select: { id: true, slug: true },
    });
    const idOf = (slug: string) =>
      properties.find((p) => p.slug === slug)?.id as string;

    const query = await storedVectorOf('quiet-flat');
    const ranked = await repository.rankProperties(
      properties.map((p) => p.id),
      query,
      5,
    );

    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.propertyId).toBe(idOf('quiet-flat'));
    expect(ranked[0]?.similarity).toBeCloseTo(1, 5);
    expect(ranked[0]?.chunkContent).toContain('quiet street');
    const similarities = ranked.map((r) => r.similarity);
    expect(similarities).toEqual([...similarities].sort((a, b) => b - a));
  });

  it('rankProperties only considers the given ids and honours the limit', async () => {
    const repository = app.get(ChunkRepository);
    const garden = await prisma.property.findUniqueOrThrow({
      where: { slug: 'garden-villa' },
    });
    const flat = await prisma.property.findUniqueOrThrow({
      where: { slug: 'city-flat' },
    });
    const query = await embeddings.embedQuery('anything');

    expect(await repository.rankProperties([], query, 5)).toEqual([]);
    const only = await repository.rankProperties([garden.id], query, 5);
    expect(only.map((r) => r.propertyId)).toEqual([garden.id]);
    const limited = await repository.rankProperties(
      [garden.id, flat.id],
      query,
      1,
    );
    expect(limited).toHaveLength(1);
  });

  it('retrieve filters first, then ranks within the filtered candidates', async () => {
    const retrieval = app.get(AgentRetrievalService);
    vi.spyOn(embeddings, 'embedQuery').mockResolvedValue(
      await storedVectorOf('garden-villa'),
    );
    const query = 'a villa with a private garden';

    const inZamalek = await retrieval.retrieve({ city: 'Zamalek' }, query);
    expect(inZamalek.map((r) => r.card.slug).sort()).toEqual([
      'city-flat',
      'quiet-flat',
    ]);
    expect(inZamalek.every((r) => r.similarity !== null)).toBe(true);
    expect(inZamalek[0]?.snippet.length).toBeGreaterThan(0);

    const unfiltered = await retrieval.retrieve({}, query);
    expect(unfiltered[0]?.card.slug).toBe('garden-villa');
    expect(unfiltered[0]?.similarity).toBeCloseTo(1, 5);
  });

  it('retrieve keeps the SQL order when there is no semantic query', async () => {
    const retrieval = app.get(AgentRetrievalService);
    const results = await retrieval.retrieve({}, '   ');
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.similarity === null)).toBe(true);
    expect(results[0]?.snippet).toBe(results[0]?.card.excerpt);
  });

  it('retrieve returns nothing when no listing matches the filters', async () => {
    const retrieval = app.get(AgentRetrievalService);
    expect(await retrieval.retrieve({ city: 'Atlantis' }, 'anything')).toEqual(
      [],
    );
  });
});
