import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  BookingCancelledError,
  PropertyUnavailableError,
} from '../../bookings/bookings.service.js';
import type { BookingDraft } from '../../llm/agent-model.js';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import {
  businessToday,
  checkBookingDate,
  interpretTimeAnswer,
  normaliseName,
  normalisePhone,
} from '../booking-validation.js';
import { SLUG_LIKE, resolveCandidate } from '../listing-reference.js';
import {
  type BookingField,
  type BookingProblem,
  bookingCancelledReply,
  bookingConfirmation,
  bookingQuestion,
  listingUnavailableReply,
} from '../replies.js';
import {
  assistantMessage,
  callOptions,
  emit,
  recentTurns,
  recordBooking,
} from './node-support.js';

const DATE_PROBLEM = {
  invalid: 'invalid_date',
  not_future: 'date_not_future',
  too_far: 'date_too_far',
} as const satisfies Record<string, BookingProblem>;

const TIME_PROBLEM = {
  invalid: 'invalid_time',
  outside_hours: 'time_outside_hours',
  vague: 'vague_time',
} as const satisfies Record<string, BookingProblem>;

function threadIdOf(config: LangGraphRunnableConfig): string {
  const threadId = config.configurable?.['thread_id'];
  if (typeof threadId !== 'string') {
    throw new Error('Booking requires a conversation thread id.');
  }
  return threadId;
}

export function createBookNode(deps: AgentGraphDeps) {
  const { model, listings, bookings, now, timeZone } = deps;

  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    emit(config, { type: 'status', stage: 'booking' });
    const today = businessToday(now(), timeZone);
    // The time is read from the latest message alone: an earlier, rejected
    // time in the history must never be extracted again.
    const turns = recentTurns(state.messages);
    const latestIndex = turns.findLastIndex((turn) => turn.role === 'user');
    const extraction = await model.extractBooking(
      {
        history: turns.slice(0, Math.max(latestIndex, 0)),
        latestMessage: turns[latestIndex]?.text ?? '',
        draft: state.bookingDraft,
        candidates: state.candidates.map(({ slug, title }) => ({
          slug,
          title,
        })),
        today,
        timeZone,
      },
      callOptions(config),
    );

    const draft: BookingDraft = { ...state.bookingDraft };
    const problems: BookingProblem[] = [];

    // A listing named in this turn replaces the draft's one (name, phone and
    // date are kept). The draft's own slug is shown to the extractor and may be
    // echoed back, so a different, resolvable reference is preferred.
    const named = [state.propertyRef, extraction.propertyRef].flatMap((ref) => {
      const slug = ref
        ? (resolveCandidate(ref, state.candidates)?.slug ??
          (SLUG_LIKE.test(ref) ? ref : undefined))
        : undefined;
      return slug ? [slug] : [];
    });
    const chosen =
      named.find((slug) => slug !== draft.propertySlug) ?? named[0];
    // A search after the draft started replaced the candidates: a draft listing
    // that is not among them is stale, and "book" alone must not silently use it.
    const stale =
      chosen === undefined &&
      draft.propertySlug !== undefined &&
      state.candidates.length > 0 &&
      !state.candidates.some(({ slug }) => slug === draft.propertySlug);
    if (chosen) draft.propertySlug = chosen;
    else if (stale) draft.propertySlug = undefined;
    else {
      draft.propertySlug ??=
        state.focusSlug ??
        (state.candidates.length === 1 ? state.candidates[0]?.slug : undefined);
    }

    let title: string | undefined;
    if (draft.propertySlug) {
      const detail = await listings.detail(draft.propertySlug);
      if (detail) {
        title = detail.card.title;
      } else {
        return {
          messages: [assistantMessage(listingUnavailableReply(state.language))],
          bookingDraft: { ...draft, propertySlug: undefined },
          citedSlugs: [],
        };
      }
    }

    if (extraction.name !== undefined) {
      const name = normaliseName(extraction.name);
      if (name) draft.name = name;
      else {
        draft.name = undefined;
        problems.push('invalid_name');
      }
    }
    if (extraction.phone !== undefined) {
      const phone = normalisePhone(extraction.phone);
      if (phone) draft.phone = phone;
      else {
        draft.phone = undefined;
        problems.push('invalid_phone');
      }
    }
    if (extraction.preferredDate !== undefined) {
      const check = checkBookingDate(extraction.preferredDate, today);
      if (check === 'ok') draft.preferredDate = extraction.preferredDate;
      else {
        draft.preferredDate = undefined;
        problems.push(DATE_PROBLEM[check]);
      }
    }

    const answer = interpretTimeAnswer(extraction);
    let timeProblem = false;
    switch (answer.kind) {
      case 'any':
        draft.anyTime = true;
        draft.preferredTime = undefined;
        break;
      case 'time':
        draft.preferredTime = answer.time;
        draft.anyTime = undefined;
        break;
      case 'problem':
        // An unusable time answers (and so replaces) whatever was stored.
        draft.preferredTime = undefined;
        draft.anyTime = undefined;
        timeProblem = true;
        problems.push(TIME_PROBLEM[answer.problem]);
        break;
      case 'none':
        break;
    }

    const missing: BookingField[] = [];
    if (!draft.propertySlug) missing.push('property');
    if (!draft.name) missing.push('name');
    if (!draft.phone) missing.push('phone');
    if (!draft.preferredDate) missing.push('preferredDate');

    // The booking completes only with a valid HH:mm or an explicit "any time".
    // The time is asked for once everything else is known, or at once when the
    // visitor just gave one that cannot be used.
    if (
      !draft.preferredTime &&
      !draft.anyTime &&
      (missing.length === 0 || timeProblem)
    ) {
      missing.push('preferredTime');
    }

    if (
      missing.length > 0 ||
      !draft.propertySlug ||
      !draft.name ||
      !draft.phone ||
      !draft.preferredDate
    ) {
      return {
        messages: [
          assistantMessage(
            bookingQuestion(
              state.language,
              title,
              missing,
              problems,
              state.candidates.map((candidate) => candidate.title),
            ),
          ),
        ],
        bookingDraft: draft,
        citedSlugs: [],
      };
    }

    try {
      const { booking, created } = await bookings.create({
        threadId: threadIdOf(config),
        propertySlug: draft.propertySlug,
        name: draft.name,
        phone: draft.phone,
        preferredDate: draft.preferredDate,
        preferredTime: draft.preferredTime ?? null,
      });
      recordBooking(config, booking, created);
      const text = bookingConfirmation(state.language, booking, created);
      emit(config, { type: 'booking', booking, text });
      return {
        messages: [assistantMessage(text, { booking })],
        bookingDraft: {},
        focusSlug: booking.propertySlug,
        citedSlugs: [],
      };
    } catch (error) {
      if (error instanceof BookingCancelledError) {
        return {
          messages: [assistantMessage(bookingCancelledReply(state.language))],
          bookingDraft: { ...draft, preferredDate: undefined },
          citedSlugs: [],
        };
      }
      if (!(error instanceof PropertyUnavailableError)) throw error;
      return {
        messages: [assistantMessage(listingUnavailableReply(state.language))],
        bookingDraft: { ...draft, propertySlug: undefined },
        citedSlugs: [],
      };
    }
  };
}
