import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module.js';
import { AgentModule } from './agent/agent.module.js';
import { ClientIpThrottlerGuard } from './common/client-ip-throttler.guard.js';
import { buildThrottlerOptions } from './common/throttling.js';
import { AppConfigModule } from './config/app-config.module.js';
import type { Env } from './config/env.schema.js';
import { HealthModule } from './health/health.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PropertiesModule } from './properties/properties.module.js';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildThrottlerOptions(config),
    }),
    PrismaModule,
    HealthModule,
    IngestionModule,
    AdminModule,
    PropertiesModule,
    AgentModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
})
export class AppModule {}
