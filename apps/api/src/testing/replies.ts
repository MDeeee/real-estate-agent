import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';
import { BehaviorSubject } from 'rxjs';
import { type I18nOptions, I18nService } from 'nestjs-i18n';
import { AgentReplies } from '../agent/replies.js';
import { readCatalogs } from '../i18n/catalogs.js';
import type { I18nTranslations } from '../i18n/i18n.generated.js';

// The formatter the real I18nModule defaults to (a transitive dependency of nestjs-i18n).
const formatter = createRequire(
  createRequire(import.meta.url).resolve('nestjs-i18n'),
)('string-format') as I18nOptions['formatter'];

/** A real `I18nService` over the real catalogs, built without a Nest container. */
export function createTestI18n(): I18nService<I18nTranslations> {
  const translations = readCatalogs();
  const translations$ = new BehaviorSubject(translations);
  const languages$ = new BehaviorSubject(Object.keys(translations));
  return new I18nService<I18nTranslations>(
    { fallbackLanguage: 'en', formatter },
    translations$,
    languages$,
    new Logger('i18n-test'),
    [],
    languages$,
    // The service types its own subject loosely; at runtime it holds {lang: catalog}.
    translations$ as never,
  );
}

/** A real `AgentReplies` over the real catalogs. */
export function createTestReplies(): AgentReplies {
  return new AgentReplies(createTestI18n());
}
