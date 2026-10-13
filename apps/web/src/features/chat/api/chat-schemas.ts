import { z } from "zod";
import { propertyCardSchema } from "@/shared/domain/property";

export const MAX_MESSAGE_LENGTH = 1000;

export const chatFiltersSchema = z.object({
  city: z.string().optional(),
  compound: z.string().optional(),
  district: z.string().optional(),
  type: z.string().optional(),
  listing: z.string().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  bedroomsMin: z.number().optional(),
  bathroomsMin: z.number().optional(),
  areaMin: z.number().optional(),
  areaMax: z.number().optional(),
});

export type ChatFilters = z.infer<typeof chatFiltersSchema>;

export const searchSummarySchema = z.object({
  filters: chatFiltersSchema,
  semanticQuery: z.string(),
});

export type SearchSummary = z.infer<typeof searchSummarySchema>;

/** Cards arrive as JSON, so dates are ISO strings and are not needed here. */
export const chatCardSchema = propertyCardSchema.extend({
  deliveryDate: z.string().nullable(),
});

export type ChatCard = z.infer<typeof chatCardSchema>;

export const bookingSchema = z.object({
  id: z.string(),
  reference: z.string(),
  propertySlug: z.string(),
  propertyTitle: z.string(),
  name: z.string(),
  phone: z.string(),
  /** A calendar day, `YYYY-MM-DD`. */
  preferredDate: z.string(),
  /** `HH:mm`; null when any time suits (also for bookings made before times existed). */
  preferredTime: z.string().nullable().default(null),
  status: z.string(),
});

export type ChatBooking = z.infer<typeof bookingSchema>;

export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    stage: z.enum(["thinking", "searching", "booking"]),
  }),
  z.object({
    type: z.literal("filters"),
    filters: chatFiltersSchema,
    semanticQuery: z.string(),
  }),
  z.object({ type: z.literal("properties"), items: z.array(chatCardSchema) }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("booking"),
    booking: bookingSchema,
    /** The localized confirmation text, shown at once (a Stop can land before `final`). */
    text: z.string(),
  }),
  z.object({
    type: z.literal("final"),
    text: z.string(),
    citedSlugs: z.array(z.string()),
    intent: z.string().nullable(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("done") }),
]);

export type ChatEvent = z.infer<typeof chatEventSchema>;

export const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  properties: z.array(chatCardSchema).optional(),
  booking: bookingSchema.optional(),
  search: searchSummarySchema.optional(),
});

export const historySchema = z.object({
  messages: z.array(historyMessageSchema),
});

export type HistoryMessage = z.infer<typeof historyMessageSchema>;
