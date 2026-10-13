import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ChunkRow {
  index: number;
  content: string;
  embedding: number[];
}

export interface RankedProperty {
  propertyId: string;
  chunkContent: string;
  /** Cosine similarity of the best chunk, in [-1, 1]; higher is closer. */
  similarity: number;
}

export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

@Injectable()
export class ChunkRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async replaceForDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
    propertyId: string,
    chunks: readonly ChunkRow[],
  ): Promise<void> {
    await tx.$executeRaw`DELETE FROM "Chunk" WHERE "documentId" = ${documentId}`;
    if (chunks.length === 0) return;

    const values = chunks.map(
      (chunk) =>
        Prisma.sql`(${randomUUID()}, ${documentId}, ${propertyId}, ${chunk.index}, ${chunk.content}, ${toVectorLiteral(chunk.embedding)}::vector)`,
    );
    await tx.$executeRaw`INSERT INTO "Chunk" ("id", "documentId", "propertyId", "index", "content", "embedding") VALUES ${Prisma.join(values)}`;
  }

  /**
   * Ranks the given properties by the best (closest) of their chunks to the
   * query vector. Properties without chunks are omitted.
   */
  async rankProperties(
    propertyIds: readonly string[],
    queryVector: readonly number[],
    limit: number,
  ): Promise<RankedProperty[]> {
    if (propertyIds.length === 0 || limit <= 0) return [];
    const vector = toVectorLiteral(queryVector);
    const rows = await this.prisma.$queryRaw<
      { propertyId: string; content: string; similarity: number }[]
    >`
      SELECT "propertyId", "content", "similarity"
      FROM (
        SELECT DISTINCT ON ("propertyId")
          "propertyId",
          "content",
          1 - ("embedding" <=> ${vector}::vector) AS "similarity"
        FROM "Chunk"
        WHERE "propertyId" = ANY(${[...propertyIds]}::text[])
        ORDER BY "propertyId", "embedding" <=> ${vector}::vector
      ) AS best
      ORDER BY "similarity" DESC, "propertyId" ASC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      propertyId: row.propertyId,
      chunkContent: row.content,
      similarity: Number(row.similarity),
    }));
  }

  countByDocument(documentId: string): Promise<number> {
    return this.prisma.chunk.count({ where: { documentId } });
  }
}
