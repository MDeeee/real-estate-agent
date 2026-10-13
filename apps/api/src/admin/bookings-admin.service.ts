import { Inject, Injectable } from '@nestjs/common';
import { toCalendarDay } from '../common/calendar-day.js';
import {
  type Page,
  type PaginationQuery,
  pageWindow,
} from '../common/pagination.js';
import type { BookingStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface BookingListItem {
  id: string;
  name: string;
  phone: string;
  /** `YYYY-MM-DD`: a calendar day, not an instant. */
  preferredDate: string;
  /** `HH:mm` in the business time zone; `null` means any time. */
  preferredTime: string | null;
  status: BookingStatus;
  createdAt: Date;
  property: { slug: string; title: string };
}

@Injectable()
export class BookingsAdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery): Promise<Page<BookingListItem>> {
    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        ...pageWindow(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          phone: true,
          preferredDate: true,
          preferredTime: true,
          status: true,
          createdAt: true,
          property: { select: { slug: true, title: true } },
        },
      }),
      this.prisma.booking.count(),
    ]);
    return {
      items: items.map(({ preferredDate, ...rest }) => ({
        ...rest,
        preferredDate: toCalendarDay(preferredDate),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
