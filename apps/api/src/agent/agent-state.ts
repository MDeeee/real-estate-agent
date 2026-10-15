import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import type { BookingSummary } from '../bookings/bookings.service.js';
import type {
  BookingDraft,
  Intent,
  Language,
  SearchMode,
} from '../llm/agent-model.js';
import type { PropertyFilters } from '../properties/property-filters.schema.js';
import type { ChatCard } from './chat-card.js';

export interface Candidate {
  slug: string;
  title: string;
  card: ChatCard;
  /** Best-matching passage, kept so the answer node can quote it. */
  snippet: string;
}

export interface SearchSummary {
  filters: PropertyFilters;
  semanticQuery: string;
}

/**
 * A property the visitor describes in a booking request while no listing is
 * on screen to resolve it against ("the Nile-view apartment in Zamalek").
 */
export interface ListingLookup {
  filters: PropertyFilters;
  semanticQuery: string;
}

/** What nodes attach to the assistant messages they write; read back for history. */
export interface AssistantExtras {
  properties?: ChatCard[];
  booking?: BookingSummary;
  search?: SearchSummary;
}

function lastValue<T>(initial: () => T) {
  return Annotation<T>({
    reducer: (_current, update) => update,
    default: initial,
  });
}

/** The state of a conversation that has not started (everything but `messages`). */
export function initialValues() {
  return {
    intent: null as Intent | null,
    searchMode: 'new' as SearchMode,
    language: 'en' as Language,
    filters: {} as PropertyFilters,
    semanticQuery: '',
    propertyRef: null as string | null,
    candidates: [] as Candidate[],
    bookingDraft: {} as BookingDraft,
    citedSlugs: [] as string[],
    focusSlug: null as string | null,
    lookup: null as ListingLookup | null,
  };
}

export type RestorableKey = keyof ReturnType<typeof initialValues>;

export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  intent: lastValue<Intent | null>(() => initialValues().intent),
  searchMode: lastValue<SearchMode>(() => initialValues().searchMode),
  language: lastValue<Language>(() => initialValues().language),
  filters: lastValue<PropertyFilters>(() => initialValues().filters),
  semanticQuery: lastValue<string>(() => initialValues().semanticQuery),
  propertyRef: lastValue<string | null>(() => initialValues().propertyRef),
  candidates: lastValue<Candidate[]>(() => initialValues().candidates),
  bookingDraft: lastValue<BookingDraft>(() => initialValues().bookingDraft),
  citedSlugs: lastValue<string[]>(() => initialValues().citedSlugs),
  focusSlug: lastValue<string | null>(() => initialValues().focusSlug),
  lookup: lastValue<ListingLookup | null>(() => initialValues().lookup),
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
