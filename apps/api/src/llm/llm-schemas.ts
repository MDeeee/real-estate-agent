import { z } from 'zod';
import { propertyFilterShape } from '../properties/property-filters.schema.js';
import { INTENTS, SEARCH_MODES } from './agent-model.js';

export const classificationSchema = z.object({
  intent: z
    .enum(INTENTS)
    .describe(
      'search = looking for or refining a search for listings; details = asks about a specific listing already shown; book = wants to book a viewing, or is giving booking details (name, phone, date); smalltalk = greeting or thanks; off_topic = anything unrelated to real estate.',
    ),
  searchMode: z
    .enum(SEARCH_MODES)
    .describe(
      'For search only (return "refine" for every other intent). refine = the message MODIFIES the previous search ("cheaper", "in Zayed instead", "with a garden", "what about 3 bedrooms"). new = a self-contained request that states its own location, type or sale/rent ("3 bedroom apartment for sale under 12 million", "3ayez villa fe Zayed"): the earlier search must NOT be carried over.',
    ),
  semanticQuery: z
    .string()
    .describe(
      "The FULL current qualitative preferences to rank listings by meaning (view, quiet street, garden, near schools, family-friendly, finishing), in the visitor's own words. For a refine search start from the previous preferences, keep them unless the visitor replaces or drops them, and add new ones; for a new search use only what this message states. Exclude anything expressed as a filter (city, type, price, bedrooms, area). Empty string when there are none.",
    ),
  propertyRef: z
    .string()
    .nullable()
    .describe(
      'For details/book only: the slug of the listing the visitor refers to when it is identifiable from the numbered candidates, otherwise their own words ("the second one", a title fragment). null when none is referred to.',
    ),
});

export const bookingExtractionSchema = z.object({
  propertyRef: z
    .string()
    .nullable()
    .describe(
      'Slug of the listing to book when identifiable from the candidates, otherwise the visitor\'s words ("the second one"). null when not stated in this conversation.',
    ),
  name: z
    .string()
    .nullable()
    .describe("Visitor's full name, exactly as written. null if not given."),
  phone: z
    .string()
    .nullable()
    .describe('Phone number exactly as written. null if not given.'),
  preferredDate: z
    .string()
    .nullable()
    .describe(
      "Preferred viewing date as ISO YYYY-MM-DD, resolving relative dates against today's date. null if not given.",
    ),
  preferredTime: z
    .string()
    .nullable()
    .describe(
      'From the LATEST visitor message only: the exact viewing time of day as 24-hour HH:mm ("5 pm" => "17:00", "الساعة 4 العصر" => "16:00"). null if the latest message gives no exact time, including a vague one ("evening") or "any time".',
    ),
  anyTime: z
    .boolean()
    .describe(
      'From the LATEST visitor message only: true only when it explicitly says any time suits them ("any time", "whenever", "في أي وقت", "مفيش مشكلة في الميعاد"); false otherwise.',
    ),
  timeVague: z
    .boolean()
    .describe(
      'From the LATEST visitor message only: true when it names only a vague part of the day that is not one exact time ("evening", "after work", "after 6", "morning", "بعد الشغل"); false otherwise.',
    ),
});

type Shape = typeof propertyFilterShape;

/**
 * The filter contract as the LLM sees it: the very same fields and
 * descriptions as the regular search, but every key required and nullable,
 * because structured-output providers reject optional keys.
 */
/** The JSON-schema-representable core of a filter field (preprocessing steps removed). */
function llmFieldOf(field: Shape[keyof Shape]): z.ZodType {
  const inner = field.unwrap();
  if (inner instanceof z.ZodPipe) {
    const target = inner.out as z.ZodType;
    return inner.description ? target.describe(inner.description) : target;
  }
  return inner;
}

/**
 * The filter contract as the LLM sees it: the very same fields and
 * descriptions as the regular search, but every key required and nullable,
 * because structured-output providers reject optional keys.
 */
export function toLlmFilterSchema(shape: Shape = propertyFilterShape) {
  return z.object(
    Object.fromEntries(
      Object.entries(shape).map(([key, field]) => [
        key,
        llmFieldOf(field).nullable(),
      ]),
    ) as { [K in keyof Shape]: z.ZodNullable<z.ZodType> },
  );
}

export const llmFilterSchema = toLlmFilterSchema();
