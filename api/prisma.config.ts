import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

for (const envFile of ['.env', '../.env']) {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, envFile));
  } catch {
    // File not present; fall back to the process environment.
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
