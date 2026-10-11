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

  async remove(id: string): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      select: {
        filename: true,
        property: { select: { _count: { select: { bookings: true } } } },
      },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found.`);
    }
    const bookings = document.property?._count.bookings ?? 0;
    if (bookings > 0) {
      throw this.hasBookings(document.filename, bookings);
    }
    try {
      await this.prisma.document.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw this.hasBookings(document.filename);
      }
      throw error;
    }
  }

  private hasBookings(filename: string, count?: number): ConflictException {
    const subject =
      count === undefined ? 'has bookings' : `has ${count} booking(s)`;
    return new ConflictException(
      `Cannot delete ${filename}: its property ${subject}. Cancel or remove the bookings first.`,
    );
  }
}
