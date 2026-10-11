# Real-estate AI agent

An AI assistant for the Egyptian property market, in Arabic and English. An admin uploads property listings as markdown files; each file's frontmatter becomes a structured record for a regular filter search, and its body is chunked and embedded for semantic retrieval. The landing page shows an AI chat (LangGraph) next to the filter search so the two can be compared on the same data. The assistant can also book a viewing directly.

> Status: milestone M0 (repo, database, schema, sample data). See [docs/PLAN.md](docs/PLAN.md) for scope and milestones.

## Stack

| Layer | Technology |
| --- | --- |
| API | NestJS, Prisma, zod |
| Database | PostgreSQL 17 with pgvector |
| AI | LangChain.js, LangGraph.js, Claude or any OpenAI-compatible model |
| Embeddings | `bge-m3` (1024 dimensions) via local Ollama |
| Web | Next.js (App Router), Tailwind CSS |

## Quick start

Requirements: Node.js 24, pnpm, Docker. Ollama with `bge-m3` is needed from milestone M1 onwards.

```bash
pnpm install
cp .env.example .env     # then set ADMIN_TOKEN
pnpm db:up               # Postgres + pgvector on localhost:5433
pnpm db:migrate
pnpm dev                 # api on :3001, web on :3000
```

Health check: `curl http://localhost:3001/api/health`

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run api and web in watch mode |
| `pnpm db:up` / `pnpm db:down` | Start / stop the database container |
| `pnpm db:migrate` | Apply Prisma migrations |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Quality gates for both apps |

To create a new migration run `pnpm --filter api db:migrate:create`. Prisma cannot model the HNSW index on `Chunk.embedding`, so it proposes dropping it: remove that `DROP INDEX` statement from the generated SQL.

## Sample data

The listings in [`samples/properties`](samples/properties) are **synthetic**. Compounds, developers, prices and contact details are invented for demonstration and do not describe real properties. For rentals, `price` is the monthly rent.

## Documentation

- [docs/PLAN.md](docs/PLAN.md): scope, AI graph design, milestones
- [docs/adr](docs/adr): architecture decision records
- [AGENTS.md](AGENTS.md): conventions for contributors and coding agents
