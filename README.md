# Real-estate AI agent

An AI assistant for the Egyptian property market, in Arabic and English. An admin uploads property listings as markdown files; each file's frontmatter becomes a structured record for a regular filter search, and its body is chunked and embedded for semantic retrieval. The landing page shows an AI chat (LangGraph) next to the filter search so the two can be compared on the same data. The assistant can also book a viewing directly.

> Status: milestone M3 (AI chat with search and booking). See [docs/PLAN.md](docs/PLAN.md) for scope and milestones.

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

## AI chat

The chat needs an LLM. The app boots without one (the filter search and admin keep working) and `POST /api/chat` answers `503 The AI assistant is not configured`. Embeddings still come from local Ollama (`bge-m3`).

### Free option: Google Gemini

1. Create a key at <https://aistudio.google.com/apikey>.
2. Put these four lines in `.env` (the key never leaves your machine; `.env` is git-ignored):

```bash
LLM_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_COMPAT_API_KEY=<your key>
OPENAI_COMPAT_MODEL=gemini-3.8-flash
```

3. Restart `pnpm dev`. The web app needs `INTERNAL_API_KEY` set to the same value as the API and `TRUSTED_PROXY_HOPS` set to your proxy count (see `.env.example` and Deployment notes) so chat rate limits count each visitor, not the web server.

Fallback if Gemini is rate limited: Groq. Same four lines with `OPENAI_COMPAT_BASE_URL=https://api.groq.com/openai/v1`, a key from <https://console.groq.com/keys> and a Groq model name.

For Claude set `LLM_PROVIDER=claude` and `ANTHROPIC_API_KEY`. If a provider rejects tool calling for structured output, try `LLM_STRUCTURED_METHOD=jsonSchema`.

### Tracing

LangSmith tracing needs no code: set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY` and optionally `LANGSMITH_PROJECT` in the API environment.

### Limits

`POST /api/chat` is limited to `CHAT_THROTTLE_LIMIT` (default 10) requests per `THROTTLE_TTL_SECONDS` per client IP, to `CHAT_GLOBAL_LIMIT_PER_MINUTE` (default 30) requests per minute across all visitors, messages to 1000 characters, request bodies to 16 KB and each turn to 60 seconds. Over a limit the API answers `429` with a friendly JSON message and a `Retry-After` header (seconds), which the web route passes through.

A turn that fails, times out or is stopped by the visitor is rolled back: the stored conversation looks as if the message had never been sent, so a retry never duplicates it. Stored history is capped at the last 20 messages per conversation.

## Deployment notes

- **Client IP and `TRUSTED_PROXY_HOPS`.** Per-visitor rate limiting needs the visitor's IP at the API. The Next.js server reads it from `x-forwarded-for` and forwards it, signed with `INTERNAL_API_KEY`, in `x-client-ip`. A visitor controls the beginning of `x-forwarded-for` (they can send any value) and every proxy appends the address it saw on the right, so only the right-hand entries added by your own proxies can be trusted. Next.js leaves a present `x-forwarded-for` untouched and does not append the connecting address (checked on Next 16.4, `next dev` and `next start`). With `TRUSTED_PROXY_HOPS=N` (the number of reverse proxies you run in front of Next, default `0`) the visitor is the entry `N` from the right: `nginx -> next` is `1`, `cdn -> nginx -> next` is `2`. With `0` nothing is trusted: no IP is forwarded and all visitors share one per-IP budget (safe, but coarse). Make your outermost proxy append the connecting address (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) and do not expose Next.js directly to the internet when `TRUSTED_PROXY_HOPS` is above `0`. `x-real-ip` is never used.
- **Global chat budget.** `CHAT_GLOBAL_LIMIT_PER_MINUTE` counts every chat request regardless of IP, so it bounds LLM spend even if the per-IP limit is bypassed or one NAT hides many visitors. Size it to your provider quota. Throttle counters are kept in memory.
- **Single API instance.** The "one reply at a time per conversation" lock and the throttle counters live in the API process. Run one API instance, or move both to shared storage (for example Redis) before scaling out; with several instances a visitor could run two turns of the same conversation at once.
- **Conversation cookie.** The conversation id is a bearer token for the stored history, so the browser never sees it: the Next route keeps it in the `chat_thread` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/api/chat`, 30 days). A missing or invalid cookie starts a new conversation, and "New chat" (`POST /api/chat/reset`) rotates it. Serve production over HTTPS so the `Secure` cookie is stored. The API logs only a short hash of the id, and the history endpoint masks phone numbers (`010****4567`).

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
