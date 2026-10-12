# 0004. Filter then rank retrieval

Date: 2026-10-12
Status: Accepted

## Context

The chat must find listings with the same structured filters as the regular search, then order the matches by how well their text fits the visitor's wishes ("quiet street", "near schools"). Filters are exact (city, price, bedrooms); similarity is approximate. Approximate vector indexes (HNSW) applied first and filtered afterwards can return fewer matches than exist, or none.

## Decision

Retrieval is two steps. `PropertySearchService.search` runs the filters with the same visibility rule as the regular search (INDEXED documents only) and returns up to 50 candidates. `ChunkRepository.rankProperties` then ranks only those candidates by the cosine distance of their best chunk to the query embedding, and the top 5 go to the model. Without a semantic query the SQL order is kept.

The candidate set is exact and small for our catalogue, so ranking it is correct and cheap. Filters are never traded away for similarity.

## Consequences

- Correct by construction: every returned listing satisfies the filters; no listing is hidden by an index that returns the nearest rows before filtering.
- Candidate cap: when more than 50 listings match, the ranking only sees the 50 newest. Acceptable for the current catalogue.
- At scale, replace the two steps with a single SQL query that filters and orders by distance, using pgvector 0.8 `hnsw.iterative_scan` (`relaxed_order` or `strict_order`) so the HNSW scan keeps going until enough rows pass the filters. All vector SQL stays in `ChunkRepository`, so the change is local.
