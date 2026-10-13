import type { ChatMessage } from "./types";
import type { ChatEvent } from "./api/chat-schemas";

/**
 * What one stream event does to the assistant message being written. Stage
 * changes are handled by the caller.
 *
 * `booking` carries the localized confirmation text, so it is shown at once:
 * if the visitor presses Stop between `booking` and `final` the server keeps
 * the turn, and the message must already read as confirmed.
 */
export function applyEventToMessage(
  message: ChatMessage,
  event: ChatEvent,
): ChatMessage {
  switch (event.type) {
    case "filters":
      return {
        ...message,
        search: { filters: event.filters, semanticQuery: event.semanticQuery },
      };
    case "properties":
      return { ...message, properties: event.items };
    case "token":
      return { ...message, text: message.text + event.text };
    case "booking":
      return { ...message, booking: event.booking, text: event.text };
    case "final":
      return {
        ...message,
        text: event.text,
        citedSlugs: event.citedSlugs,
        streaming: false,
      };
    case "error":
      return {
        ...message,
        error: event.message,
        errorCode: event.code,
        streaming: false,
      };
    case "status":
    case "done":
      return message;
  }
}
