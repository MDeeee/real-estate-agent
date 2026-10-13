import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Page,
  type PaginationQuery,
  pageWindow,
} from '../common/pagination.js';
import { Prisma } from '../generated/prisma/client.js';
import type { DocumentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface DocumentListItem {
  id: string;
  filename: string;
  status: DocumentStatus;
  error: string | null;
  property: { slug: string; title: string } | null;
  chunkCount: number;
  updatedAt: Date;
}

@Injectable()
export class DocumentsAdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery): Promise<Page<DocumentListItem>> {
    const [rows, total] = await Promise.all([
      this.prisma.document.findMany({
        ...pageWindow(query),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          filename: true,
          status: true,
          error: true,
          updatedAt: true,
          property: { select: { slug: true, title: true } },
          _count: { select: { chunks: true } },
        },
      }),
      this.prisma.document.count(),
    ]);
    return {
      items: rows.map(({ _count, ...row }) => ({
        ...row,
        chunkCount: _count.chunks,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Deletes a listing with its property and chunks. Only ACTIVE (CONFIRMED)
   * bookings block it: the admin cancels them first. Cancelled bookings carry
   * no live commitment, so they are removed in the same transaction.
   */
  async remove(id: string): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: { filename: true, property: { select: { id: true } } },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found.`);
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const propertyId = document.property?.id;
        if (propertyId) {
          const active = await tx.booking.count({
            where: { propertyId, status: { not: 'CANCELLED' } },
          });
          if (active > 0) {
            throw this.hasActiveBookings(document.filename, active);
          }
          await tx.booking.deleteMany({
            where: { propertyId, status: 'CANCELLED' },
          });
        }
        await tx.document.delete({ where: { id } });
      });
    } catch (error) {
      // A booking created after the count above: still refused, never half-deleted.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw this.hasActiveBookings(document.filename);
      }
      throw error;
    }
  }

  private hasActiveBookings(
    filename: string,
    count?: number,
  ): ConflictException {
    const subject =
      count === undefined ? 'active booking(s)' : `${count} active booking(s)`;
    return new ConflictException(
      `Cannot delete ${filename}: its property has ${subject}. Cancel them in Bookings first.`,
    );
  }
}
