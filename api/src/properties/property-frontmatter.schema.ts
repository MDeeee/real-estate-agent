import { z } from 'zod';
import { Listing, PropertyType } from '../generated/prisma/enums.js';

const optionalText = z.string().trim().min(1).optional();

const DELIVERY_DATE_MESSAGE = 'deliveryDate must be a date like 2027-06-30';

// YAML turns an unquoted `2027-06-30` into a Date; a quoted one stays a
// string. Anything else (notably a bare `2027`, which z.coerce.date() would
// read as 1970-01-01T00:00:02.027Z) is rejected rather than guessed at.
const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      ctx.addIssue({ code: 'custom', message: DELIVERY_DATE_MESSAGE });
      return z.NEVER;
    }
    return date;
  });

const deliveryDate = z.union([z.date(), isoDateString], {
  error: DELIVERY_DATE_MESSAGE,
});

export const propertyFrontmatterSchema = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case')
    .max(120),
  title: z.string().trim().min(1).max(200),
  type: z.enum(PropertyType),
  listing: z.enum(Listing),
  price: z.number().positive(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code')
    .default('EGP'),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  areaM2: z.number().int().positive(),
  city: z.string().trim().min(1),
  district: optionalText,
  compound: optionalText,
  deliveryDate: deliveryDate.optional(),
  finishing: optionalText,
  paymentPlan: optionalText,
});

export type PropertyFrontmatter = z.infer<typeof propertyFrontmatterSchema>;
