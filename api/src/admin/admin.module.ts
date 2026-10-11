import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { AdminBookingsController } from './admin-bookings.controller.js';
import { AdminDocumentsController } from './admin-documents.controller.js';
import { AdminSessionController } from './admin-session.controller.js';
import { AdminTokenGuard } from './admin-token.guard.js';
import { BookingsAdminService } from './bookings-admin.service.js';
import { DocumentsAdminService } from './documents-admin.service.js';

@Module({
  imports: [IngestionModule],
  controllers: [
    AdminSessionController,
    AdminDocumentsController,
    AdminBookingsController,
  ],
  providers: [AdminTokenGuard, DocumentsAdminService, BookingsAdminService],
})
export class AdminModule {}
