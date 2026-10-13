import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AdminModule } from '../admin/admin.module.js';
import { configureApp } from '../app.setup.js';
import { validateEnv } from '../config/env.schema.js';
import { EMBEDDINGS_PORT } from '../ingestion/embeddings.port.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PropertiesModule } from '../properties/properties.module.js';
import type { FakeEmbeddings } from './fake-embeddings.js';

export const TEST_ADMIN_TOKEN = 'integration-test-admin-token-0123456789';

/** The header every state-changing request must carry (see CsrfHeaderGuard). */
export const CSRF_HEADERS = { 'x-requested-with': 'fetch' } as const;

export interface IntegrationApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  apiUrl: string;
}

export async function createIntegrationApp(
  databaseUrl: string,
  embeddings: FakeEmbeddings,
): Promise<IntegrationApp> {
  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: () =>
          validateEnv({
            DATABASE_URL: databaseUrl,
            ADMIN_TOKEN: TEST_ADMIN_TOKEN,
            // Lets a test act as a distinct client through X-Forwarded-For.
            TRUSTED_PROXY_HOPS: '1',
          }),
      }),
      PrismaModule,
      IngestionModule,
      AdminModule,
      PropertiesModule,
    ],
  })
  class TestAppModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  })
    .overrideProvider(EMBEDDINGS_PORT)
    .useValue(embeddings)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return {
    app,
    prisma: app.get(PrismaService),
    apiUrl: `${await app.getUrl()}/api`,
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE "Booking", "Chunk", "Property", "Document" CASCADE`;
}
