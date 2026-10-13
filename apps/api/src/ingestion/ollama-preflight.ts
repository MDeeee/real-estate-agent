export interface OllamaTarget {
  baseUrl: string;
  model: string;
}

export type OllamaCheck = { ok: true } | { ok: false; message: string };

const TIMEOUT_MS = 3000;

function hasModel(names: readonly string[], model: string): boolean {
  // Ollama lists tags: `bge-m3` is stored as `bge-m3:latest`.
  return names.some((name) => name === model || name.startsWith(`${model}:`));
}

/**
 * Checks that the Ollama server answers and has the embedding model, so a
 * command that needs embeddings can fail fast with an actionable message
 * instead of one "Embedding service unavailable" error per file.
 */
export async function checkOllama(
  { baseUrl, model }: OllamaTarget,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaCheck> {
  const unreachable = `Ollama is not reachable at ${baseUrl}. Start Ollama and run \`ollama pull ${model}\`.`;
  let names: string[];
  try {
    const response = await fetchImpl(new URL('/api/tags', baseUrl), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, message: unreachable };
    const body = (await response.json()) as {
      models?: { name?: unknown }[];
    };
    names = (body.models ?? []).flatMap(({ name }) =>
      typeof name === 'string' ? [name] : [],
    );
  } catch {
    return { ok: false, message: unreachable };
  }
  if (!hasModel(names, model)) {
    return {
      ok: false,
      message: `Ollama is running but the model "${model}" is not installed. Run \`ollama pull ${model}\`.`,
    };
  }
  return { ok: true };
}
