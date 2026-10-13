import { describe, expect, it } from 'vitest';
import { checkOllama } from './ollama-preflight.js';

const target = { baseUrl: 'http://localhost:11434', model: 'bge-m3' };

function fakeFetch(respond: () => Response | Promise<Response>): typeof fetch {
  return (() => Promise.resolve(respond())) as unknown as typeof fetch;
}

describe('checkOllama', () => {
  it('accepts a server that lists the model with its tag', async () => {
    const fetchImpl = fakeFetch(() =>
      Response.json({ models: [{ name: 'bge-m3:latest' }] }),
    );
    expect(await checkOllama(target, fetchImpl)).toEqual({ ok: true });
  });

  it('asks the user to pull a missing model', async () => {
    const fetchImpl = fakeFetch(() =>
      Response.json({ models: [{ name: 'llama3:8b' }] }),
    );
    const result = await checkOllama(target, fetchImpl);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('ollama pull bge-m3'),
    });
  });

  it('does not mistake a model with a longer name for the wanted one', async () => {
    const fetchImpl = fakeFetch(() =>
      Response.json({ models: [{ name: 'bge-m3-large:latest' }] }),
    );
    expect((await checkOllama(target, fetchImpl)).ok).toBe(false);
  });

  it('reports an unreachable server', async () => {
    const fetchImpl = (() =>
      Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const result = await checkOllama(target, fetchImpl);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining(
        'Start Ollama and run `ollama pull bge-m3`',
      ),
    });
  });

  it('reports an unhealthy server', async () => {
    const fetchImpl = fakeFetch(() => new Response('boom', { status: 500 }));
    expect((await checkOllama(target, fetchImpl)).ok).toBe(false);
  });
});
