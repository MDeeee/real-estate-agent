import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseFrontmatter,
  type ParsedFrontmatter,
} from '../common/frontmatter.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma } from '../generated/prisma/client.js';
import { DocumentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatFrontmatterIssues } from '../properties/format-frontmatter-issues.js';
import {
  propertyFrontmatterSchema,
  type PropertyFrontmatter,
} from '../properties/property-frontmatter.schema.js';
import { ChunkRepository, type ChunkRow } from './chunk.repository.js';
import { EMBEDDINGS_PORT, type EmbeddingsPort } from './embeddings.port.js';
import {
  MAX_FILE_BYTES,
  type IngestConflict,
  type IngestResult,
  type UploadedFile,
  type UploadOptions,
} from './ingestion.types.js';
import {
  contextualHeader,
  splitMarkdownBody,
  toEmbeddingInput,
} from './markdown-chunker.js';

interface IngestOptions extends UploadOptions {
  /** Re-index of a stored document: never a conflict, it replaces itself. */
  force?: boolean;
}

interface ParsedListing {
  frontmatter: PropertyFrontmatter;
  body: string;
}

interface DocumentRef {
  id: string;
}

interface OwnerDocument extends DocumentRef {
  status: DocumentStatus;
}

interface Upload {
  filename: string;
  content: string;
  contentHash: string;
  sameContent: DocumentRef | null;
}

interface ListingContext {
  slug: string;
  ownerDocument: OwnerDocument | null;
  /** Set when the upload overwrites different content: the hash the admin approved. */
  approvedHash: string | null;
}

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

interface DocumentWrite {
  filename: string;
  rawMarkdown: string;
  contentHash: string;
  status: DocumentStatus;
  error: string | null;
}

class EmbeddingDimensionError extends Error {}

/** The listing changed between the conflict the admin saw and the write. */
class StaleReplacementError extends Error {
  constructor(readonly conflict: IngestConflict) {
    super('The listing changed after the replacement was approved.');
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const TRANSACTION_TIMEOUT_MS = 30_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitiseFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/\p{Cc}/gu, '').trim();
  return (cleaned || 'unnamed.md').slice(0, 255);
}

function parseListing(content: string): ParsedListing | { error: string } {
  let parsed: ParsedFrontmatter;
  try {
    parsed = parseFrontmatter(content);
  } catch (error) {
    return { error: `Frontmatter is not valid YAML: ${errorMessage(error)}` };
  }
  const result = propertyFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return { error: formatFrontmatterIssues(result.error, parsed.data) };
  }
  return { frontmatter: result.data, body: parsed.content };
}

/** The slug a stored upload claims, whether or not the rest of it is valid. */
function slugOf(markdown: string): string | undefined {
  try {
    const { slug } = parseFrontmatter(markdown).data;
    return typeof slug === 'string' ? slug : undefined;
  } catch {
    return undefined;
  }
}

function toPropertyData(frontmatter: PropertyFrontmatter) {
  return {
    title: frontmatter.title,
    type: frontmatter.type,
    listing: frontmatter.listing,
    price: frontmatter.price,
    currency: frontmatter.currency,
    bedrooms: frontmatter.bedrooms,
    bathrooms: frontmatter.bathrooms,
    areaM2: frontmatter.areaM2,
    city: frontmatter.city,
    district: frontmatter.district ?? null,
    compound: frontmatter.compound ?? null,
    deliveryDate: frontmatter.deliveryDate ?? null,
    finishing: frontmatter.finishing ?? null,
    paymentPlan: frontmatter.paymentPlan ?? null,
  };
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly embeddingDim: number;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChunkRepository) private readonly chunks: ChunkRepository,
    @Inject(EMBEDDINGS_PORT) private readonly embeddings: EmbeddingsPort,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.embeddingDim = config.get('EMBEDDING_DIM', { infer: true });
  }

  async ingestUpload(
    file: UploadedFile,
    options: UploadOptions = {},
  ): Promise<IngestResult> {
    const filename = sanitiseFilename(file.originalname);
    if (!filename.toLowerCase().endsWith('.md')) {
      return {
        filename,
        outcome: 'failed',
        error: 'Only .md files are accepted.',
      };
    }
    if (file.size > MAX_FILE_BYTES) {
      return {
        filename,
        outcome: 'failed',
        error: `File is larger than the ${MAX_FILE_BYTES / 1024} KB limit.`,
      };
    }
    let content: string;
    try {
      content = utf8.decode(file.buffer);
    } catch {
      return {
        filename,
        outcome: 'failed',
        error: 'File is not valid UTF-8 text.',
      };
    }
    return this.ingestMarkdown(filename, content, options);
  }

  async reindex(documentId: string): Promise<IngestResult> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        filename: true,
        rawMarkdown: true,
        property: { select: { id: true } },
      },
    });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found.`);
    }
    if (!document.property) {
      const slug = await this.slugOwnedByAnother(
        documentId,
        document.rawMarkdown,
      );
      if (slug) {
        return {
          filename: document.filename,
          outcome: 'failed',
          documentId,
          propertySlug: slug,
          error: `This upload is outdated: listing '${slug}' is now owned by a newer document.`,
        };
      }
    }
    return this.ingestMarkdown(document.filename, document.rawMarkdown, {
      force: true,
    });
  }

  async ingestMarkdown(
    filename: string,
    raw: string,
    options: IngestOptions = {},
  ): Promise<IngestResult> {
    try {
      return await this.process(filename, raw, options);
    } catch (error) {
      this.logger.error(
        `Ingestion of ${filename} crashed: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        filename,
        outcome: 'failed',
        error: `Unexpected ingestion error: ${errorMessage(error)}`,
      };
    }
  }

  /**
   * The slug that a document without a property claims, when a different
   * document already owns that listing. Re-indexing such a document would
   * overwrite the newer, live listing with stale content.
   */
  private async slugOwnedByAnother(
    documentId: string,
    rawMarkdown: string,
  ): Promise<string | null> {
    const slug = slugOf(rawMarkdown);
    if (!slug) return null;
    const owner = await this.prisma.property.findUnique({
      where: { slug },
      select: { documentId: true },
    });
    return owner && owner.documentId !== documentId ? slug : null;
  }

  private async process(
    filename: string,
    raw: string,
    { force = false, replacements }: IngestOptions,
  ): Promise<IngestResult> {
    const content = raw.replace(/^﻿/, '');
    const contentHash = createHash('sha256').update(content).digest('hex');

    const sameContent = await this.prisma.document.findUnique({
      where: { contentHash },
      select: {
        id: true,
        status: true,
        property: { select: { slug: true } },
      },
    });

    if (sameContent?.status === DocumentStatus.INDEXED && !force) {
      return {
        filename,
        outcome: 'unchanged',
        documentId: sameContent.id,
        propertySlug: sameContent.property?.slug,
        chunks: await this.chunks.countByDocument(sameContent.id),
      };
    }

    const upload: Upload = { filename, content, contentHash, sameContent };

    const parsed = parseListing(content);
    if ('error' in parsed) {
      return this.reject(upload, null, parsed.error);
    }

    const { frontmatter, body } = parsed;
    const { slug } = frontmatter;
    const owner = await this.findOwner(this.prisma, slug);

    // A slug is a listing's identity. Different content under a slug that is
    // taken may be an edit, or a different property that got the same slug by
    // mistake; only the admin can tell, so nothing is written until they say
    // so. The approval names the exact version they saw: a listing that
    // changed since is a conflict again, with its fresh details.
    const replacing =
      owner && !force && owner.document.contentHash !== contentHash
        ? owner
        : null;
    if (
      replacing &&
      replacements?.get(slug) !== replacing.document.contentHash
    ) {
      return {
        filename,
        outcome: 'conflict',
        propertySlug: slug,
        conflict: this.conflictOf(replacing, slug, frontmatter.title),
      };
    }

    const listing: ListingContext = {
      slug,
      ownerDocument: owner?.document ?? null,
      approvedHash: replacing?.document.contentHash ?? null,
    };

    // Everything that can fail for reasons outside the database (splitting,
    // embedding) happens before the first write, so a failed re-index never
    // changes what visitors can see.
    const pieces = await splitMarkdownBody(body);
    if (pieces.length === 0) {
      return this.reject(
        upload,
        listing,
        'The markdown body is empty; there is nothing to index.',
      );
    }

    let rows: ChunkRow[];
    try {
      rows = await this.embedPieces(frontmatter, pieces);
    } catch (error) {
      return this.reject(
        upload,
        listing,
        error instanceof EmbeddingDimensionError
          ? error.message
          : `Embedding service unavailable: ${errorMessage(error)}`,
      );
    }

    let documentId: string;
    try {
      documentId = await this.prisma.$transaction(
        (tx) => this.store(tx, upload, listing, frontmatter, rows),
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof StaleReplacementError) {
        return {
          filename,
          outcome: 'conflict',
          propertySlug: slug,
          conflict: error.conflict,
        };
      }
      this.logger.error(
        `Storing ${filename} failed: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.reject(
        upload,
        listing,
        `Could not store the document: ${errorMessage(error)}`,
      );
    }

    return {
      filename,
      outcome: listing.ownerDocument ? 'updated' : 'created',
      documentId,
      propertySlug: slug,
      chunks: rows.length,
    };
  }

  private findOwner(client: PrismaClientLike, slug: string) {
    return client.property.findUnique({
      where: { slug },
      select: {
        title: true,
        document: {
          select: {
            id: true,
            status: true,
            filename: true,
            contentHash: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  private conflictOf(
    owner: NonNullable<Awaited<ReturnType<IngestionService['findOwner']>>>,
    slug: string,
    newTitle: string,
  ): IngestConflict {
    return {
      slug,
      existingTitle: owner.title,
      existingFilename: owner.document.filename,
      existingContentHash: owner.document.contentHash,
      existingUpdatedAt: owner.document.updatedAt.toISOString(),
      newTitle,
    };
  }

  /** The single write of a successful ingest; runs inside one transaction. */
  private async store(
    tx: Prisma.TransactionClient,
    { filename, content, contentHash, sameContent }: Upload,
    { slug, ownerDocument, approvedHash }: ListingContext,
    frontmatter: PropertyFrontmatter,
    rows: ChunkRow[],
  ): Promise<string> {
    if (approvedHash !== null) {
      // The embedding above can take a while: check once more, in the same
      // transaction as the overwrite, that the approved version is still there.
      const current = await this.findOwner(tx, slug);
      if (!current) {
        throw new Error(
          'The listing was removed while the upload was running.',
        );
      }
      if (current.document.contentHash !== approvedHash) {
        throw new StaleReplacementError(
          this.conflictOf(current, slug, frontmatter.title),
        );
      }
    }
    const target: DocumentRef | null = ownerDocument ?? sameContent;
    if (sameContent && target && sameContent.id !== target.id) {
      // Its content hash is about to move to the target document.
      await tx.document.delete({ where: { id: sameContent.id } });
    }

    const data = {
      filename,
      rawMarkdown: content,
      contentHash,
      status: DocumentStatus.INDEXED,
      error: null,
    };
    const document = target
      ? await tx.document.update({
          where: { id: target.id },
          data,
          select: { id: true },
        })
      : await tx.document.create({ data, select: { id: true } });

    const propertyData = toPropertyData(frontmatter);
    const property = await tx.property.upsert({
      where: { slug },
      create: { ...propertyData, slug, documentId: document.id },
      update: propertyData,
      select: { id: true },
    });
    await this.chunks.replaceForDocument(tx, document.id, property.id, rows);
    await this.deleteStaleFailures(tx, document.id, slug, filename);
    return document.id;
  }

  /**
   * Records why an upload could not be indexed. A listing that is already
   * live (its document is INDEXED) is left exactly as it is; anything else is
   * kept as a FAILED document so the admin can see and retry it.
   */
  private async reject(
    { filename, content, contentHash, sameContent }: Upload,
    listing: ListingContext | null,
    error: string,
  ): Promise<IngestResult> {
    const propertySlug = listing?.slug;
    const owner = listing?.ownerDocument ?? null;
    if (owner?.status === DocumentStatus.INDEXED) {
      return { filename, outcome: 'failed', propertySlug, error };
    }

    const target: DocumentRef | null =
      owner ??
      sameContent ??
      (await this.prisma.document.findFirst({
        where: { filename, status: DocumentStatus.FAILED, property: null },
        select: { id: true },
      }));
    if (sameContent && target && sameContent.id !== target.id) {
      await this.prisma.document.delete({ where: { id: sameContent.id } });
    }

    const data: DocumentWrite = {
      filename,
      rawMarkdown: content,
      contentHash,
      status: DocumentStatus.FAILED,
      error,
    };
    const document = target
      ? await this.prisma.document.update({
          where: { id: target.id },
          data,
          select: { id: true },
        })
      : await this.prisma.document.create({ data, select: { id: true } });
    return {
      filename,
      outcome: 'failed',
      documentId: document.id,
      propertySlug,
      error,
    };
  }

  /**
   * A listing that has just been indexed supersedes earlier failed uploads of
   * it. Leaving them around lets a later "re-index" of a stale failure
   * overwrite the live listing, and clutters the admin list.
   */
  private async deleteStaleFailures(
    tx: Prisma.TransactionClient,
    keepDocumentId: string,
    slug: string,
    filename: string,
  ): Promise<void> {
    const candidates = await tx.document.findMany({
      where: {
        status: DocumentStatus.FAILED,
        property: null,
        id: { not: keepDocumentId },
        OR: [{ filename }, { rawMarkdown: { contains: slug } }],
      },
      select: { id: true, filename: true, rawMarkdown: true },
    });
    const staleIds = candidates
      .filter(
        (candidate) =>
          candidate.filename === filename ||
          slugOf(candidate.rawMarkdown) === slug,
      )
      .map((candidate) => candidate.id);
    if (staleIds.length > 0) {
      await tx.document.deleteMany({ where: { id: { in: staleIds } } });
    }
  }

  private async embedPieces(
    frontmatter: PropertyFrontmatter,
    pieces: string[],
  ): Promise<ChunkRow[]> {
    const header = contextualHeader(frontmatter);
    const vectors = await this.embeddings.embedDocuments(
      pieces.map((piece) => toEmbeddingInput(header, piece)),
    );
    if (vectors.length !== pieces.length) {
      throw new EmbeddingDimensionError(
        `Embedding service returned ${vectors.length} vectors for ${pieces.length} chunks.`,
      );
    }
    return pieces.map((content, index) => {
      const embedding = vectors[index] as number[];
      if (embedding.length !== this.embeddingDim) {
        throw new EmbeddingDimensionError(
          `Embedding dimension mismatch: expected ${this.embeddingDim}, received ${embedding.length}.`,
        );
      }
      return { index, content, embedding };
    });
  }
}
