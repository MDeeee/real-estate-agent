import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Env } from '../config/env.schema.js';
import { DocumentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  propertyFrontmatterSchema,
  type PropertyFrontmatter,
} from '../properties/property-frontmatter.schema.js';
import { ChunkRepository, type ChunkRow } from './chunk.repository.js';
import { EMBEDDINGS_PORT, type EmbeddingsPort } from './embeddings.port.js';
import {
  MAX_FILE_BYTES,
  type IngestResult,
  type UploadedFile,
} from './ingestion.types.js';
import {
  contextualHeader,
  splitMarkdownBody,
  toEmbeddingInput,
} from './markdown-chunker.js';

interface IngestOptions {
  force?: boolean;
}

interface ParsedListing {
  frontmatter: PropertyFrontmatter;
  body: string;
}

interface DocumentRef {
  id: string;
}

interface DocumentWrite {
  filename: string;
  rawMarkdown: string;
  contentHash: string;
  status: DocumentStatus;
  error: string | null;
}

class EmbeddingDimensionError extends Error {}

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
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (error) {
    return { error: `Frontmatter is not valid YAML: ${errorMessage(error)}` };
  }
  const result = propertyFrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    return { error: z.prettifyError(result.error) };
  }
  return { frontmatter: result.data, body: parsed.content };
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

  async ingestUpload(file: UploadedFile): Promise<IngestResult> {
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
    return this.ingestMarkdown(filename, content);
  }

  async reindex(documentId: string): Promise<IngestResult> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { filename: true, rawMarkdown: true },
    });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found.`);
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

  private async process(
    filename: string,
    raw: string,
    { force = false }: IngestOptions,
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

    const parsed = parseListing(content);
    if ('error' in parsed) {
      const target =
        sameContent ??
        (await this.prisma.document.findFirst({
          where: { filename, status: DocumentStatus.FAILED, property: null },
          select: { id: true },
        }));
      const document = await this.saveDocument(target, {
        filename,
        rawMarkdown: content,
        contentHash,
        status: DocumentStatus.FAILED,
        error: parsed.error,
      });
      return {
        filename,
        outcome: 'failed',
        documentId: document.id,
        error: parsed.error,
      };
    }

    const { frontmatter, body } = parsed;
    const existingProperty = await this.prisma.property.findUnique({
      where: { slug: frontmatter.slug },
      select: { documentId: true },
    });
    const target: DocumentRef | null = existingProperty
      ? { id: existingProperty.documentId }
      : sameContent;

    if (sameContent && target && sameContent.id !== target.id) {
      await this.prisma.document.delete({ where: { id: sameContent.id } });
    }

    const document = await this.saveDocument(target, {
      filename,
      rawMarkdown: content,
      contentHash,
      status: DocumentStatus.PENDING,
      error: null,
    });
    const fail = (error: string): Promise<IngestResult> =>
      this.markFailed(document.id, filename, frontmatter.slug, error);

    const pieces = await splitMarkdownBody(body);
    if (pieces.length === 0) {
      return fail('The markdown body is empty; there is nothing to index.');
    }

    let rows: ChunkRow[];
    try {
      rows = await this.embedPieces(frontmatter, pieces);
    } catch (error) {
      return fail(
        error instanceof EmbeddingDimensionError
          ? error.message
          : `Embedding service unavailable: ${errorMessage(error)}`,
      );
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.document.update({
            where: { id: document.id },
            data: { status: DocumentStatus.INDEXED, error: null },
          });
          const data = toPropertyData(frontmatter);
          const property = await tx.property.upsert({
            where: { slug: frontmatter.slug },
            create: {
              ...data,
              slug: frontmatter.slug,
              documentId: document.id,
            },
            update: data,
            select: { id: true },
          });
          await this.chunks.replaceForDocument(
            tx,
            document.id,
            property.id,
            rows,
          );
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      this.logger.error(
        `Storing ${filename} failed: ${errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return fail(`Could not store the document: ${errorMessage(error)}`);
    }

    return {
      filename,
      outcome: existingProperty ? 'updated' : 'created',
      documentId: document.id,
      propertySlug: frontmatter.slug,
      chunks: rows.length,
    };
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

  private saveDocument(
    target: DocumentRef | null,
    data: DocumentWrite,
  ): Promise<DocumentRef> {
    return target
      ? this.prisma.document.update({
          where: { id: target.id },
          data,
          select: { id: true },
        })
      : this.prisma.document.create({ data, select: { id: true } });
  }

  private async markFailed(
    documentId: string,
    filename: string,
    propertySlug: string,
    error: string,
  ): Promise<IngestResult> {
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.FAILED, error },
    });
    return { filename, outcome: 'failed', documentId, propertySlug, error };
  }
}
