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
import { MAX_FILE_BYTES } from '../ingestion/ingestion.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import {
  TEST_ADMIN_TOKEN,
  createIntegrationApp,
  resetDatabase,
} from '../testing/integration-app.js';
import { listingMarkdown, longBody } from '../testing/listing-fixtures.js';

const databaseUrl = inject('integrationDatabaseUrl');
const TOKEN = TEST_ADMIN_TOKEN;

interface UploadResult {
  filename: string;
  outcome: string;
  documentId?: string;
  propertySlug?: string;
  chunks?: number;
  error?: string;
}

interface UploadFile {
  name: string;
  content: string;
}

describe.skipIf(!databaseUrl)('admin API (integration)', () => {
  const embeddings = new FakeEmbeddings();
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    const created = await createIntegrationApp(
      databaseUrl as string,
      embeddings,
    );
    app = created.app;
    prisma = created.prisma;
    baseUrl = `${created.apiUrl}/admin`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    embeddings.calls.length = 0;
    embeddings.failure = undefined;
    await resetDatabase(prisma);
  });

  function request(path: string, init: RequestInit = {}, token = TOKEN) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'x-admin-token': token },
    });
  }

  async function upload(files: UploadFile[], token = TOKEN) {
    const form = new FormData();
    for (const { name, content } of files) {
      form.append(
        'files',
        new Blob([content], { type: 'text/markdown' }),
        name,
      );
    }
    const response = await request(
      '/documents',
      { method: 'POST', body: form },
      token,
    );
    return {
      status: response.status,
      results: (await response.json()) as UploadResult[],
    };
  }

  async function uploadOne(file: UploadFile): Promise<UploadResult> {
    const { status, results } = await upload([file]);
    expect(status).toBe(200);
    return results[0] as UploadResult;
  }

  describe('authentication', () => {
    it('accepts the configured token on the session probe', async () => {
      const response = await request('/session');
      expect(response.status).toBe(204);
    });

    it.each([
      ['GET', '/session'],
      ['GET', '/documents'],
      ['GET', '/bookings'],
      ['POST', '/documents'],
      ['POST', '/documents/some-id/reindex'],
      ['DELETE', '/documents/some-id'],
    ])('rejects %s %s with a wrong token', async (method, path) => {
      const response = await request(path, { method }, 'wrong-token');
      expect(response.status).toBe(401);
    });

    it('rejects a request without the header', async () => {
      const response = await fetch(`${baseUrl}/documents`);
      expect(response.status).toBe(401);
    });

    it('does not parse an upload that is not authorised', async () => {
      const { status } = await upload(
        [{ name: 'flat.md', content: listingMarkdown() }],
        'wrong-token',
      );
      expect(status).toBe(401);
      expect(await prisma.document.count()).toBe(0);
    });
  });

  describe('upload and ingestion', () => {
    it('creates an INDEXED document with a property and vector chunks', async () => {
      const result = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown({ body: longBody(3) }),
      });

      expect(result).toMatchObject({
        filename: 'flat.md',
        outcome: 'created',
        propertySlug: 'zamalek-test-flat',
      });
      expect(result.chunks).toBeGreaterThan(1);

      const document = await prisma.document.findUniqueOrThrow({
        where: { id: result.documentId },
        include: { property: true },
      });
      expect(document.status).toBe('INDEXED');
      expect(document.error).toBeNull();
      expect(document.property?.title).toBe('Test flat in Zamalek');
      expect(document.property?.price.toString()).toBe('45000');

      expect(
        await prisma.chunk.count({ where: { documentId: document.id } }),
      ).toBe(result.chunks);
      const dims = await prisma.$queryRaw<
        { dims: number }[]
      >`SELECT DISTINCT vector_dims("embedding") AS dims FROM "Chunk"`;
      expect(dims).toEqual([{ dims: 1024 }]);
    });

    it('reports unchanged for the same file and does not call the embedding model', async () => {
      const file = { name: 'flat.md', content: listingMarkdown() };
      const first = await uploadOne(file);
      const callsAfterFirst = embeddings.calls.length;
      const second = await uploadOne(file);

      expect(second).toMatchObject({
        outcome: 'unchanged',
        documentId: first.documentId,
        chunks: first.chunks,
      });
      expect(embeddings.calls.length).toBe(callsAfterFirst);
    });

    it('updates the same property when the body of a known slug changes', async () => {
      const first = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown(),
      });
      const oldChunkIds = (
        await prisma.chunk.findMany({ select: { id: true } })
      ).map((chunk) => chunk.id);

      const second = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown({
          title: 'Renovated flat in Zamalek',
          body: longBody(4),
        }),
      });

      expect(second.outcome).toBe('updated');
      expect(second.documentId).toBe(first.documentId);
      expect(await prisma.property.count()).toBe(1);
      expect(await prisma.document.count()).toBe(1);
      expect((await prisma.property.findFirstOrThrow()).title).toBe(
        'Renovated flat in Zamalek',
      );

      const chunks = await prisma.chunk.findMany();
      expect(chunks).toHaveLength(second.chunks as number);
      expect(chunks.some((chunk) => oldChunkIds.includes(chunk.id))).toBe(
        false,
      );
    });

    it('stores a FAILED document with a readable error for invalid frontmatter', async () => {
      const result = await uploadOne({
        name: 'broken.md',
        content: listingMarkdown().replace('type: apartment', 'type: castle'),
      });

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('type');
      const document = await prisma.document.findUniqueOrThrow({
        where: { id: result.documentId },
      });
      expect(document.status).toBe('FAILED');
      expect(document.error).toBe(result.error);
      expect(await prisma.property.count()).toBe(0);
      expect(await prisma.chunk.count()).toBe(0);
    });

    it('ingests files independently when some of them are bad', async () => {
      const { status, results } = await upload([
        { name: 'good.md', content: listingMarkdown({ slug: 'good-flat' }) },
        { name: 'notes.txt', content: 'plain text' },
        { name: 'huge.md', content: 'x'.repeat(MAX_FILE_BYTES + 1) },
        { name: 'bad.md', content: '# no frontmatter' },
        {
          name: 'also-good.md',
          content: listingMarkdown({ slug: 'second-flat' }),
        },
      ]);

      expect(status).toBe(200);
      expect(results.map((r) => [r.filename, r.outcome])).toEqual([
        ['good.md', 'created'],
        ['notes.txt', 'failed'],
        ['huge.md', 'failed'],
        ['bad.md', 'failed'],
        ['also-good.md', 'created'],
      ]);
      expect(await prisma.property.count()).toBe(2);
    });

    it('marks the document FAILED and keeps no chunks when embedding is down', async () => {
      embeddings.failure = new Error('connect ECONNREFUSED 127.0.0.1:11434');
      const result = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown(),
      });

      expect(result.outcome).toBe('failed');
      expect(result.error).toMatch(/^Embedding service unavailable: /);
      expect(
        (
          await prisma.document.findUniqueOrThrow({
            where: { id: result.documentId },
          })
        ).status,
      ).toBe('FAILED');
      expect(await prisma.chunk.count()).toBe(0);
      expect(await prisma.property.count()).toBe(0);
    });

    it('rejects a request without files', async () => {
      const response = await request('/documents', {
        method: 'POST',
        body: new FormData(),
      });
      expect(response.status).toBe(400);
    });

    it('rejects more than 50 files in one request', async () => {
      const files = Array.from({ length: 51 }, (_, i) => ({
        name: `f${i}.md`,
        content: listingMarkdown({ slug: `flat-${i}` }),
      }));
      const form = new FormData();
      for (const { name, content } of files)
        form.append('files', new Blob([content]), name);
      const response = await request('/documents', {
        method: 'POST',
        body: form,
      });
      expect(response.status).toBe(400);
      expect(await prisma.document.count()).toBe(0);
    });
  });

  describe('listing and maintenance', () => {
    it('lists documents newest first with chunk counts and pagination', async () => {
      await uploadOne({
        name: 'a.md',
        content: listingMarkdown({ slug: 'flat-a' }),
      });
      await uploadOne({
        name: 'b.md',
        content: listingMarkdown({ slug: 'flat-b' }),
      });
      await uploadOne({ name: 'c.md', content: '# invalid' });

      const response = await request('/documents?page=1&pageSize=2');
      const body = (await response.json()) as {
        items: {
          filename: string;
          status: string;
          chunkCount: number;
          property: { slug: string } | null;
        }[];
        total: number;
        page: number;
        pageSize: number;
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(body.items.map((item) => item.filename)).toEqual(['c.md', 'b.md']);
      expect(body.items[0]).toMatchObject({ status: 'FAILED', property: null });
      expect(body.items[1]).toMatchObject({
        status: 'INDEXED',
        property: { slug: 'flat-b' },
      });
      expect(body.items[1]?.chunkCount).toBeGreaterThan(0);
    });

    it.each(['pageSize=101', 'pageSize=0', 'page=0', 'page=abc'])(
      'rejects invalid pagination (%s)',
      async (query) => {
        const response = await request(`/documents?${query}`);
        expect(response.status).toBe(400);
      },
    );

    it('re-indexes from the stored markdown and forces a re-embed', async () => {
      const first = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown(),
      });
      const callsBefore = embeddings.calls.length;

      const response = await request(`/documents/${first.documentId}/reindex`, {
        method: 'POST',
      });
      const result = (await response.json()) as UploadResult;

      expect(response.status).toBe(200);
      expect(result).toMatchObject({
        outcome: 'updated',
        documentId: first.documentId,
        chunks: first.chunks,
      });
      expect(embeddings.calls.length).toBe(callsBefore + 1);
    });

    it('returns 404 when re-indexing or deleting a missing document', async () => {
      expect(
        (await request('/documents/missing/reindex', { method: 'POST' }))
          .status,
      ).toBe(404);
      expect(
        (await request('/documents/missing', { method: 'DELETE' })).status,
      ).toBe(404);
    });

    it('deletes a document together with its property and chunks', async () => {
      const result = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown(),
      });

      const response = await request(`/documents/${result.documentId}`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(204);
      expect(await prisma.document.count()).toBe(0);
      expect(await prisma.property.count()).toBe(0);
      expect(await prisma.chunk.count()).toBe(0);
    });

    it('refuses to delete a document whose property has bookings', async () => {
      const result = await uploadOne({
        name: 'flat.md',
        content: listingMarkdown(),
      });
      const property = await prisma.property.findFirstOrThrow();
      await prisma.booking.create({
        data: {
          propertyId: property.id,
          name: 'Test Visitor',
          phone: '+20 100 000 0000',
          preferredDate: new Date('2026-12-01T10:00:00Z'),
        },
      });

      const response = await request(`/documents/${result.documentId}`, {
        method: 'DELETE',
      });
      const body = (await response.json()) as { message: string };

      expect(response.status).toBe(409);
      expect(body.message).toContain('1 booking');
      expect(await prisma.document.count()).toBe(1);
      expect(await prisma.chunk.count()).toBeGreaterThan(0);
    });
  });

  describe('bookings', () => {
    it('lists bookings newest first with the property title', async () => {
      await uploadOne({ name: 'flat.md', content: listingMarkdown() });
      const property = await prisma.property.findFirstOrThrow();
      for (const [name, createdAt] of [
        ['Older', '2026-10-01T10:00:00Z'],
        ['Newer', '2026-10-02T10:00:00Z'],
      ] as const) {
        await prisma.booking.create({
          data: {
            propertyId: property.id,
            name,
            phone: '+20 100 000 0000',
            preferredDate: new Date('2026-12-01T10:00:00Z'),
            createdAt: new Date(createdAt),
          },
        });
      }

      const response = await request('/bookings?pageSize=10');
      const body = (await response.json()) as {
        items: { name: string; property: { title: string; slug: string } }[];
        total: number;
      };

      expect(response.status).toBe(200);
      expect(body.total).toBe(2);
      expect(body.items.map((item) => item.name)).toEqual(['Newer', 'Older']);
      expect(body.items[0]?.property).toEqual({
        slug: 'zamalek-test-flat',
        title: 'Test flat in Zamalek',
      });
    });
  });
});
