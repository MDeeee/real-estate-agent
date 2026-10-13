import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaEmbeddings } from '@langchain/ollama';
import type { Env } from '../config/env.schema.js';
import type { EmbeddingsPort } from './embeddings.port.js';

@Injectable()
export class OllamaEmbeddingsAdapter implements EmbeddingsPort {
  private readonly embeddings: OllamaEmbeddings;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    this.embeddings = new OllamaEmbeddings({
      baseUrl: config.get('OLLAMA_BASE_URL', { infer: true }),
      model: config.get('EMBEDDING_MODEL', { infer: true }),
    });
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }
}
