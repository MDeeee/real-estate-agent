import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { bookingReference } from '../bookings/bookings.service.js';
import { toCalendarDay } from '../common/calendar-day.js';
import {
  type Page,
  type PaginationQuery,
  pageWindow,
} from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { BookingStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface BookingListItem {
  id: string;
  /** The short code the visitor was given (see `bookingReference`). */
  reference: string;
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

const bookingSelect = {
  id: true,
  name: true,
  phone: true,
  preferredDate: true,
  preferredTime: true,
  status: true,
  createdAt: true,
  property: { select: { slug: true, title: true } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function toListItem({ preferredDate, ...rest }: BookingRow): BookingListItem {
  return {
    ...rest,
    reference: bookingReference(rest.id),
    preferredDate: toCalendarDay(preferredDate),
  };
}

@Injectable()
export class BookingsAdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: PaginationQuery): Promise<Page<BookingListItem>> {
    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        ...pageWindow(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: bookingSelect,
      }),
      this.prisma.booking.count(),
    ]);
    return {
      items: items.map(toListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Cancels a booking (status CANCELLED). The row stays, so the chat never
   * re-books that visitor's slot. Idempotent: an already cancelled booking is
   * returned unchanged.
   */
  async cancel(id: string): Promise<BookingListItem> {
    const existing = await this.prisma.booking.findUnique({
      where: { id },
      select: bookingSelect,
    });
    if (!existing) throw new NotFoundException(`Booking ${id} not found.`);
    if (existing.status === 'CANCELLED') return toListItem(existing);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: 'CANCELLED' },
      select: bookingSelect,
    });
    return toListItem(updated);
  }
}
