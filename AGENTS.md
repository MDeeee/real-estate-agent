# AGENTS.md

Real-estate AI agent for the Egyptian market (Arabic and English). An admin uploads `.md` property files; each file's YAML frontmatter becomes a structured `Property` row (served by a regular filter search) and its markdown body is chunked, embedded and stored in pgvector. The landing page puts an AI chat (LangGraph) next to the regular filter search so the two can be compared on the same data. The agent can also book a property viewing directly, with no approval step.

## Stack

- Monorepo managed with pnpm workspaces (`api`, `web`).
- `api/`: NestJS, Prisma, PostgreSQL 17 + pgvector, zod, LangChain.js, LangGraph.js.
- `web/`: Next.js (App Router), React, Tailwind CSS.
- Embeddings: `bge-m3` via local Ollama (1024 dimensions).
- LLM: Claude (`@langchain/anthropic`) or any OpenAI-compatible endpoint (`@langchain/openai`).

## Layout

| Path | Purpose |
| --- | --- |
| `api/` | NestJS backend: ingestion, search, agent graph, bookings, admin endpoints |
| `web/` | Next.js frontend: landing page (chat + filter search) and `/admin` |
| `samples/` | Synthetic property `.md` files used for development, demos and evals |
| `docs/` | `PLAN.md`, ADRs in `docs/adr/`, agent-skill docs in `docs/agents/` |

## Commands

Run from the repo root.

| Task | Command |
| --- | --- |
| Install | `pnpm install` |
| Start database | `pnpm db:up` |
| Stop database | `pnpm db:down` |
| Apply migrations | `pnpm db:migrate` (`prisma migrate deploy`) |
| Index sample listings | `pnpm seed` (needs Ollama with `bge-m3`) |
| Evals | `pnpm eval` (needs an LLM key; `--update-baseline` records `api/evals/baseline.json`) |
| New migration | `pnpm --filter api db:migrate:create`, then delete the `DROP INDEX "Chunk_embedding_hnsw_idx"` Prisma proposes |
| Dev (api + web) | `pnpm dev` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |

## Conventions

- TypeScript strict everywhere. zod validates every boundary: environment, HTTP input, frontmatter, LLM structured output.
- All pgvector SQL lives in one repository class in the api, `ChunkRepository`. Prisma is used for everything else.
- The LLM provider is swappable via env (`LLM_PROVIDER=claude|openai-compatible`). Do not send `temperature` to Claude models: Claude 5.5 models reject non-default sampling.
- Embeddings use `bge-m3` through local Ollama, 1024 dimensions. Changing the model or dimension requires a migration.
- Sample data is synthetic and the README says so. Never add real listings, names or phone numbers.
- No secrets are committed. `.env.example` documents every variable.

## Agent skills

### Issue tracker

GitHub Issues on this public repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
