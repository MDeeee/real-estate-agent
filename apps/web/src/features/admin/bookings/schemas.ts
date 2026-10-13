import { z } from "zod";

export const bookingItemSchema = z.object({
  id: z.string(),
  /** The short code the visitor was given in the chat. */
  reference: z.string(),
  name: z.string(),
  phone: z.string(),
  /** A calendar day, `YYYY-MM-DD`: not an instant, never shifted to a time zone. */
  preferredDate: z.string(),
  /** `HH:mm`; null means any time. */
  preferredTime: z.string().nullable().default(null),
  status: z.enum(["CONFIRMED", "CANCELLED"]),
  createdAt: z.coerce.date(),
  property: z.object({ slug: z.string(), title: z.string() }),
});

export type BookingItem = z.infer<typeof bookingItemSchema>;
