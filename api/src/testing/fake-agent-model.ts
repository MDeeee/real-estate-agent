import type {
  AgentModel,
  AnswerInput,
  BookingExtraction,
  BookingExtractionInput,
  Classification,
  ClassifyInput,
  DetailsInput,
  ExtractFiltersInput,
} from '../llm/agent-model.js';

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

function lastUserText(messages: { role: string; text: string }[]): string {
  return messages.filter((m) => m.role === 'user').at(-1)?.text ?? '';
}

function allFilterKeysNull(): Record<string, unknown> {
  return {
    city: null,
    compound: null,
    district: null,
    type: null,
    listing: null,
    priceMin: null,
    priceMax: null,
    bedroomsMin: null,
    bathroomsMin: null,
    areaMin: null,
    areaMax: null,
  };
}

/**
 * A deterministic stand-in for the LLM: it understands a handful of English
 * phrases, which is enough to drive the whole graph in tests. Behaviour can be
 * scripted per test through the queues and hooks.
 */
export class FakeAgentModel implements AgentModel {
  configured = true;
  readonly classifyCalls: ClassifyInput[] = [];
  readonly filterCalls: ExtractFiltersInput[] = [];
  readonly bookingCalls: BookingExtractionInput[] = [];
  readonly answerCalls: AnswerInput[] = [];
  readonly detailsCalls: DetailsInput[] = [];

  /** Consumed first by `extractFilters`; an Error is thrown. */
  filterQueue: (Record<string, unknown> | Error)[] = [];
  /** Appended to every streamed answer, e.g. a citation of an unknown slug. */
  answerSuffix = '';

  isConfigured(): boolean {
    return this.configured;
  }

  classify(input: ClassifyInput): Promise<Classification> {
    this.classifyCalls.push(input);
    const text = lastUserText(input.messages).toLowerCase();
    const language = /[؀-ۿ]/.test(text) ? 'ar' : 'en';
    const ordinal = ORDINALS.findIndex((word) => text.includes(word));
    const propertyRef =
      ordinal >= 0 ? `the ${ORDINALS[ordinal]} one` : undefined;
    const base = { language, semanticQuery: '', propertyRef } as const;

    if (/weather|joke|football|capital of/.test(text)) {
      return Promise.resolve({ ...base, intent: 'off_topic' });
    }
    if (/^(hi|hello|thanks)\b/.test(text)) {
      return Promise.resolve({ ...base, intent: 'smalltalk' });
    }
    if (
      /\bbook\b|\bview (it|them|the|this)\b|\bviewing\b|my name is|\b01\d{9}\b|\d{4}-\d{2}-\d{2}/.test(
        text,
      )
    ) {
      return Promise.resolve({ ...base, intent: 'book' });
    }
    if (/tell me more|details|payment plan/.test(text)) {
      return Promise.resolve({ ...base, intent: 'details' });
    }
    // Like the real model: state the FULL current preferences, carrying the
    // previous ones over unless the visitor drops them.
    const wanted = /garden view/.test(text)
      ? 'garden view'
      : /quiet/.test(text)
        ? 'quiet street'
        : /forget the view/.test(text)
          ? ''
          : input.previousSemanticQuery;
    return Promise.resolve({ ...base, intent: 'search', semanticQuery: wanted });
  }

  extractFilters(input: ExtractFiltersInput): Promise<Record<string, unknown>> {
    this.filterCalls.push(input);
    const queued = this.filterQueue.shift();
    if (queued instanceof Error) return Promise.reject(queued);
    if (queued) return Promise.resolve(queued);

    const text = lastUserText(input.messages).toLowerCase();
    const filters: Record<string, unknown> = {
      ...allFilterKeysNull(),
      ...input.previousFilters,
    };
    if (/new cairo/.test(text)) filters['city'] = 'New Cairo';
    if (/sheikh zayed|الشيخ زايد/.test(text)) filters['city'] = 'Sheikh Zayed';
    if (/\brent\b|إيجار/.test(text)) filters['listing'] = 'RENT';
    if (/\bbuy\b|\bsale\b/.test(text)) filters['listing'] = 'SALE';
    if (/apartment|شقة/.test(text)) filters['type'] = 'apartment';
    const bedrooms = /(\d+)\s*bed/.exec(text);
    if (bedrooms?.[1]) filters['bedroomsMin'] = Number(bedrooms[1]);
    const million = /under\s+(\d+(?:\.\d+)?)\s*million/.exec(text);
    if (million?.[1]) filters['priceMax'] = Number(million[1]) * 1_000_000;
    if (/cheaper/.test(text)) filters['priceMax'] = 5_000_000;
    return Promise.resolve(filters);
  }

  extractBooking(input: BookingExtractionInput): Promise<BookingExtraction> {
    this.bookingCalls.push(input);
    const text = lastUserText(input.messages);
    const ordinal = ORDINALS.findIndex((word) =>
      text.toLowerCase().includes(word),
    );
    const name = /my name is ([\p{L} ]+?)(?:[,.]| and |$)/iu.exec(text)?.[1];
    const phone = /(\+?\d[\d -]{8,}\d)/.exec(
      text.replace(/\d{4}-\d{2}-\d{2}/, ''),
    )?.[1];
    const date = /(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    return Promise.resolve({
      propertyRef: ordinal >= 0 ? `the ${ORDINALS[ordinal]} one` : undefined,
      name,
      phone,
      preferredDate: date,
    });
  }

  async *streamAnswer(input: AnswerInput): AsyncGenerator<string> {
    this.answerCalls.push(input);
    if (input.listings.length === 0) {
      yield 'No listing matches. Try a higher budget.';
      return;
    }
    yield `I found ${input.listings.length} listings: `;
    for (const { card } of input.listings)
      yield `${card.title} [${card.slug}]; `;
    if (this.answerSuffix) yield this.answerSuffix;
  }

  async *answerDetails(input: DetailsInput): AsyncGenerator<string> {
    this.detailsCalls.push(input);
    yield `Here is more about ${input.card.title} `;
    yield `[${input.card.slug}]: ${input.body.slice(0, 40)}`;
  }
}
