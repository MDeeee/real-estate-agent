export class LlmNotConfiguredError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`The LLM is not configured; missing ${missing.join(', ')}.`);
    this.name = 'LlmNotConfiguredError';
  }
}
