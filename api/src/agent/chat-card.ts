import type { PropertyCard } from '../properties/property.dto.js';

/** A property card as it travels over SSE and sits in the checkpointed state. */
export type ChatCard = Omit<PropertyCard, 'deliveryDate'> & {
  deliveryDate: string | null;
};

export function toChatCard(card: PropertyCard): ChatCard {
  return {
    ...card,
    deliveryDate: card.deliveryDate
      ? card.deliveryDate.toISOString().slice(0, 10)
      : null,
  };
}
