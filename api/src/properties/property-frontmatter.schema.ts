import { z } from 'zod';
import { Listing, PropertyType } from '../generated/prisma/enums.js';

const optionalText = z.string().trim().min(1).optional();

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
  deliveryDate: z.coerce.date().optional(),
  finishing: optionalText,
  paymentPlan: optionalText,
});

export type PropertyFrontmatter = z.infer<typeof propertyFrontmatterSchema>;
