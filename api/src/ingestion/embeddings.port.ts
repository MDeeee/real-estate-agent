export const EMBEDDINGS_PORT = Symbol('EMBEDDINGS_PORT');

export interface EmbeddingsPort {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
