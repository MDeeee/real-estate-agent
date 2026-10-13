const HEADING_LINE = /^\s{0,3}#{1,6}\s.*$/gm;
const FENCED_CODE = /```[\s\S]*?```/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]+)\]\([^)]*\)/g;
const HTML_TAG = /<[^>]+>/g;
const EMPHASIS = /(\*\*|__|\*|_|~~|`)/g;
const LINE_PREFIX = /^\s*(?:>\s*|[-*+]\s+|\d+\.\s+)/gm;

export function markdownExcerpt(markdown: string, maxLength = 180): string {
  const plain = markdown
    .replace(FENCED_CODE, ' ')
    .replace(HEADING_LINE, ' ')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(LINE_PREFIX, '')
    .replace(EMPHASIS, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (plain.length <= maxLength) return plain;

  const cut = plain.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[\s,;:.\-–—]+$/, '')}…`;
}
