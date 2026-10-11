import matter from 'gray-matter';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Parses a markdown document with YAML frontmatter.
 *
 * gray-matter caches every input forever when it is called without options and
 * then returns a cached, half-parsed object after a YAML error. Passing an
 * options object (even an empty one) disables that cache, so always go through
 * this wrapper instead of calling `matter(str)` directly.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const { data, content } = matter(markdown, {});
  return { data: data as Record<string, unknown>, content };
}
