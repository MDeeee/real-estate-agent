import { Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.schema.js';
import { DocumentStatus } from '../generated/prisma/enums.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import { listingMarkdown, longBody } from '../testing/listing-fixtures.js';
import type { ChunkRepository, ChunkRow } from './chunk.repository.js';
import { IngestionService } from './ingestion.service.js';
import { MAX_FILE_BYTES } from './ingestion.types.js';

interface DocRecord {
  id: string;
  filename: string;
  rawMarkdown: string;
  contentHash: string;
  status: DocumentStatus;
  error: string | null;
}

class InMemoryStore {
  documents = new Map<string, DocRecord>();
  properties = new Map<string, { id: string; documentId: string }>();
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
      create: ({ data }: { data: Omit<DocRecord, 'id'> }) => {
        const doc = { id: this.nextId('doc'), ...data };
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
        Object.assign(doc, data);
        return Promise.resolve({ id: doc.id });
      },
      delete: ({ where }: { where: { id: string } }) => {
        this.documents.delete(where.id);
        return Promise.resolve({});
      },
    },
    property: {
      findUnique: ({ where }: { where: { slug: string } }) => {
        const property = this.properties.get(where.slug);
        return Promise.resolve(
          property ? { documentId: property.documentId } : null,
        );
      },
      upsert: ({
        where,
        create,
      }: {
        where: { slug: string };
        create: { documentId: string };
      }) => {
        const record = this.properties.get(where.slug) ?? {
          id: this.nextId('prop'),
          documentId: create.documentId,
        };
        this.properties.set(where.slug, record);
        return Promise.resolve({ id: record.id });
      },
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(this.client),
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

  it('updates the same document when the slug is re-uploaded with new content', async () => {
    const first = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );
    const second = await service.ingestUpload(
      file('flat-v2.md', listingMarkdown({ body: longBody(4) })),
    );

    expect(second.outcome).toBe('updated');
    expect(second.documentId).toBe(first.documentId);
    expect(store.documents.size).toBe(1);
    expect(store.properties.size).toBe(1);
    expect(store.documents.get(first.documentId as string)?.filename).toBe(
      'flat-v2.md',
    );
    expect(store.chunks.get(first.documentId as string)).toHaveLength(
      second.chunks as number,
    );
    expect(second.chunks).toBeGreaterThan(first.chunks as number);
  });

  it('re-embeds on a forced reindex', async () => {
    const first = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );
    const reindexed = await service.reindex(first.documentId as string);

    expect(reindexed.outcome).toBe('updated');
    expect(embeddings.calls).toHaveLength(2);
  });

  it('rejects an unknown document on reindex', async () => {
    await expect(service.reindex('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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

  it('refreshes the failed document of the same filename instead of piling up rows', async () => {
    await service.ingestUpload(file('broken.md', 'no frontmatter at all'));
    await service.ingestUpload(file('broken.md', 'still none, but edited'));

    expect(store.documents.size).toBe(1);
  });

  it('leaves the indexed listing untouched when an edit has invalid frontmatter', async () => {
    const good = await service.ingestUpload(file('flat.md', listingMarkdown()));
    await service.ingestUpload(file('flat.md', 'garbage'));

    expect(store.documents.get(good.documentId as string)?.status).toBe(
      DocumentStatus.INDEXED,
    );
    expect(store.documents.size).toBe(2);
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

  it('retries a previously failed upload of identical content', async () => {
    embeddings.failure = new Error('down');
    const failed = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );
    embeddings.failure = undefined;
    const retried = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );

    expect(retried.outcome).toBe('created');
    expect(retried.documentId).toBe(failed.documentId);
    expect(store.documents.size).toBe(1);
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

  it('marks the document FAILED when storing chunks fails', async () => {
    store.failChunkWrites = true;
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const result = await service.ingestUpload(
      file('flat.md', listingMarkdown()),
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('disk full');
    expect(store.documents.get(result.documentId as string)?.status).toBe(
      DocumentStatus.FAILED,
    );
  });

  it('fails a listing whose body is empty', async () => {
    const result = await service.ingestUpload(
      file('empty.md', listingMarkdown({ body: ' ' })),
    );

    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('body is empty');
  });

  it('rejects non-markdown, oversized and non-UTF-8 files without persisting', async () => {
    const wrongType = await service.ingestUpload(
      file('listing.txt', listingMarkdown()),
    );
    const oversized = await service.ingestUpload({
      originalname: 'big.md',
      size: MAX_FILE_BYTES + 1,
      buffer: Buffer.alloc(0),
    });
    const notUtf8 = await service.ingestUpload({
      originalname: 'binary.md',
      size: 2,
      buffer: Buffer.from([0xff, 0xfe]),
    });

    expect(wrongType).toMatchObject({
      outcome: 'failed',
      error: 'Only .md files are accepted.',
    });
    expect(oversized.error).toContain('200 KB');
    expect(notUtf8.error).toContain('UTF-8');
    expect(store.documents.size).toBe(0);
  });
});
