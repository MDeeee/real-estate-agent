import { createHash } from 'node:crypto';
import type { EmbeddingsPort } from '../ingestion/embeddings.port.js';

export const FAKE_EMBEDDING_DIM = 1024;

function seedFrom(text: string): number {
  return createHash('sha256').update(text).digest().readUInt32LE(0);
}

export function deterministicVector(
  text: string,
  dimension = FAKE_EMBEDDING_DIM,
): number[] {
  let state = seedFrom(text);
  const vector: number[] = [];
  for (let i = 0; i < dimension; i += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    vector.push((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1);
  }
  return vector;
}

export class FakeEmbeddings implements EmbeddingsPort {
  readonly calls: string[][] = [];
  failure: Error | undefined;
  dimension = FAKE_EMBEDDING_DIM;

  embedDocuments(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(
      texts.map((text) => deterministicVector(text, this.dimension)),
    );
  }

  embedQuery(text: string): Promise<number[]> {
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(deterministicVector(text, this.dimension));
  }
}
