import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { BookingStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildPropertyWhere } from '../properties/property-where.js';

export interface CreateBookingInput {
  threadId: string;
  propertySlug: string;
  name: string;
  phone: string;
  /** Calendar date, `YYYY-MM-DD`. */
  preferredDate: string;
}

export interface BookingSummary {
  id: string;
  reference: string;
  propertySlug: string;
  propertyTitle: string;
  name: string;
  phone: string;
  preferredDate: string;
  status: BookingStatus;
}

export interface CreatedBooking {
  booking: BookingSummary;
  /** `false` when the same thread already booked this property and date (its contact details are refreshed). */
  created: boolean;
}

export class PropertyUnavailableError extends Error {
  constructor(readonly slug: string) {
    super(`Property "${slug}" is not available for booking.`);
    this.name = 'PropertyUnavailableError';
  }
}

/** The visitor's earlier booking of this property and date was cancelled by the agency. */
export class BookingCancelledError extends Error {
  constructor(readonly reference: string) {
    super(`Booking ${reference} was cancelled and cannot be re-booked.`);
    this.name = 'BookingCancelledError';
  }
}

const bookingSelect = {
  id: true,
  name: true,
  phone: true,
  preferredDate: true,
  status: true,
  property: { select: { slug: true, title: true } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

export function bookingReference(id: string): string {
  return id.slice(-8).toUpperCase();
}

function toSummary(row: BookingRow): BookingSummary {
  return {
    id: row.id,
    reference: bookingReference(row.id),
    propertySlug: row.property.slug,
    propertyTitle: row.property.title,
    name: row.name,
    phone: row.phone,
    preferredDate: row.preferredDate.toISOString().slice(0, 10),
    status: row.status,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class BookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Books a viewing straight away (status CONFIRMED, no approval step).
   * Idempotent per thread, property and date: repeating the call returns the
   * existing CONFIRMED booking, with the name and phone replaced by the new
   * values. A CANCELLED booking is never resurrected: that slot was taken back
   * by the agency, so this throws `BookingCancelledError`.
   */
  async create(input: CreateBookingInput): Promise<CreatedBooking> {
    const property = await this.prisma.property.findFirst({
      where: { ...buildPropertyWhere({}), slug: input.propertySlug },
      select: { id: true },
    });
    if (!property) throw new PropertyUnavailableError(input.propertySlug);

    const preferredDate = new Date(`${input.preferredDate}T00:00:00.000Z`);
    const key = {
      threadId_propertyId_preferredDate: {
        threadId: input.threadId,
        propertyId: property.id,
        preferredDate,
      },
    };

    const existing = await this.refreshExisting(key, input);
    if (existing) return { booking: toSummary(existing), created: false };

    try {
      const row = await this.prisma.booking.create({
        data: {
          threadId: input.threadId,
          propertyId: property.id,
          name: input.name,
          phone: input.phone,
          preferredDate,
          status: 'CONFIRMED',
        },
        select: bookingSelect,
      });
      return { booking: toSummary(row), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.refreshExisting(key, input);
      if (!raced) throw error;
      return { booking: toSummary(raced), created: false };
    }
  }

  private async refreshExisting(
    key: Prisma.BookingWhereUniqueInput,
    input: Pick<CreateBookingInput, 'name' | 'phone'>,
  ): Promise<BookingRow | null> {
    const row = await this.prisma.booking.findUnique({
      where: key,
      select: bookingSelect,
    });
    if (!row) return null;
    if (row.status === 'CANCELLED') {
      throw new BookingCancelledError(bookingReference(row.id));
    }
    if (row.name === input.name && row.phone === input.phone) return row;
    return this.prisma.booking.update({
      where: { id: row.id },
      data: { name: input.name, phone: input.phone },
      select: bookingSelect,
    });
  }
}
