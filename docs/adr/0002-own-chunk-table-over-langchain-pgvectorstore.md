# 0002. Own chunk table over LangChain PGVectorStore

Date: 2026-10-12
Status: Accepted

## Context

LangChain ships a pgvector-backed vector store that manages its own table and schema. The retrieval we need is filter-first: restrict to properties matching structured filters, then rank their chunks by similarity, ideally in one SQL query. Property, Document and Booking tables are already owned by Prisma migrations.

## Decision

The `Chunk` table is defined in the Prisma schema and created by Prisma migrations, with a raw-SQL HNSW cosine index inside the migration. All pgvector SQL lives in a single `ChunkRepository` class. A thin custom LangChain retriever wraps that repository so the graph still consumes a standard retriever interface. LangChain remains in use for the markdown splitter, embeddings, chat models and the LangGraph graph itself.

## Consequences

- One migration source and one schema; chunks join to `Property` and `Document` with real foreign keys and cascading deletes.
- Filter and similarity ranking happen in a single query against our schema, instead of a vector search followed by post-filtering.
- We own a small amount of SQL that the vector store would otherwise provide, kept in one class so it is easy to test and review.
- Swapping the embedding model or dimension is an explicit migration, not a silent store re-creation.
