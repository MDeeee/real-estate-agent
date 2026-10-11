# Plan

## Scope

### Admin dashboard

- Route `/admin`, protected by `ADMIN_TOKEN` from env, sent as a header or cookie.
- Upload one or many `.md` files.
- List documents with status (`PENDING` / `INDEXED` / `FAILED`) and the error for failed ones.
- Delete a document, re-index a document.
- List bookings.

### Ingestion

1. Parse frontmatter with `gray-matter`.
2. Validate with zod. Invalid frontmatter marks the document `FAILED` and the exact zod error is shown to the admin.
3. Upsert the `Property`.
4. Split the body with LangChain `MarkdownTextSplitter`.
5. Embed with LangChain `OllamaEmbeddings` (`bge-m3`).
6. Store chunks in pgvector.

Idempotency: re-uploading a file with the same content hash is a no-op. A changed file replaces its chunks.

### Landing page

AI chat and regular filter search, side by side.

| Panel | Behaviour |
| --- | --- |
| Chat | Streamed answers; property cards are rendered from structured results, not parsed from text |
| Filter search | city, compound, type, listing (sale/rent), price min/max, bedrooms, area |

### AI (LangGraph.js `StateGraph`)

State: `messages`, `intent`, `filters`, `candidates`, `bookingDraft`.

| Node | Responsibility |
| --- | --- |
| `route` | Structured output (zod): intent in `search \| details \| book \| off_topic`, plus reply language (`ar \| en`) |
| `extract_filters` | `withStructuredOutput(PropertyFiltersSchema)`; one retry on validation failure |
| `retrieve` | Runs the same SQL filter query as the regular search, then ranks matches by vector similarity of their chunks to the question (custom LangChain retriever over `ChunkRepository`); top 5 |
| `answer` | Grounded only in retrieved chunks; cites property ids; says "not found" instead of guessing; post-check that every cited id is in the retrieved ids |
| `book` | Structured extraction of `{ propertyId, name, phone, preferredDate }`; asks for missing fields; when complete, inserts a `Booking` (status `CONFIRMED`) and confirms |
| `refuse` | Polite off-topic refusal |

Cross-cutting:

| Concern | Approach |
| --- | --- |
| Conversation memory | `PostgresSaver` checkpointer (`@langchain/langgraph-checkpoint-postgres`), thread id per browser |
| Streaming | Graph stream exposed through an SSE endpoint |
| Guardrails | Max graph steps; document text treated as data, never instructions; input length limit; rate limit (`@nestjs/throttler`) |
| LLM | `@langchain/anthropic` (Claude, demo and evals) or `@langchain/openai` against any OpenAI-compatible base URL (Ollama, free tiers); chosen by env |
| Observability | Optional LangSmith tracing through env vars only |

### Eval

About 10 questions with expected property ids. `pnpm eval` reports the hit rate. A GitHub Actions job runs it only on manual trigger (`workflow_dispatch`) to avoid API cost.

## Milestones

| Milestone | Deliverable |
| --- | --- |
| M0 | Repo, Docker Postgres/pgvector, schema, 20 sample `.md` files |
| M1 | Admin upload and ingestion |
| M2 | Landing page and regular filter search |
| M3 | LangGraph chat (search and booking) |
| M4 | Eval, README with architecture diagram, demo GIF |

## Out of scope

- Auth and roles beyond `ADMIN_TOKEN`
- Booking approvals
- Redis and queues
- Deployment
