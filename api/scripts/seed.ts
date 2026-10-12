import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '../src/config/app-config.module.js';
import type { Env } from '../src/config/env.schema.js';
import { IngestionModule } from '../src/ingestion/ingestion.module.js';
import { IngestionService } from '../src/ingestion/ingestion.service.js';
import type { IngestResult } from '../src/ingestion/ingestion.types.js';
import { checkOllama } from '../src/ingestion/ollama-preflight.js';
import { PrismaModule } from '../src/prisma/prisma.module.js';
import { renderSeedReport, seedExitCode } from './seed-report.js';

const SAMPLES_DIR = resolve(import.meta.dirname, '../../samples/properties');

/** Just what ingestion needs: no HTTP server, no LLM, no agent graph. */
@Module({ imports: [AppConfigModule, PrismaModule, IngestionModule] })
class SeedModule {}

async function main(): Promise<number> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const config = app.get<ConfigService<Env, true>>(ConfigService);
    const ollama = await checkOllama({
      baseUrl: config.get('OLLAMA_BASE_URL', { infer: true }),
      model: config.get('EMBEDDING_MODEL', { infer: true }),
    });
    if (!ollama.ok) {
      console.error(`Seed aborted: ${ollama.message}`);
      return 1;
    }

    const files = (await readdir(SAMPLES_DIR))
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .sort();
    console.log(`Seeding ${files.length} listing(s) from ${SAMPLES_DIR}`);

    const ingestion = app.get(IngestionService);
    const results: IngestResult[] = [];
    for (const name of files) {
      const buffer = await readFile(join(SAMPLES_DIR, name));
      results.push(
        await ingestion.ingestUpload({
          originalname: name,
          size: buffer.byteLength,
          buffer,
        }),
      );
    }
    console.log(`\n${renderSeedReport(results)}`);
    return seedExitCode(results);
  } finally {
    await app.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  new Logger('Seed').error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
