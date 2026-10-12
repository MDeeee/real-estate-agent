import { describe, expect, it } from 'vitest';
import type { AgentModel } from '../src/llm/agent-model.js';
import { PacedAgentModel } from './paced-model.js';

function setup(delayMs: number) {
  let clock = 1_000;
  const sleeps: number[] = [];
  const inner = {
    isConfigured: () => true,
    classify: () => {
      clock += 100;
      return Promise.resolve({
        intent: 'search',
        semanticQuery: '',
        propertyRef: undefined,
      });
    },
    streamAnswer: async function* () {
      clock += 50;
      yield 'hello';
    },
  } as unknown as AgentModel;
  const paced = new PacedAgentModel(
    inner,
    delayMs,
    (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    () => clock,
  );
  return { paced, sleeps, advance: (ms: number) => (clock += ms) };
}

const classifyInput = {
  messages: [],
  candidates: [],
  bookingInProgress: false,
  previousSemanticQuery: '',
};

describe('PacedAgentModel', () => {
  it('does not delay the first call', async () => {
    const { paced, sleeps } = setup(4000);
    await paced.classify(classifyInput);
    expect(sleeps).toEqual([]);
  });

  it('waits out the rest of the delay measured from the end of the last call', async () => {
    const { paced, sleeps, advance } = setup(4000);
    await paced.classify(classifyInput);
    advance(1000);
    await paced.classify(classifyInput);
    expect(sleeps).toEqual([3000]);
    expect(paced.pausedMs).toBe(3000);
  });

  it('does not wait when enough time has passed already', async () => {
    const { paced, sleeps, advance } = setup(4000);
    await paced.classify(classifyInput);
    advance(5000);
    await paced.classify(classifyInput);
    expect(sleeps).toEqual([]);
  });

  it('paces streamed answers as well', async () => {
    const { paced, sleeps } = setup(4000);
    await paced.classify(classifyInput);
    const chunks: string[] = [];
    for await (const chunk of paced.streamAnswer({
      language: 'en',
      messages: [],
      filters: {},
      listings: [],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['hello']);
    expect(sleeps).toEqual([4000]);
  });
});
