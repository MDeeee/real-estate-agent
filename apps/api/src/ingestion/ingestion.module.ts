import { Module } from '@nestjs/common';
import { ChunkRepository } from './chunk.repository.js';
import { EMBEDDINGS_PORT } from './embeddings.port.js';
import { IngestionService } from './ingestion.service.js';
import { OllamaEmbeddingsAdapter } from './ollama-embeddings.adapter.js';

@Module({
  providers: [
    ChunkRepository,
    IngestionService,
    { provide: EMBEDDINGS_PORT, useClass: OllamaEmbeddingsAdapter },
  ],
  exports: [IngestionService, ChunkRepository, EMBEDDINGS_PORT],
})
export class IngestionModule {}
