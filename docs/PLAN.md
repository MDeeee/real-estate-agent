# Plan

## Scope

### Admin dashboard

- Route `/admin`, protected by `ADMIN_TOKEN` from env. Logging in (`POST /api/admin/session`) sets an `HttpOnly` session cookie; scripts may send the token in the `x-admin-token` header instead.
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

Idempotency: re-uploading a file with the same content hash is a no-op (`unchanged`). A listing's identity is its `slug`: a file whose slug already exists with different content is not written (`conflict`) until the admin confirms replacing it; then its chunks are replaced.

### Landing page

AI chat and regular filter search, side by side.

| Panel | Behaviour |
| --- | --- |
| Chat | Streamed answers; property cards are rendered from structured results, not parsed from text |
| Filter search | city, compound, type, listing (sale/rent), price min/max, bedrooms, area |

### AI (LangGraph.js `StateGraph`)

State: `messages`, `intent`, `language`, `filters`, `semanticQuery`, `candidates`, `bookingDraft`, `citedSlugs`, `focusSlug`.

| Node | Responsibility |
| --- | --- |
| `understand` | One structured call (zod): intent, listing reference and, for a search, the mode and `PropertyFiltersSchema` filters (ADR 0006); one retry on validation failure. The reply language (`ar \| en`) is detected from the message |
| `retrieve` | Runs the same SQL filter query as the regular search, then ranks matches by vector similarity of their best chunk to the semantic query (`ChunkRepository.rankProperties`, ADR 0004); top 5 |
| `details` | Resolves "the second one" or a title against the last results and answers from that listing's full markdown |
| `answer` | Grounded only in retrieved chunks; cites property ids; says "not found" instead of guessing; post-check that every cited id is in the retrieved ids |
| `book` | Structured extraction of `{ propertyId, name, phone, preferredDate }`; asks for missing fields; when complete, inserts a `Booking` (status `CONFIRMED`) and confirms |
| `smalltalk` / `refuse` | Short localized static replies |

Cross-cutting:

| Concern | Approach |
| --- | --- |
| Conversation memory | `PostgresSaver` checkpointer (`@langchain/langgraph-checkpoint-postgres`), thread id per browser |
| Streaming | Graph stream exposed through an SSE endpoint |
| Guardrails | Max graph steps; document text treated as data, never instructions; input length limit; rate limit (`@nestjs/throttler`) |
| LLM | `@langchain/anthropic` (Claude, demo and evals) or `@langchain/openai` against any OpenAI-compatible base URL (Ollama, free tiers); chosen by env |
| Observability | Optional LangSmith tracing through env vars only |

### Eval

13 cases over the sample listings (6 English, 4 Arabic, 3 multi-turn; one off-topic, one booking intent) run through the real graph. `pnpm eval` reports intent accuracy, filter accuracy, retrieval hit@5, exclusion, reference accuracy, groundedness and refusal correctness, and fails when a metric drops more than `EVAL_TOLERANCE` below the committed `apps/api/evals/baseline.json`. A GitHub Actions job runs it only on manual trigger (`workflow_dispatch`) to avoid API cost.

## Milestones

| Milestone | Deliverable |
| --- | --- |
| M0 | Repo, Docker Postgres/pgvector, schema, 20 sample `.md` files |
| M1 | Admin upload and ingestion |
| M2 | Landing page and regular filter search |
| M3 | LangGraph chat (search and booking). Done, see below |
| M4 | Seed command, eval suite, README with architecture diagram, demo GIF. Implemented; two items pending, see below |

## M3 delivered

- [x] `apps/api/src/llm`: `ChatModelFactory` (Claude or OpenAI-compatible, no sampling params for Claude), `AgentModel` port with a LangChain implementation, `LLM_STRUCTURED_METHOD`; the app boots without an LLM key and chat answers 503
- [x] Filter-then-rank retrieval: `ChunkRepository.rankProperties`, `AgentRetrievalService`, ADR 0004
- [x] `apps/api/src/agent`: LangGraph `StateGraph` (`understand`, `retrieve`, `answer`, `details`, `book`, `smalltalk`, `refuse`), `PostgresSaver` in schema `langgraph`, 60 s turn timeout, recursion limit 12, citation post-check
- [x] `BookingsService.create`: CONFIRMED immediately, idempotent per thread, property and date (unique index)
- [x] `POST /api/chat` (SSE) and `GET /api/chat/:threadId`, stricter per-IP throttle (`CHAT_THROTTLE_LIMIT`), one structured log line per turn
- [x] Web: `/api/chat` pass-through route, chat panel with streamed text, cards, filter chips and "Open these filters in the regular search", booking card, stop, retry, new chat, history restore; desktop two columns, mobile tabs
- [x] Tests: graph transitions with a fake model and `MemorySaver`, booking validation, citations, listing references, SSE and booking integration tests

## M4 delivered

- [x] `pnpm seed`: ingests `samples/properties` through the real `IngestionService` (Nest application context, per-file outcome table, non-zero exit on failure, idempotent, clear message when Ollama is unreachable)
- [x] `apps/api/evals`: 13 cases, runner on the real graph with an in-memory checkpointer and disabled bookings, rate-limit pacing and one retry on 429, metrics table, `latest.json`, baseline gate (`--update-baseline`, `EVAL_TOLERANCE`), skip without an LLM key (exit 1 when `CI` is set)
- [x] Pure scoring functions with unit tests (in `pnpm test`)
- [x] `.github/workflows/eval.yml`: manual only, pgvector service, Ollama + `bge-m3`, seed, eval, `latest.json` artifact
- [x] README rewritten as the repo front page (pitch, Mermaid architecture and graph diagrams, retrieval, guardrails, quick start, admin, testing, evals, deployment notes, structure, ADR index), MIT `LICENSE`
- [ ] First real eval run and committed `apps/api/evals/baseline.json` (pending an LLM key)
- [ ] Demo GIF and screenshots in `docs/media/`, embedded in the README (pending a browser session)

## Out of scope

- Auth and roles beyond `ADMIN_TOKEN`
- Booking approvals
- Redis and queues
- Deployment
