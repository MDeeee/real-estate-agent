import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  BookingCancelledError,
  PropertyUnavailableError,
} from '../../bookings/bookings.service.js';
import type { BookingDraft } from '../../llm/agent-model.js';
import type { AgentGraphDeps } from '../agent-graph.types.js';
import type { AgentStateType, AgentStateUpdate } from '../agent-state.js';
import {
  cairoToday,
  checkBookingDate,
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
} from './node-support.js';

const DATE_PROBLEM = {
  invalid: 'invalid_date',
  not_future: 'date_not_future',
  too_far: 'date_too_far',
} as const satisfies Record<string, BookingProblem>;

function threadIdOf(config: LangGraphRunnableConfig): string {
  const threadId = config.configurable?.['thread_id'];
  if (typeof threadId !== 'string') {
    throw new Error('Booking requires a conversation thread id.');
  }
  return threadId;
}

export function createBookNode(deps: AgentGraphDeps) {
  const { model, listings, bookings, now } = deps;

  return async (
    state: AgentStateType,
    config: LangGraphRunnableConfig,
  ): Promise<AgentStateUpdate> => {
    emit(config, { type: 'status', stage: 'booking' });
    const today = cairoToday(now());
    const extraction = await model.extractBooking(
      {
        messages: recentTurns(state.messages),
        draft: state.bookingDraft,
        candidates: state.candidates.map(({ slug, title }) => ({
          slug,
          title,
        })),
        today,
      },
      callOptions(config),
    );

    const draft: BookingDraft = { ...state.bookingDraft };
    const problems: BookingProblem[] = [];

    const ref = extraction.propertyRef ?? state.propertyRef ?? undefined;
    if (ref) {
      const slug =
        resolveCandidate(ref, state.candidates)?.slug ??
        (SLUG_LIKE.test(ref) ? ref : undefined);
      if (slug) draft.propertySlug = slug;
    }
    draft.propertySlug ??=
      state.focusSlug ??
      (state.candidates.length === 1 ? state.candidates[0]?.slug : undefined);

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

    const missing: BookingField[] = [];
    if (!draft.propertySlug) missing.push('property');
    if (!draft.name) missing.push('name');
    if (!draft.phone) missing.push('phone');
    if (!draft.preferredDate) missing.push('preferredDate');

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
            bookingQuestion(state.language, title, missing, problems),
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
      });
      emit(config, { type: 'booking', booking });
      return {
        messages: [
          assistantMessage(
            bookingConfirmation(state.language, booking, created),
            { booking },
          ),
        ],
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
