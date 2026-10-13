import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  type Page,
  type PaginationQuery,
  paginationQuerySchema,
} from '../common/pagination.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import {
  type BookingListItem,
  BookingsAdminService,
} from './bookings-admin.service.js';

@Controller('admin/bookings')
@UseGuards(AdminAuthGuard)
export class AdminBookingsController {
  constructor(
    @Inject(BookingsAdminService)
    private readonly bookings: BookingsAdminService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(paginationQuerySchema))
    query: PaginationQuery,
  ): Promise<Page<BookingListItem>> {
    return this.bookings.list(query);
  }
}
