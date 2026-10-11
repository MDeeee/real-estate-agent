import type { Listing, PropertyType } from '../generated/prisma/enums.js';

export interface PropertyCard {
  id: string;
  slug: string;
  title: string;
  type: PropertyType;
  listing: Listing;
  price: number;
  currency: string;
  bedrooms: number;
  bathrooms: number;
  areaM2: number;
  city: string;
  district: string | null;
  compound: string | null;
  finishing: string | null;
  deliveryDate: Date | null;
  paymentPlan: string | null;
  excerpt: string;
}

export interface PropertyDetail extends PropertyCard {
  body: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface PropertyFacets {
  cities: FacetValue[];
  compounds: FacetValue[];
  types: { value: PropertyType; count: number }[];
  listings: { value: Listing; count: number }[];
  price: { SALE: PriceRange | null; RENT: PriceRange | null };
}
