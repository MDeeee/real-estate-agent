import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CsrfHeaderGuard } from '../common/csrf-header.guard.js';
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

/** Booking ids are Prisma `cuid()` values. */
const idParamSchema = z.cuid();

@Controller('admin/bookings')
@UseGuards(AdminAuthGuard, CsrfHeaderGuard)
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

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
  ): Promise<BookingListItem> {
    return this.bookings.cancel(id);
  }
}
