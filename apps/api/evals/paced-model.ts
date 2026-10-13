import type {
  AgentModel,
  AnswerInput,
  BookingExtraction,
  BookingExtractionInput,
  Classification,
  ClassifyInput,
  DetailsInput,
  ExtractFiltersInput,
  ModelCallOptions,
} from '../src/llm/agent-model.js';

const realSleep = (ms: number): Promise<void> =>
  new Promise((done) => setTimeout(done, ms));

/**
 * Wraps the real model and spaces its calls at least `delayMs` apart, so a
 * free-tier rate limit (a few requests per minute) is not hit by the eval's
 * back-to-back graph runs. The wait counts from the end of the previous call.
 */
export class PacedAgentModel implements AgentModel {
  private lastEndedAt: number | null = null;
  private paused = 0;

  constructor(
    private readonly inner: AgentModel,
    private readonly delayMs: number,
    private readonly sleep: (ms: number) => Promise<void> = realSleep,
    private readonly now: () => number = Date.now,
  ) {}

  /** Total time spent waiting for the pace, so callers can subtract it from latency. */
  get pausedMs(): number {
    return this.paused;
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  classify(
    input: ClassifyInput,
    options?: ModelCallOptions,
  ): Promise<Classification> {
    return this.call(() => this.inner.classify(input, options));
  }

  extractFilters(
    input: ExtractFiltersInput,
    options?: ModelCallOptions,
  ): Promise<Record<string, unknown>> {
    return this.call(() => this.inner.extractFilters(input, options));
  }

  extractBooking(
    input: BookingExtractionInput,
    options?: ModelCallOptions,
  ): Promise<BookingExtraction> {
    return this.call(() => this.inner.extractBooking(input, options));
  }

  streamAnswer(
    input: AnswerInput,
    options?: ModelCallOptions,
  ): AsyncIterable<string> {
    return this.stream(() => this.inner.streamAnswer(input, options));
  }

  answerDetails(
    input: DetailsInput,
    options?: ModelCallOptions,
  ): AsyncIterable<string> {
    return this.stream(() => this.inner.answerDetails(input, options));
  }

  private async waitForTurn(): Promise<void> {
    if (this.lastEndedAt === null) return;
    const wait = this.lastEndedAt + this.delayMs - this.now();
    if (wait <= 0) return;
    this.paused += wait;
    await this.sleep(wait);
  }

  private async call<T>(run: () => Promise<T>): Promise<T> {
    await this.waitForTurn();
    try {
      return await run();
    } finally {
      this.lastEndedAt = this.now();
    }
  }

  private async *stream(
    run: () => AsyncIterable<string>,
  ): AsyncGenerator<string> {
    await this.waitForTurn();
    try {
      yield* run();
    } finally {
      this.lastEndedAt = this.now();
    }
  }
}
