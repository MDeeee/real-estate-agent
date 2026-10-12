import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from '../admin/admin.module.js';
import { AgentModule } from '../agent/agent.module.js';
import { ClientIpThrottlerGuard } from '../common/client-ip-throttler.guard.js';
import { buildThrottlerOptions } from '../common/throttling.js';
import { type Env, validateEnv } from '../config/env.schema.js';
import { EMBEDDINGS_PORT } from '../ingestion/embeddings.port.js';
import { IngestionModule } from '../ingestion/ingestion.module.js';
import { AGENT_MODEL, type AgentModel } from '../llm/agent-model.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PropertiesModule } from '../properties/properties.module.js';
import type { FakeEmbeddings } from './fake-embeddings.js';
import { TEST_ADMIN_TOKEN } from './integration-app.js';

export interface ChatIntegrationApp {
  app: INestApplication;
  prisma: PrismaService;
  apiUrl: string;
}

export interface ChatAppOptions {
  embeddings: FakeEmbeddings;
  /** Replaces the LLM; omit to run the real (unconfigured) implementation. */
  agentModel?: AgentModel;
  env?: Record<string, string>;
}

export async function createChatIntegrationApp(
  databaseUrl: string,
  { embeddings, agentModel, env = {} }: ChatAppOptions,
): Promise<ChatIntegrationApp> {
  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validate: () =>
          validateEnv({
            DATABASE_URL: databaseUrl,
            ADMIN_TOKEN: TEST_ADMIN_TOKEN,
            ...env,
          }),
      }),
      ThrottlerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<Env, true>) =>
          buildThrottlerOptions(config),
      }),
      PrismaModule,
      IngestionModule,
      AdminModule,
      PropertiesModule,
      AgentModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
  })
  class TestAppModule {}

  let builder = Test.createTestingModule({
    imports: [TestAppModule],
  })
    .overrideProvider(EMBEDDINGS_PORT)
    .useValue(embeddings);
  if (agentModel) {
    builder = builder.overrideProvider(AGENT_MODEL).useValue(agentModel);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return {
    app,
    prisma: app.get(PrismaService),
    apiUrl: `${await app.getUrl()}/api`,
  };
}
