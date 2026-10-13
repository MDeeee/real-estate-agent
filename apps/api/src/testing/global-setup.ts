import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    integrationDatabaseUrl: string | null;
  }
}

const TEST_DATABASE_NAME = 'realestate_test';
const apiRoot = resolve(import.meta.dirname, '../..');

function loadDotEnv(): void {
  for (const file of ['.env', '../../.env']) {
    try {
      process.loadEnvFile(resolve(apiRoot, file));
    } catch {
      // Optional file; the process environment is authoritative.
    }
  }
}

function resolveTestDatabaseUrl(): string | undefined {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit) return explicit;
  const base = process.env['DATABASE_URL'];
  if (!base) return undefined;
  const url = new URL(base);
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

async function ensureDatabase(testUrl: string): Promise<void> {
  const target = new URL(testUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  const maintenance = new URL(testUrl);
  maintenance.pathname = '/postgres';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    );
    if (existing.rowCount === 0) {
      await client.query(
        `CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`,
      );
    }
  } finally {
    await client.end();
  }
}

function migrate(testUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve(
    'prisma/build/index.js',
  );
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}

export default async function setup(project: TestProject): Promise<void> {
  loadDotEnv();
  const testUrl = resolveTestDatabaseUrl();
  try {
    if (!testUrl) throw new Error('DATABASE_URL is not set');
    await ensureDatabase(testUrl);
    migrate(testUrl);
    project.provide('integrationDatabaseUrl', testUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (process.env['CI']) {
      throw new Error(`Integration test database is unavailable: ${reason}`);
    }
    console.warn(
      `[integration] Skipping database-backed tests (${reason}). Run "pnpm db:up" to enable them.`,
    );
    project.provide('integrationDatabaseUrl', null);
  }
}
