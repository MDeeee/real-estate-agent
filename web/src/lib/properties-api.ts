import "server-only";

import { z } from "zod";
import {
  API_UNREACHABLE_MESSAGE,
  apiBaseUrl,
  readErrorMessage,
} from "./api-base";
import {
  propertyFacetsSchema,
  propertyPageSchema,
  type PropertyFacets,
  type PropertyPage,
} from "./property-schemas";
import { PAGE_SIZE, toSearchParams, type SearchQuery } from "./property-search";

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

async function getJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
  } catch {
    throw new PublicApiError(503, API_UNREACHABLE_MESSAGE);
  }
  if (!response.ok) {
    throw new PublicApiError(response.status, await readErrorMessage(response));
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PublicApiError(502, "The API returned an unexpected response.");
  }
  return parsed.data;
}

export function fetchProperties(query: SearchQuery): Promise<PropertyPage> {
  const params = toSearchParams(query);
  params.set("sort", query.sort);
  params.set("page", String(query.page));
  params.set("pageSize", String(PAGE_SIZE));
  return getJson(`/properties?${params.toString()}`, propertyPageSchema);
}

export function fetchFacets(): Promise<PropertyFacets> {
  return getJson("/properties/facets", propertyFacetsSchema);
}
