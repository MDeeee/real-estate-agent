import type {
  ChatBooking,
  ChatCard,
  SearchSummary,
} from "./api/chat-schemas";

export type ChatStage = "thinking" | "searching" | "booking";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  properties?: ChatCard[];
  booking?: ChatBooking;
  search?: SearchSummary;
  /** Listings the final answer cited, in citation order (absent while streaming and for restored messages). */
  citedSlugs?: string[];
  streaming?: boolean;
  /** The visitor pressed Stop: a partial reply is kept for now but not stored by the server; on a visitor message it marks one that got no reply. */
  stopped?: boolean;
  error?: string;
}
