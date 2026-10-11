import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ChunkRow {
  index: number;
  content: string;
  embedding: number[];
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

  countByDocument(documentId: string): Promise<number> {
    return this.prisma.chunk.count({ where: { documentId } });
  }
}
