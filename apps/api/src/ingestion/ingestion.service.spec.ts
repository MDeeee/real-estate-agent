import { createHash } from 'node:crypto';
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

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

/** The admin agreed to replace this stored version of the listing that the fixtures create. */
function approveReplacing(
  existingMarkdown: string,
  slug = 'zamalek-test-flat',
) {
  return { replacements: new Map([[slug, sha256(existingMarkdown)]]) };
}

/** Approval for the default fixture listing, as the first upload of a test stores it. */
const REPLACE_FIXTURE = approveReplacing(listingMarkdown());

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
      REPLACE_FIXTURE,
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

  describe('a slug that is already taken', () => {
    it('writes nothing and reports a conflict when the content differs and was not confirmed', async () => {
      const first = await service.ingestUpload(
        file('flat.md', listingMarkdown({ title: 'Original flat' })),
      );
      const embedCalls = embeddings.calls.length;
      const before = structuredClone([...store.documents.values()]);

      const second = await service.ingestUpload(
        file(
          'other.md',
          listingMarkdown({ title: 'A different flat', body: longBody(4) }),
        ),
      );

      expect(second).toEqual({
        filename: 'other.md',
        outcome: 'conflict',
        propertySlug: 'zamalek-test-flat',
        conflict: {
          slug: 'zamalek-test-flat',
          existingTitle: 'Original flat',
          existingFilename: 'flat.md',
          existingContentHash: sha256(
            listingMarkdown({ title: 'Original flat' }),
          ),
          existingUpdatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          newTitle: 'A different flat',
        },
      });
      expect(store.documents.size).toBe(1);
      expect([...store.documents.values()]).toEqual(
        before.map((doc) => ({ ...doc, updatedAt: expect.any(Date) })),
      );
      expect(store.chunks.get(first.documentId as string)).toHaveLength(
        first.chunks as number,
      );
      // Not even the embedding model is called for a refused file.
      expect(embeddings.calls).toHaveLength(embedCalls);
    });

    it('replaces the listing when the slug is confirmed, keeping the same document', async () => {
      const first = await service.ingestUpload(
        file('flat.md', listingMarkdown({ title: 'Original flat' })),
      );

      const second = await service.ingestUpload(
        file(
          'other.md',
          listingMarkdown({ title: 'A different flat', body: longBody(4) }),
        ),
        approveReplacing(listingMarkdown({ title: 'Original flat' })),
      );

      expect(second.outcome).toBe('updated');
      expect(second.documentId).toBe(first.documentId);
      expect(store.properties.get('zamalek-test-flat')?.title).toBe(
        'A different flat',
      );
      expect(store.chunks.get(first.documentId as string)).toHaveLength(
        second.chunks as number,
      );
    });

    it('reports unchanged, with no write, for the exact same content even without confirmation', async () => {
      const markdown = listingMarkdown();
      const first = await service.ingestUpload(file('flat.md', markdown));
      const embedCalls = embeddings.calls.length;

      const again = await service.ingestUpload(file('renamed.md', markdown));

      expect(again.outcome).toBe('unchanged');
      expect(again.documentId).toBe(first.documentId);
      expect(embeddings.calls).toHaveLength(embedCalls);
      expect(store.documents.get(first.documentId as string)?.filename).toBe(
        'flat.md',
      );
    });

    it('ignores a confirmed slug that the upload does not carry, and still creates new slugs', async () => {
      await service.ingestUpload(file('flat.md', listingMarkdown()));

      const created = await service.ingestUpload(
        file('new.md', listingMarkdown({ slug: 'brand-new-flat' })),
        {
          replacements: new Map([
            ...approveReplacing(listingMarkdown()).replacements,
            ['not-uploaded', sha256('whatever')],
          ]),
        },
      );
      const stillTaken = await service.ingestUpload(
        file(
          'clash.md',
          listingMarkdown({ title: 'Clash', body: longBody(2) }),
        ),
        approveReplacing(listingMarkdown(), 'some-other-slug'),
      );

      expect(created.outcome).toBe('created');
      expect(stillTaken.outcome).toBe('conflict');
    });

    it('reports a conflict per file, so the rest of a batch is still processed', async () => {
      await service.ingestUpload(file('flat.md', listingMarkdown()));

      const results = await Promise.all([
        service.ingestUpload(
          file('clash.md', listingMarkdown({ title: 'Clash' })),
        ),
        service.ingestUpload(
          file('fresh.md', listingMarkdown({ slug: 'fresh-flat' })),
        ),
      ]);

      expect(results.map((result) => result.outcome)).toEqual([
        'conflict',
        'created',
      ]);
    });

    it('refuses an approval of a version that is no longer stored, and reports the fresh listing', async () => {
      const first = await service.ingestUpload(
        file('flat.md', listingMarkdown({ title: 'Original flat' })),
      );
      // The admin looked at "Original flat"; someone else replaced it meanwhile.
      const approval = approveReplacing(
        listingMarkdown({ title: 'Original flat' }),
      );
      const changed = listingMarkdown({ title: 'Changed meanwhile' });
      await service.ingestUpload(file('changed.md', changed), approval);
      const embedCalls = embeddings.calls.length;

      const stale = await service.ingestUpload(
        file(
          'mine.md',
          listingMarkdown({ title: 'My edit', body: longBody(4) }),
        ),
        approval,
      );

      expect(stale.outcome).toBe('conflict');
      expect(stale.conflict).toMatchObject({
        existingTitle: 'Changed meanwhile',
        existingFilename: 'changed.md',
        existingContentHash: sha256(changed),
        newTitle: 'My edit',
      });
      expect(store.properties.get('zamalek-test-flat')?.title).toBe(
        'Changed meanwhile',
      );
      expect(store.documents.get(first.documentId as string)?.rawMarkdown).toBe(
        changed,
      );
      expect(embeddings.calls).toHaveLength(embedCalls);
    });

    it('refuses the write when the approved version changes while the upload is embedding', async () => {
      const original = listingMarkdown();
      const first = await service.ingestUpload(file('flat.md', original));
      const changed = listingMarkdown({ title: 'Changed meanwhile' });
      const embed = embeddings.embedDocuments.bind(embeddings);
      embeddings.embedDocuments = async (texts) => {
        const vectors = await embed(texts);
        // Another admin overwrites the listing while this upload is embedding.
        const stored = store.documents.get(first.documentId as string);
        if (stored) {
          stored.rawMarkdown = changed;
          stored.contentHash = sha256(changed);
          stored.filename = 'changed.md';
        }
        return vectors;
      };

      const result = await service.ingestUpload(
        file(
          'mine.md',
          listingMarkdown({ title: 'My edit', body: longBody(4) }),
        ),
        approveReplacing(original),
      );

      expect(result.outcome).toBe('conflict');
      expect(result.conflict).toMatchObject({
        existingFilename: 'changed.md',
        existingContentHash: sha256(changed),
      });
      expect(store.documents.get(first.documentId as string)?.rawMarkdown).toBe(
        changed,
      );
    });

    it('never treats a re-index of the stored document as a conflict', async () => {
      const first = await service.ingestUpload(
        file('flat.md', listingMarkdown()),
      );

      const reindexed = await service.reindex(first.documentId as string);

      expect(reindexed.outcome).toBe('updated');
    });
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

  describe('a failed re-index of a live listing', () => {
    it('keeps the indexed document, property and chunks untouched when the edit cannot be embedded', async () => {
      const original = listingMarkdown();
      const first = await service.ingestUpload(file('flat.md', original));
      const chunksBefore = store.chunks.get(first.documentId as string);

      embeddings.failure = new Error('connect ECONNREFUSED 127.0.0.1:11434');
      const edited = await service.ingestUpload(
        file(
          'flat.md',
          listingMarkdown({ title: 'Renovated flat', body: longBody(4) }),
        ),
        REPLACE_FIXTURE,
      );

      expect(edited).toMatchObject({
        outcome: 'failed',
        propertySlug: 'zamalek-test-flat',
        error:
          'Embedding service unavailable: connect ECONNREFUSED 127.0.0.1:11434',
      });
      expect(store.documents.size).toBe(1);
      expect(store.documents.get(first.documentId as string)).toMatchObject({
        status: DocumentStatus.INDEXED,
        error: null,
        rawMarkdown: original,
      });
      expect(store.properties.size).toBe(1);
      expect(store.chunks.get(first.documentId as string)).toBe(chunksBefore);
    });

    it('never marks the live document PENDING while embedding is in flight', async () => {
      const first = await service.ingestUpload(
        file('flat.md', listingMarkdown()),
      );
      const statuses: DocumentStatus[] = [];
      const embed = embeddings.embedDocuments.bind(embeddings);
      embeddings.embedDocuments = (texts) => {
        statuses.push(
          store.documents.get(first.documentId as string)
            ?.status as DocumentStatus,
        );
        return embed(texts);
      };

      await service.ingestUpload(
        file('flat.md', listingMarkdown({ body: longBody(3) })),
        REPLACE_FIXTURE,
      );

      expect(statuses).toEqual([DocumentStatus.INDEXED]);
    });

    it('keeps the listing indexed when a forced re-index cannot embed', async () => {
      const first = await service.ingestUpload(
        file('flat.md', listingMarkdown()),
      );
      embeddings.failure = new Error('down');

      const result = await service.reindex(first.documentId as string);

      expect(result.outcome).toBe('failed');
      expect(store.documents.get(first.documentId as string)?.status).toBe(
        DocumentStatus.INDEXED,
      );
      expect(store.chunks.get(first.documentId as string)).toHaveLength(
        first.chunks as number,
      );
    });

    it('rolls back to the previous version when the single write fails', async () => {
      const original = listingMarkdown();
      const first = await service.ingestUpload(file('flat.md', original));
      store.failChunkWrites = true;
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const edited = await service.ingestUpload(
        file('flat.md', listingMarkdown({ title: 'Renovated flat' })),
        REPLACE_FIXTURE,
      );

      expect(edited.outcome).toBe('failed');
      expect(edited.error).toContain('disk full');
      expect(store.documents.size).toBe(1);
      expect(store.documents.get(first.documentId as string)).toMatchObject({
        status: DocumentStatus.INDEXED,
        rawMarkdown: original,
      });
    });
  });

  describe('stale failed uploads', () => {
    async function failedUpload(name: string, content: string) {
      embeddings.failure = new Error('down');
      const result = await service.ingestUpload(file(name, content));
      embeddings.failure = undefined;
      return result;
    }

    it('are deleted when the same filename is later indexed', async () => {
      const failed = await failedUpload('flat.md', listingMarkdown());

      const fixed = await service.ingestUpload(
        file('flat.md', listingMarkdown({ title: 'Edited title' })),
      );

      expect(fixed.outcome).toBe('created');
      expect(fixed.documentId).not.toBe(failed.documentId);
      expect([...store.documents.keys()]).toEqual([fixed.documentId]);
    });

    it('are deleted when their content claims the same slug under another filename', async () => {
      const failed = await failedUpload('draft.md', listingMarkdown());

      const fixed = await service.ingestUpload(
        file('final.md', listingMarkdown({ title: 'Edited title' })),
      );

      expect(store.documents.has(failed.documentId as string)).toBe(false);
      expect(store.documents.size).toBe(1);
      expect(fixed.outcome).toBe('created');
    });

    it('of other listings are left alone', async () => {
      const other = await failedUpload(
        'other.md',
        listingMarkdown({ slug: 'other-flat' }),
      );

      await service.ingestUpload(file('flat.md', listingMarkdown()));

      expect(store.documents.has(other.documentId as string)).toBe(true);
      expect(store.documents.size).toBe(2);
    });

    it('cannot be re-indexed over the newer listing that replaced them', async () => {
      const failed = await failedUpload('flat.md', listingMarkdown());
      const newer = await service.ingestUpload(
        file('flat-v2.md', listingMarkdown({ title: 'Newer title' })),
      );
      // Recreate the legacy state in which the stale failure survived.
      store.documents.set(failed.documentId as string, {
        id: failed.documentId as string,
        filename: 'flat.md',
        rawMarkdown: listingMarkdown(),
        contentHash: 'stale-hash',
        status: DocumentStatus.FAILED,
        error: 'Embedding service unavailable: down',
        updatedAt: new Date(),
      });
      const callsBefore = embeddings.calls.length;

      const result = await service.reindex(failed.documentId as string);

      expect(result).toMatchObject({
        outcome: 'failed',
        error:
          "This upload is outdated: listing 'zamalek-test-flat' is now owned by a newer document.",
      });
      expect(embeddings.calls).toHaveLength(callsBefore);
      expect(store.properties.get('zamalek-test-flat')?.documentId).toBe(
        newer.documentId,
      );
      expect(store.documents.get(failed.documentId as string)?.status).toBe(
        DocumentStatus.FAILED,
      );
    });
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
