import { Module } from '@nestjs/common';
import { I18nJsonLoader, I18nModule } from 'nestjs-i18n';

/**
 * The string catalogs live next to this file (`en/agent.json`, `ar/agent.json`).
 * `import.meta.dirname` is this folder in `src` (dev, evals) and in `dist`
 * (the build copies the JSON files, see `nest-cli.json`).
 *
 * The language is never resolved from the request: the agent detects it from
 * the message text and passes `lang` on every call, so there are no resolvers.
 */
@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loader: I18nJsonLoader,
      loaderOptions: { path: import.meta.dirname, watch: false },
      resolvers: [],
      disableMiddleware: true,
      logging: false,
    }),
  ],
  exports: [I18nModule],
})
export class AppI18nModule {}
