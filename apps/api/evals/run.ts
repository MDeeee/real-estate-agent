import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConsoleLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { AgentGraphService } from '../src/agent/agent-graph.service.js';
import { RECURSION_LIMIT } from '../src/agent/agent-graph.js';
import type { NodeEvent } from '../src/agent/chat-events.js';
import { CheckpointerService } from '../src/agent/checkpointer.service.js';
import { USAGE_KEY } from '../src/agent/nodes/node-support.js';
import { AppModule } from '../src/app.module.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { validateEnv } from '../src/config/env.schema.js';
import { checkOllama } from '../src/ingestion/ollama-preflight.js';
import { AGENT_MODEL, type TokenUsage } from '../src/llm/agent-model.js';
import { ChatModelFactory } from '../src/llm/chat-model.factory.js';
import { LangChainAgentModel } from '../src/llm/langchain-agent-model.js';
import { parseArgs } from './args.js';
import { type Baseline, readBaseline, writeBaseline } from './baseline.js';
import { type EvalCase, loadCases } from './cases.js';
import { describeGate, evaluateGate, gateRegressions } from './gate.js';
import { inspectLlm } from './llm.js';
import { type TurnOutcome, observeLastTurn } from './observe.js';
import { PacedAgentModel } from './paced-model.js';
import { retryOnRateLimit } from './rate-limit.js';
import {
  type CaseResult,
  describeFailures,
  renderCaseTable,
  renderMetricsTable,
} from './report.js';
import { aggregate, scoreCase } from './scoring.js';
import { type EvalSettings, isCi, parseSettings } from './settings.js';

const apiRoot = resolve(import.meta.dirname, '..');
const CASES_PATH = resolve(import.meta.dirname, 'cases.json');
const BASELINE_PATH = resolve(import.meta.dirname, 'baseline.json');
const RESULTS_PATH = resolve(import.meta.dirname, 'results/latest.json');
const TURN_TIMEOUT_MS = 180_000;

function loadDotEnv(): void {
  for (const file of ['.env', '../../.env']) {
    try {
      process.loadEnvFile(resolve(apiRoot, file));
    } catch {
      // Optional file; the process environment is authoritative.
    }
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

type Graph = AgentGraphService['graph'];

async function runTurn(
  graph: Graph,
  threadId: string,
  text: string,
  usage: TokenUsage,
): Promise<TurnOutcome> {
  const stream = await graph.stream(
    { messages: [new HumanMessage(text)] },
    {
      configurable: { thread_id: threadId, [USAGE_KEY]: usage },
      streamMode: ['custom', 'values'],
      recursionLimit: RECURSION_LIMIT,
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    },
  );
  let state: TurnOutcome['state'] | undefined;
  let rawAnswer = '';
  let shownSlugs: string[] = [];
  for await (const [mode, payload] of stream) {
    if (mode === 'custom') {
      const event = payload as NodeEvent;
      if (event.type === 'token') rawAnswer += event.text;
      if (event.type === 'properties') {
        shownSlugs = event.items.map(({ slug }) => slug);
      }
    } else {
      state = payload as TurnOutcome['state'];
    }
  }
  if (!state) throw new Error('The graph produced no state.');
  return { state, rawAnswer, shownSlugs };
}

async function playCase(
  graph: Graph,
  paced: PacedAgentModel,
  evalCase: EvalCase,
) {
  // A fresh thread per case: the in-memory checkpointer never sees the dev DB.
  const threadId = `eval-${evalCase.id}-${crypto.randomUUID()}`;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let outcome: TurnOutcome | undefined;
  // Latency and tokens cover the whole conversation, not just its last turn.
  let latencyMs = 0;
  for (const turn of evalCase.turns) {
    const pausedBefore = paced.pausedMs;
    const startedAt = performance.now();
    outcome = await runTurn(graph, threadId, turn, usage);
    // Latency is the model's and the database's, not our own rate-limit pauses.
    latencyMs += Math.max(
      0,
      performance.now() - startedAt - (paced.pausedMs - pausedBefore),
    );
  }
  if (!outcome) throw new Error(`Case ${evalCase.id} has no turns.`);
  return observeLastTurn(outcome, {
    latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

async function runCase(
  graph: Graph,
  paced: PacedAgentModel,
  evalCase: EvalCase,
  settings: EvalSettings,
): Promise<CaseResult> {
  const base = {
    id: evalCase.id,
    turns: evalCase.turns,
    expect: evalCase.expect,
  };
  let attempts = 0;
  try {
    // A rate-limited case is replayed from its first turn on a fresh thread.
    const observed = await retryOnRateLimit(
      () => {
        attempts += 1;
        return playCase(graph, paced, evalCase);
      },
      {
        waitMs: settings.retryWaitMs,
        onRetry: () =>
          console.log(
            `  rate limited; retrying the case once in ${Math.round(settings.retryWaitMs / 1000)}s`,
          ),
      },
    );
    return {
      ...base,
      observed,
      score: scoreCase(evalCase.expect, observed),
      attempts,
    };
  } catch (error) {
    return {
      ...base,
      observed: null,
      score: scoreCase(evalCase.expect, null),
      error: errorMessage(error),
      attempts,
    };
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const settings = parseSettings(process.env);

  // Cheapest check first, and before the full environment is validated: a
  // contributor without a complete .env (no database URL, no admin token) must
  // still get the skip message. Only the LLM variables are inspected here.
  const llm = inspectLlm(process.env);
  if (llm.missing.length > 0) {
    console.log('Eval skipped: no LLM configured (see README)');
    console.log(`(missing: ${llm.missing.join(', ')})`);
    return isCi(process.env) ? 1 : 0;
  }
  if (args.updateBaseline && args.only) {
    throw new Error('--update-baseline cannot be combined with --only.');
  }
  const env = validateEnv(process.env);

  const ollama = await checkOllama({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.EMBEDDING_MODEL,
  });
  if (!ollama.ok) {
    console.error(`Eval aborted: ${ollama.message}`);
    return 1;
  }

  const allCases = await loadCases(CASES_PATH);
  const cases = args.only
    ? allCases.filter(({ id }) => args.only?.includes(id))
    : allCases;
  const unknown = (args.only ?? []).filter(
    (id) => !allCases.some((c) => c.id === id),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown case id(s): ${unknown.join(', ')}`);
  }

  // The real application, with exactly two substitutions: conversation memory
  // lives in RAM (the dev database's langgraph schema stays untouched) and
  // bookings are refused (a case that completes one fails loudly).
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .setLogger(new ConsoleLogger({ logLevels: ['error', 'warn'] }))
    .overrideProvider(CheckpointerService)
    .useValue({ saver: new MemorySaver() })
    .overrideProvider(BookingsService)
    .useValue({
      create: () =>
        Promise.reject(new Error('Bookings are disabled during evals.')),
    })
    .overrideProvider(AGENT_MODEL)
    .useFactory({
      inject: [ChatModelFactory],
      factory: (factory: ChatModelFactory) =>
        new PacedAgentModel(new LangChainAgentModel(factory), settings.delayMs),
    })
    .compile();

  try {
    await moduleRef.init();
    const { graph } = moduleRef.get(AgentGraphService, { strict: false });
    const paced = moduleRef.get<PacedAgentModel>(AGENT_MODEL, {
      strict: false,
    });

    console.log(
      `Running ${cases.length} case(s) against ${llm.provider} / ${llm.model} (delay ${settings.delayMs} ms between LLM calls)`,
    );
    const results: CaseResult[] = [];
    for (const [index, evalCase] of cases.entries()) {
      console.log(`[${index + 1}/${cases.length}] ${evalCase.id}`);
      results.push(await runCase(graph, paced, evalCase, settings));
    }

    const metrics = aggregate(results);
    const baseline = await readBaseline(BASELINE_PATH);
    const tolerancePoints = Number((settings.tolerance * 100).toFixed(1));
    const gate = evaluateGate({
      baseline,
      current: { provider: llm.provider, model: llm.model, metrics },
      tolerance: settings.tolerance,
      subset: args.only !== null,
      ci: isCi(process.env),
      allowModelMismatch: args.allowModelMismatch,
    });

    console.log(`\n${renderCaseTable(results)}`);
    const failures = results.flatMap(describeFailures);
    if (failures.length > 0) {
      console.log(`\nDetails:\n${failures.map((l) => `  ${l}`).join('\n')}`);
    }
    console.log(
      `\n${renderMetricsTable(
        metrics,
        gate.kind === 'compared' ? (baseline?.metrics ?? null) : null,
        gateRegressions(gate),
      )}`,
    );

    await mkdir(resolve(RESULTS_PATH, '..'), { recursive: true });
    await writeFile(
      RESULTS_PATH,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          provider: llm.provider,
          model: llm.model,
          subset: args.only,
          settings,
          // Latency and tokens are per conversation: the sum over all its turns.
          metrics,
          cases: results,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`\nWrote ${RESULTS_PATH}`);

    const crashed = results.filter(({ error }) => error !== undefined);
    if (crashed.length > 0) {
      console.error(
        `\n${crashed.length} case(s) crashed; see the details above.`,
      );
    }

    if (args.updateBaseline) {
      if (crashed.length > 0) {
        console.error('Refusing to record a baseline from a run with crashes.');
        return 1;
      }
      const next: Baseline = {
        version: 1,
        createdAt: new Date().toISOString(),
        provider: llm.provider,
        model: llm.model,
        metrics,
      };
      await writeBaseline(BASELINE_PATH, next);
      console.log(`Baseline updated: ${BASELINE_PATH}`);
      return 0;
    }

    const report = describeGate(gate, tolerancePoints);
    (report.failed ? console.error : console.log)(`\n${report.message}`);
    return report.failed || crashed.length > 0 ? 1 : 0;
  } finally {
    await moduleRef.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`Eval failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
