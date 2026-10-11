import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { HealthModule } from './health/health.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    HealthModule,
    IngestionModule,
    AdminModule,
  ],
})
export class AppModule {}
