import type { z } from 'zod';

const MAX_LISTED_VALUES = 8;

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function describeIssue(issue: z.core.$ZodIssue, input: unknown): string {
  const value = valueAt(input, issue.path);
  if (value === undefined && issue.code === 'invalid_type') return 'required';
  if (value === null) {
    return 'is empty; give it a value or remove the line';
  }

  switch (issue.code) {
    case 'invalid_type':
      switch (issue.expected) {
        case 'int':
          return 'must be a whole number';
        case 'number':
          return 'must be a number';
        case 'string':
          return 'must be text';
        default:
          return `must be a ${issue.expected}`;
      }
    case 'invalid_value': {
      const shown = issue.values.slice(0, MAX_LISTED_VALUES).map(String);
      const more = issue.values.length > shown.length ? ', ...' : '';
      return `must be one of: ${shown.join(', ')}${more}`;
    }
    case 'too_small': {
      const minimum = String(issue.minimum);
      if (issue.origin === 'string') {
        return issue.minimum === 1
          ? 'must not be empty'
          : `must be at least ${minimum} characters`;
      }
      return issue.inclusive === false
        ? `must be greater than ${minimum}`
        : `must be at least ${minimum}`;
    }
    case 'too_big': {
      const maximum = String(issue.maximum);
      if (issue.origin === 'string') {
        return `must be at most ${maximum} characters`;
      }
      return issue.inclusive === false
        ? `must be less than ${maximum}`
        : `must be at most ${maximum}`;
    }
    case 'invalid_format':
      // Schema-authored messages ("must be lowercase kebab-case") are kept;
      // zod's generic "Invalid string: ..." text is not useful to an admin.
      return issue.message.startsWith('Invalid ')
        ? 'has an invalid format'
        : issue.message;
    default:
      return issue.message;
  }
}

/**
 * One line per problem, `"<field>: <message>"`, for the admin who uploaded
 * the file. `input` is the raw frontmatter, used to tell a missing field from
 * a wrongly typed one.
 */
export function formatFrontmatterIssues(
  error: z.ZodError,
  input: unknown,
): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        lines.push(`${[...issue.path, key].join('.')}: unknown field`);
      }
      continue;
    }
    const field = issue.path.length > 0 ? issue.path.join('.') : 'frontmatter';
    lines.push(`${field}: ${describeIssue(issue, input)}`);
  }
  return lines.join('\n');
}
