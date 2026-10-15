# 0007. i18n with nestjs-i18n catalogs and Intl

Date: 2026-10-15
Status: Accepted

## Context

The agent answers in the visitor's language (English or Arabic), detected from each message in code, not from an `Accept-Language` header or cookie. The strings it says without the LLM (smalltalk, refusal, booking questions and confirmation, provider errors) lived in `agent/replies.ts` as `Record<Language, string>` pairs picked with a hand-written `pick()`, with a hand-written list joiner and ISO dates pasted into sentences. Arabic needs plural forms ("day", "two days", "3 days", "11 days") that a pair of strings cannot express.

## Decision

- One string catalog per language in `apps/api/src/i18n/{en,ar}/agent.json`, served by `nestjs-i18n` (10.8.5, CommonJS, works with NestJS 12). The module has no resolvers; every call passes `lang` explicitly (`AgentReplies`, an injectable wrapper over `I18nService`, passed to the graph nodes through `AgentGraphDeps`).
- Keys are type-checked by the generated `src/i18n/i18n.generated.ts` (committed; regenerate with `pnpm --filter ./apps/api i18n:types` after editing a catalog). nestjs-i18n types the keys, not the `{placeholders}`. The generator merges languages, so a unit test checks that `en` and `ar` have the same keys.
- Plurals use nestjs-i18n's plural objects (`zero/one/two/few/many/other` chosen by `Intl.PluralRules` for the language and the `count` argument).
- Lists use `Intl.ListFormat` and dates use `Intl.DateTimeFormat` (`en-GB`, `ar-EG-u-nu-latn`, Latin digits to match times and phone numbers). A booking date is a calendar date: it is built as UTC and formatted with `timeZone: 'UTC'` so it never shifts a day.
- The JSON files are copied to `dist/i18n` by `nest-cli.json` assets, and the path is `import.meta.dirname`, so `pnpm dev`, `pnpm start` and `pnpm eval` (tsx) all find them.

## Alternatives

- Keep the hand-rolled `Record<Language, string>`: no dependency, but no plural forms, no key checking across languages and string edits mixed with code.
- Typed per-locale TypeScript catalogs plus the same Intl helpers: full type safety including arguments and no runtime file loading, but translators edit code and it is not the standard NestJS approach.

## Consequences

- One more dependency (and its peers `class-validator`, `class-transformer`). The Arabic list and date wording changed slightly (Intl output); other replies are word for word the same.
- A new language means a new folder, an entry in `Language` and `LOCALE`; the evals' refusal check compares against `AgentReplies.refusal` of each language.

- User-supplied values (name, phone, titles, reference) never go through the template engine, which would interpret `$t(...)` in them: the catalog gets a private placeholder and the value is substituted after translation.
