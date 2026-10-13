import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../config/env.schema.js';
import { DocumentStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import { listingMarkdown } from '../testing/listing-fixtures.js';
import type { ChunkRepository, ChunkRow } from './chunk.repository.js';
import { IngestionService } from './ingestion.service.js';

interface DocRecord {
  id: string;
  filename: string;
  rawMarkdown: string;
  contentHash: string;
  status: DocumentStatus;
  error: string | null;
  updatedAt: Date;
}

class InMemoryStore {
  documents = new Map<string, DocRecord>();
  properties = new Map<
    string,
    { id: string; documentId: string; title: string }
  >();
  chunks = new Map<string, ChunkRow[]>();
  failChunkWrites = false;
  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  private slugOf(documentId: string): string | undefined {
    for (const [slug, property] of this.properties) {
      if (property.documentId === documentId) return slug;
    }
    return undefined;
  }

  private remove(documentId: string): void {
    this.documents.delete(documentId);
    this.chunks.delete(documentId);
    for (const [slug, property] of this.properties) {
      if (property.documentId === documentId) this.properties.delete(slug);
    }
  }

  readonly client = {
    document: {
      findUnique: ({
        where,
      }: {
        where: { id?: string; contentHash?: string };
      }) => {
        const doc = [...this.documents.values()].find((candidate) =>
          where.id !== undefined
            ? candidate.id === where.id
            : candidate.contentHash === where.contentHash,
        );
        if (!doc) return Promise.resolve(null);
        const slug = this.slugOf(doc.id);
        return Promise.resolve({
          ...doc,
          property: slug ? { slug } : null,
        });
      },
      findFirst: ({
        where,
      }: {
        where: { filename: string; status: DocumentStatus };
      }) =>
        Promise.resolve(
          [...this.documents.values()].find(
            (doc) =>
              doc.filename === where.filename &&
              doc.status === where.status &&
              !this.slugOf(doc.id),
          ) ?? null,
        ),
      create: ({ data }: { data: Omit<DocRecord, 'id' | 'updatedAt'> }) => {
        const doc = { id: this.nextId('doc'), ...data, updatedAt: new Date() };
        this.documents.set(doc.id, doc);
        return Promise.resolve({ id: doc.id });
      },
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<DocRecord>;
      }) => {
        const doc = this.documents.get(where.id) as DocRecord;
        Object.assign(doc, data, { updatedAt: new Date() });
        return Promise.resolve({ id: doc.id });
      },
      findMany: ({
        where,
      }: {
        where: {
          status: DocumentStatus;
          id: { not: string };
          OR: [{ filename: string }, { rawMarkdown: { contains: string } }];
        };
      }) => {
        const [byName, byContent] = where.OR;
        return Promise.resolve(
          [...this.documents.values()].filter(
            (doc) =>
              doc.status === where.status &&
              !this.slugOf(doc.id) &&
              doc.id !== where.id.not &&
              (doc.filename === byName.filename ||
                doc.rawMarkdown.includes(byContent.rawMarkdown.contains)),
          ),
        );
      },
      delete: ({ where }: { where: { id: string } }) => {
        this.remove(where.id);
        return Promise.resolve({});
      },
      deleteMany: ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) this.remove(id);
        return Promise.resolve({ count: where.id.in.length });
      },
    },
    property: {
      findUnique: ({ where }: { where: { slug: string } }) => {
        const property = this.properties.get(where.slug);
        const document = property
          ? this.documents.get(property.documentId)
          : undefined;
        return Promise.resolve(
          property && document
            ? {
                documentId: property.documentId,
                title: property.title,
                document: {
                  id: document.id,
                  status: document.status,
                  filename: document.filename,
                  contentHash: document.contentHash,
                  updatedAt: document.updatedAt,
                },
              }
            : null,
        );
      },
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { slug: string };
        create: { documentId: string; title: string };
        update: { title: string };
      }) => {
        const existing = this.properties.get(where.slug);
        const record = existing
          ? { ...existing, title: update.title }
          : {
              id: this.nextId('prop'),
              documentId: create.documentId,
              title: create.title,
            };
        this.properties.set(where.slug, record);
        return Promise.resolve({ id: record.id });
      },
    },
    // Mirrors a database transaction: a failure rolls every write back.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = {
        documents: new Map(
          [...this.documents].map(([id, doc]) => [id, { ...doc }]),
        ),
        properties: new Map(
          [...this.properties].map(([slug, property]) => [
            slug,
            { ...property },
          ]),
        ),
        chunks: new Map(this.chunks),
      };
      try {
        return await fn(this.client);
      } catch (error) {
        this.documents = snapshot.documents;
        this.properties = snapshot.properties;
        this.chunks = snapshot.chunks;
        throw error;
      }
    },
  };

  readonly chunkRepository = {
    replaceForDocument: (
      _tx: unknown,
      documentId: string,
      _propertyId: string,
      rows: ChunkRow[],
    ) => {
      if (this.failChunkWrites) return Promise.reject(new Error('disk full'));
      this.chunks.set(documentId, rows);
      return Promise.resolve();
    },
    countByDocument: (documentId: string) =>
      Promise.resolve(this.chunks.get(documentId)?.length ?? 0),
  };
}

const config = { get: () => 1024 } as unknown as ConfigService<Env, true>;

function file(name: string, content: string) {
  return {
    originalname: name,
    size: Buffer.byteLength(content),
    buffer: Buffer.from(content),
  };
}

describe('IngestionService', () => {
  let store: InMemoryStore;
  let embeddings: FakeEmbeddings;
  let service: IngestionService;

  beforeEach(() => {
    store = new InMemoryStore();
    embeddings = new FakeEmbeddings();
    service = new IngestionService(
      store.client as unknown as PrismaService,
      store.chunkRepository as unknown as ChunkRepository,
      embeddings,
      config,
    );
  });

  it('creates a property and indexed chunks for a new listing', async () => {
    const result = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );

    expect(result).toMatchObject({
      filename: 'flat.md',
      outcome: 'created',
      propertySlug: 'zamalek-test-flat',
    });
    expect(result.chunks).toBeGreaterThan(0);
    expect(store.documents.get(result.documentId as string)?.status).toBe(
      DocumentStatus.INDEXED,
    );
    expect(store.chunks.get(result.documentId as string)).toHaveLength(
      result.chunks as number,
    );
  });

  it('embeds each chunk with the contextual header but stores the raw chunk', async () => {
    const result = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );

    const inputs = embeddings.calls[0] as string[];
    expect(inputs[0]).toMatch(
      /^Test flat in Zamalek \| apartment for rent \| 26th of July Street, Zamalek\n\n## Location/,
    );
    const stored = store.chunks.get(result.documentId as string) as ChunkRow[];
    expect(stored[0]?.content.startsWith('## Location')).toBe(true);
    expect(stored[0]?.embedding).toHaveLength(1024);
  });

  it('reports unchanged and does not re-embed identical content', async () => {
    const markdown = listingMarkdown();
    const first = await service.ingestUpload(file('flat.md', markdown));
    const second = await service.ingestUpload(file('flat.md', markdown));

    expect(second).toMatchObject({
      outcome: 'unchanged',
      documentId: first.documentId,
      chunks: first.chunks,
    });
    expect(embeddings.calls).toHaveLength(1);
  });

  it('stores a FAILED document with the zod message for invalid frontmatter', async () => {
    const broken = listingMarkdown().replace('bedrooms: 2', 'bedrooms: many');
    const result = await service.ingestUpload(file('broken.md', broken));

    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('bedrooms');
    expect(embeddings.calls).toHaveLength(0);
    const document = store.documents.get(result.documentId as string);
    expect(document?.status).toBe(DocumentStatus.FAILED);
    expect(document?.error).toBe(result.error);
    expect(store.properties.size).toBe(0);
  });

  it('marks the document FAILED without chunks when embedding is unavailable', async () => {
    embeddings.failure = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    const result = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toBe(
      'Embedding service unavailable: connect ECONNREFUSED 127.0.0.1:11434',
    );
    expect(store.documents.get(result.documentId as string)?.status).toBe(
      DocumentStatus.FAILED,
    );
    expect(store.chunks.size).toBe(0);
    expect(store.properties.size).toBe(0);
  });

  it('fails when a vector does not have the configured dimension', async () => {
    embeddings.dimension = 768;
    const result = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toBe(
      'Embedding dimension mismatch: expected 1024, received 768.',
    );
    expect(store.chunks.size).toBe(0);
  });

  it('fails a listing whose body is empty', async () => {
    const result = await service.ingestUpload(
      file('empty.md', listingMarkdown({ body: ' ' })),
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('body is empty');
  });

  it('reports the same YAML error every time the same broken content is uploaded', async () => {
    const broken = '---\nslug: [unclosed\ntitle: "x\n---\n\nbody\n';

    const first = await service.ingestUpload(file('yaml-a.md', broken));
    const second = await service.ingestUpload(file('yaml-b.md', broken));

    expect(first.error).toMatch(/^Frontmatter is not valid YAML: /);
    expect(second.error).toBe(first.error);
  });

  it('lists each frontmatter problem on its own line as "<field>: <message>"', async () => {
    const invalid = listingMarkdown({
      fields: { city: null, price: 0, bedrooms: 'many', type: 'castle' },
    });

    const result = await service.ingestUpload(file('bad.md', invalid));

    const lines = (result.error as string).split('\n');
    expect(lines).toContain('city: required');
    expect(lines).toContain('price: must be greater than 0');
    expect(lines).toContain('bedrooms: must be a number');
    expect(lines.some((line) => line.startsWith('type: must be one of'))).toBe(
      true,
    );
    expect(result.error).not.toContain('→');
  });
});
