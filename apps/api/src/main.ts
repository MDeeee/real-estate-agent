import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.schema.js';
import { resolveWebDistDir, serveWebApp } from './web/serve-web-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  configureApp(app);
  serveWebApp(
    app,
    resolveWebDistDir(config.get('WEB_DIST_DIR', { infer: true })),
  );

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(`Listening on http://localhost:${port}`);
}

await bootstrap();
