import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { request } from "@/shared/api/http";
import {
  propertyFacetsSchema,
  propertyPageSchema,
} from "@/shared/domain/property";
import {
  PAGE_SIZE,
  toSearchParams,
  type SearchQuery,
} from "../search-params";

export const propertyKeys = {
  all: ["properties"] as const,
  list: (query: SearchQuery) =>
    [...propertyKeys.all, "list", toSearchParams(query).toString()] as const,
  facets: (city: string | undefined) =>
    [...propertyKeys.all, "facets", city ?? ""] as const,
};

function fetchProperties(query: SearchQuery, signal: AbortSignal) {
  const params = toSearchParams(query);
  params.set("sort", query.sort);
  params.set("page", String(query.page));
  params.set("pageSize", String(PAGE_SIZE));
  return request(`/properties?${params.toString()}`, propertyPageSchema, {
    signal,
  });
}

/** Facets for the filter form; `city` narrows the compounds to that city. */
function fetchFacets(city: string | undefined, signal: AbortSignal) {
  const params = new URLSearchParams();
  if (city) params.set("city", city);
  const search = params.toString();
  return request(
    `/properties/facets${search ? `?${search}` : ""}`,
    propertyFacetsSchema,
    { signal },
  );
}

/** The listings for a search. The previous page of results stays on screen while the next one loads. */
export function useProperties(query: SearchQuery) {
  return useQuery({
    queryKey: propertyKeys.list(query),
    queryFn: ({ signal }) => fetchProperties(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function useFacets(city: string | undefined) {
  return useQuery({
    queryKey: propertyKeys.facets(city),
    queryFn: ({ signal }) => fetchFacets(city, signal),
    placeholderData: keepPreviousData,
  });
}
