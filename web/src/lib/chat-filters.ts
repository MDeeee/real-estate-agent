import type { ChatFilters } from "./chat-schemas";
import { capitalise, formatNumber } from "./format";

export interface FilterChip {
  key: string;
  label: string;
  value: string;
}

const AMOUNT_LABELS = {
  priceMin: "Price from",
  priceMax: "Price up to",
  areaMin: "Area from",
  areaMax: "Area up to",
} as const;

/** Human-readable chips for the filters the AI extracted, in a stable order. */
export function filterChips(filters: ChatFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (key: string, label: string, value: string | undefined) => {
    if (value !== undefined && value !== "") chips.push({ key, label, value });
  };

  add("listing", "Listing", filters.listing === "RENT" ? "Rent" : filters.listing === "SALE" ? "Buy" : filters.listing);
  add("type", "Type", filters.type ? capitalise(filters.type) : undefined);
  add("city", "City", filters.city);
  add("district", "District", filters.district);
  add("compound", "Compound", filters.compound);
  add("bedroomsMin", "Bedrooms", filters.bedroomsMin !== undefined ? `≥ ${filters.bedroomsMin}` : undefined);
  add("bathroomsMin", "Bathrooms", filters.bathroomsMin !== undefined ? `≥ ${filters.bathroomsMin}` : undefined);
  for (const key of ["priceMin", "priceMax"] as const) {
    const amount = filters[key];
    add(key, AMOUNT_LABELS[key], amount !== undefined ? `${formatNumber(amount)} EGP` : undefined);
  }
  for (const key of ["areaMin", "areaMax"] as const) {
    const amount = filters[key];
    add(key, AMOUNT_LABELS[key], amount !== undefined ? `${formatNumber(amount)} m²` : undefined);
  }
  return chips;
}

const SEARCH_KEYS = [
  "listing",
  "city",
  "compound",
  "type",
  "priceMin",
  "priceMax",
  "bedroomsMin",
  "areaMin",
] as const;

/**
 * The same filters as a regular-search URL. The regular form has no district,
 * bathroom or maximum-area fields, so those are left out of the link.
 */
export function filtersToHref(filters: ChatFilters): string {
  const params = new URLSearchParams();
  for (const key of SEARCH_KEYS) {
    const value = filters[key];
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

/** Filters the AI used that the regular search form cannot express. */
export function unsupportedFilterLabels(filters: ChatFilters): string[] {
  return filterChips(filters)
    .filter(
      ({ key }) => !(SEARCH_KEYS as readonly string[]).includes(key),
    )
    .map(({ label }) => label);
}
