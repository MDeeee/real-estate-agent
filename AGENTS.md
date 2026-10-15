# AGENTS.md

Real-estate AI agent for the Egyptian market (Arabic and English). An admin uploads `.md` property files; each file's YAML frontmatter becomes a structured `Property` row (served by a regular filter search) and its markdown body is chunked, embedded and stored in pgvector. The landing page puts an AI chat (LangGraph) next to the regular filter search so the two can be compared on the same data. The agent can also book a property viewing directly, with no approval step.

## Stack

- Monorepo managed with pnpm workspaces (`apps/api`, `apps/web`).
- `apps/api/`: NestJS, Prisma, PostgreSQL 17 + pgvector, zod, LangChain.js, LangGraph.js. It also serves the built web app.
- `apps/web/`: Vite + React single-page app, React Router, TanStack Query, Tailwind CSS 4, zod. One origin with the API, no server-side rendering ([ADR 0005](docs/adr/0005-vite-spa-served-by-nest-over-nextjs.md)).
- Embeddings: `bge-m3` via local Ollama (1024 dimensions).
- LLM: Claude (`@langchain/anthropic`) or any OpenAI-compatible endpoint (`@langchain/openai`).

## Layout

| Path | Purpose |
| --- | --- |
| `apps/api/` | NestJS backend: ingestion, search, agent graph, bookings, admin endpoints; serves `apps/web/dist` at `/` |
| `apps/api/src/i18n/` | String catalogs `en/agent.json` and `ar/agent.json` (nestjs-i18n, [ADR 0007](docs/adr/0007-i18n-with-nestjs-i18n.md)) and the generated key types; edit a catalog, then `pnpm --filter ./apps/api i18n:types`. Agent replies go through `AgentReplies` (`agent/replies.ts`) with an explicit `lang` |
| `apps/web/` | Vite + React frontend: landing page (chat + filter search) and `/admin`. `src/app` (router, layouts), `src/features/{search,chat,admin}`, `src/shared` (HTTP client, UI, helpers) |
| `contracts/` | Fixtures replayed by both the api and web tests (citation grammar) |
| `samples/` | Synthetic property `.md` files used for development, demos and evals |
| `docs/` | `PLAN.md`, ADRs in `docs/adr/`, agent-skill docs in `docs/agents/`, README media list in `docs/media/` |

## Commands

Run from the repo root.

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Start database | `pnpm db:up` |
| Stop database | `pnpm db:down` |
| Apply migrations | `pnpm db:migrate` (`prisma migrate deploy`) |
| Index sample listings | `pnpm seed` (needs Ollama with `bge-m3`) |
| Evals | `pnpm eval` (needs an LLM key and uses quota; `--update-baseline` records `apps/api/evals/baseline.json`) |
| New migration | `pnpm db:migrate:create`, then delete the `DROP INDEX "Chunk_embedding_hnsw_idx"` Prisma proposes |
| Dev (api + web) | `pnpm dev`: API on `PORT` (3001), Vite on 3000 proxying `/api` |
| Build | `pnpm build` (web, then api) |
| Run built app | `pnpm start`: NestJS serves the SPA and the API on `PORT` |
| Test | `pnpm test` (Vitest in both apps; unit tests cover the AI pipeline only, app plumbing is covered by typecheck, lint, build and the evals) |
| Lint | `pnpm lint` (oxlint in api, ESLint in web) |
| Typecheck | `pnpm typecheck` |

## Conventions

- TypeScript strict everywhere. zod validates every boundary: environment, HTTP input, frontmatter, LLM structured output.
- All pgvector SQL lives in one repository class in the api, `ChunkRepository`. Prisma is used for everything else.
- The LLM provider is swappable via env (`LLM_PROVIDER=claude|openai-compatible`). Do not send `temperature` to Claude models: Claude 5.5 models reject non-default sampling.
- The agent graph is `understand` then `retrieve` then `answer` (or `details`, `book`, `smalltalk`, `refuse`), then `trim`. `understand` is ONE structured LLM call for the intent, the listing reference and the search filters ([ADR 0006](docs/adr/0006-one-llm-call-to-understand-a-turn.md)); do not split it again. LLM calls fail fast: `LLM_MAX_RETRIES` and `LLM_CALL_TIMEOUT_MS`, and a busy provider (429, 503, timeout) ends the turn with the `provider_busy` error event, and a permanent quota, billing or API-key failure with `provider_unavailable`. A NEW search never keeps a filter or preference copied from the previous search unless the latest message restates it (`new-search-guard.ts`), and a message-text ordinal ("the second one") only fills a missing listing reference, never during a booking in progress.
- Embeddings use `bge-m3` through local Ollama, 1024 dimensions. Changing the model or dimension requires a migration.
- Sample data is synthetic and the README says so. Never add real listings, names or phone numbers.
- No secrets are committed. `.env.example` documents every variable.
- One origin. The SPA calls the API at `/api/...` with relative URLs; there is no CORS configuration and no backend-for-frontend. Keep it that way: cookies and the CSRF header rely on it.
- Cookies are set by the API only, `HttpOnly`: `chat_thread` (conversation id, `SameSite=Lax`, path `/api/chat`) and `admin_session` (signed, expiring, `SameSite=Strict`, path `/api/admin`). The chat thread id never appears in a URL or body.
- Every state-changing chat and admin request needs `X-Requested-With: fetch` (`CsrfHeaderGuard`); the web `apiFetch` adds it. Put the guard on any new mutating controller.
- Rate limits use `request.ip`; `TRUSTED_PROXY_HOPS` (Express `trust proxy`) decides whether `X-Forwarded-For` counts. Never read client-supplied IP headers yourself.
- Web layout: a feature owns its components, API calls (zod-parsed through `shared/api/http.ts`) and hooks; features do not import each other (shared domain types live in `shared/domain`). Server state goes through TanStack Query, the URL holds search state.
- Ingestion never silently overwrites: a listing's identity is its frontmatter `slug`. A file whose slug exists with different content is not written; the per-file result is `conflict` (with the existing title, filename, update time and `existingContentHash`). The admin approves through the repeated multipart field `replacements`, each a JSON `{slug, existingContentHash}` naming the exact stored version they saw (at most 10); only a matching approval updates the listing, a stale one is a `conflict` again with the fresh details. An approved listing is updated (bookings stay linked, chunks are replaced in one transaction). Identical content is `unchanged`. Results are always per file.
- Deleting a listing is blocked only by its ACTIVE (CONFIRMED) bookings (`409`: "Cancel them in Bookings first."); when only CANCELLED bookings remain they are deleted with the listing in the same transaction. The admin cancels a booking with `POST /api/admin/bookings/:id/cancel` (idempotent). The row stays, so the chat never re-books a cancelled slot (`BookingCancelledError`).

## Agent skills

### Issue tracker

GitHub Issues on this public repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
