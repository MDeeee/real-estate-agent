import type { ApiIssue } from "./api-base";

/** UI labels for the API's filter parameter names; the one place they are mapped. */
export const FILTER_LABELS: Record<string, string> = {
  listing: "Listing",
  city: "City",
  compound: "Compound",
  district: "District",
  type: "Property type",
  priceMin: "Minimum price",
  priceMax: "Maximum price",
  bedroomsMin: "Bedrooms",
  bathroomsMin: "Bathrooms",
  areaMin: "Minimum area",
  areaMax: "Maximum area",
  sort: "Sort order",
  page: "Page",
  pageSize: "Page size",
};

export function filterLabel(field: string): string {
  return FILTER_LABELS[field] ?? field;
}

const RANGE_WORDING: Record<string, string> = {
  priceMin: "higher",
  areaMin: "larger",
};

const RANGE_ISSUE = /^(\w+) must not be greater than (\w+)$/;

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** One human sentence for an API validation issue on a filter. */
export function describeFilterIssue({ path, message }: ApiIssue): string {
  const range = RANGE_ISSUE.exec(message);
  if (range?.[1] && range[2]) {
    const verb = RANGE_WORDING[range[1]] ?? "higher";
    return `${filterLabel(range[1])} can't be ${verb} than ${lowerFirst(filterLabel(range[2]))}.`;
  }
  const field = path.split(".")[0];
  return field
    ? `The ${lowerFirst(filterLabel(field))} filter isn't valid.`
    : "Some of the filters aren't valid.";
}

export function describeFilterIssues(issues: ApiIssue[]): string[] {
  const lines = issues.map(describeFilterIssue);
  return lines.length > 0 ? [...new Set(lines)] : ["Some of the filters aren't valid."];
}
