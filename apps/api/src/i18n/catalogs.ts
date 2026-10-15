import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { I18nTranslation } from 'nestjs-i18n';
import type { Language } from '../llm/agent-model.js';

export const LANGUAGES: readonly Language[] = ['en', 'ar'];

/** The catalogs as `{ [language]: { [namespace]: JSON } }`, read synchronously (tests). */
export function readCatalogs(
  dir: string = import.meta.dirname,
): Record<string, I18nTranslation> {
  const catalogs: Record<string, I18nTranslation> = {};
  for (const language of LANGUAGES) {
    const namespaces: I18nTranslation = {};
    for (const file of readdirSync(join(dir, language))) {
      if (!file.endsWith('.json')) continue;
      namespaces[file.slice(0, -'.json'.length)] = JSON.parse(
        readFileSync(join(dir, language, file), 'utf8'),
      ) as I18nTranslation;
    }
    catalogs[language] = namespaces;
  }
  return catalogs;
}
