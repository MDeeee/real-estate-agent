import "server-only";

import { z } from "zod";
import {
  API_UNREACHABLE_MESSAGE,
  apiBaseUrl,
  readErrorBody,
  type ApiIssue,
} from "./api-base";
import {
  propertyFacetsSchema,
  propertyPageSchema,
  type PropertyFacets,
  type PropertyPage,
} from "./property-schemas";
import { PAGE_SIZE, toSearchParams, type SearchQuery } from "./property-search";
import { visitorHeaders } from "./visitor-headers";

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

async function getJson<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const headers = await visitorHeaders();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      cache: "no-store",
      headers,
    });
  } catch {
    throw new PublicApiError(503, API_UNREACHABLE_MESSAGE);
  }
  if (!response.ok) {
    const { message, issues } = await readErrorBody(response);
    throw new PublicApiError(response.status, message, issues);
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

/** Facets for the filter form; `city` narrows the compounds to that city. */
export function fetchFacets(city?: string): Promise<PropertyFacets> {
  const params = new URLSearchParams();
  if (city) params.set("city", city);
  const search = params.toString();
  return getJson(
    `/properties/facets${search ? `?${search}` : ""}`,
    propertyFacetsSchema,
  );
}
