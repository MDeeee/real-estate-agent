import { MarkdownTextSplitter } from '@langchain/textsplitters';
import type { PropertyFrontmatter } from '../properties/property-frontmatter.schema.js';

export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 100;

const splitter = new MarkdownTextSplitter({
  chunkSize: CHUNK_SIZE,
  chunkOverlap: CHUNK_OVERLAP,
});

export async function splitMarkdownBody(body: string): Promise<string[]> {
  const chunks = await splitter.splitText(body.trim());
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => chunk !== '');
}

export function contextualHeader(
  property: Pick<
    PropertyFrontmatter,
    'title' | 'type' | 'listing' | 'compound' | 'district' | 'city'
  >,
): string {
  const place = [property.compound, property.district, property.city]
    .filter(Boolean)
    .join(', ');
  return `${property.title} | ${property.type} for ${property.listing.toLowerCase()} | ${place}`;
}

export function toEmbeddingInput(header: string, chunk: string): string {
  return `${header}\n\n${chunk}`;
}
