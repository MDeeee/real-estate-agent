import { resolve } from 'node:path';
import { generateI18nTypes } from 'nestjs-i18n';

/** Regenerates `src/i18n/i18n.generated.ts` from the catalogs: `pnpm i18n:types`. */
const i18nDir = resolve(import.meta.dirname, '../src/i18n');
const result = await generateI18nTypes({
  path: i18nDir,
  watch: false,
  output: resolve(i18nDir, 'i18n.generated.ts'),
});
console.log(
  result.written ? `Wrote ${result.output}` : `${result.output} is up to date`,
);
