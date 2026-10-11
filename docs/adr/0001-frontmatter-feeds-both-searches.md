# 0001. Frontmatter feeds both searches

Date: 2026-10-12
Status: Accepted

## Context

The product compares an AI chat against a regular filter search over the same listings. If the two read from different data, any difference in results could come from the data rather than from the retrieval method, and the comparison would be meaningless. Listings arrive as markdown files that mix structured facts (price, bedrooms, city) with free-text description.

## Decision

Each `.md` file has YAML frontmatter and a markdown body. The frontmatter is validated with zod and upserted into the `Property` table; it is the single source of structured facts. The body is chunked and embedded into pgvector. The regular search filters `Property` in SQL. The AI's `retrieve` step runs the same filter query and then ranks only the matching properties by vector similarity of their chunks.

## Consequences

- Both searches always agree on structured facts; only ranking and interpretation differ.
- Structured values are never extracted from prose by the LLM at query time, so price and bedroom filters are exact.
- Authors must put every filterable fact in frontmatter; facts that appear only in the body are searchable semantically but not filterable.
- Invalid frontmatter fails ingestion for that document, with the zod error surfaced to the admin.
