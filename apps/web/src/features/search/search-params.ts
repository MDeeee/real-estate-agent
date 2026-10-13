import { z } from "zod";
import { listingSchema, propertyTypeSchema } from "@/shared/domain/property";

export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "area_desc", label: "Largest area" },
] as const;

export const PAGE_SIZE = 12;

const sortSchema = z.enum(["newest", "price_asc", "price_desc", "area_desc"]);

const text = z.string().trim().min(1).max(100);
const amount = z.coerce.number().nonnegative().finite();
const count = z.coerce.number().int().nonnegative().max(100);

export type SearchQuery = {
  listing?: z.infer<typeof listingSchema>;
  city?: string;
  compound?: string;
  type?: z.infer<typeof propertyTypeSchema>;
  priceMin?: number;
  priceMax?: number;
  bedroomsMin?: number;
  areaMin?: number;
  sort: z.infer<typeof sortSchema>;
  page: number;
};

const fieldParsers = {
  listing: listingSchema,
  city: text,
  compound: text,
  type: propertyTypeSchema,
  priceMin: amount,
  priceMax: amount,
  bedroomsMin: count,
  areaMin: amount,
} as const;

/** The search the visitor asked for, read from the page URL. A value that is not valid is dropped, never an error. */
export function parseSearchParams(params: URLSearchParams): SearchQuery {
  const query: SearchQuery = {
    sort: sortSchema.catch("newest").parse(params.get("sort") ?? undefined),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .catch(1)
      .parse(params.get("page") ?? 1),
  };

  const filters: Record<string, unknown> = {};
  for (const [key, parser] of Object.entries(fieldParsers)) {
    const value = params.get(key);
    if (value === null || value.trim() === "") continue;
    const parsed = parser.safeParse(value);
    if (parsed.success) filters[key] = parsed.data;
  }
  return { ...query, ...filters };
}

export function toSearchParams(
  query: SearchQuery,
  overrides: Partial<SearchQuery> = {},
): URLSearchParams {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  for (const key of Object.keys(fieldParsers) as (keyof typeof fieldParsers)[]) {
    const value = merged[key];
    if (value !== undefined) params.set(key, String(value));
  }
  if (merged.sort !== "newest") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));
  return params;
}

export function hrefFor(
  query: SearchQuery,
  overrides: Partial<SearchQuery> = {},
): string {
  const search = toSearchParams(query, overrides).toString();
  return search ? `/?${search}` : "/";
}

export function hasActiveFilters(query: SearchQuery): boolean {
  return (Object.keys(fieldParsers) as (keyof typeof fieldParsers)[]).some(
    (key) => query[key] !== undefined,
  );
}
