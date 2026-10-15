import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Button, buttonClass } from "@/shared/ui/button";
import { capitalise, formatNumber } from "@/shared/lib/format";
import type {
  FacetValue,
  Listing,
  PropertyFacets,
} from "@/shared/domain/property";
import { SORT_OPTIONS, type SearchQuery } from "@/features/search/search-params";

const inputClass =
  "block w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

const LISTING_CHOICES: { value: "" | Listing; label: string }[] = [
  { value: "", label: "All" },
  { value: "SALE", label: "Buy" },
  { value: "RENT", label: "Rent" },
];

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Which option a URL value maps to. The API matches case-insensitively, so
 * `?city=new cairo` selects "New Cairo". A value that is not offered at all
 * (`?city=Nowhere`) becomes an extra option, so the form mirrors the URL
 * instead of silently showing "All".
 */
function resolveSelection(
  options: FacetValue[],
  current: string | undefined,
): { selected: string; unlisted: string | null } {
  if (!current) return { selected: "", unlisted: null };
  const match = options.find(
    (option) => option.value.toLowerCase() === current.toLowerCase(),
  );
  return match
    ? { selected: match.value, unlisted: null }
    : { selected: current, unlisted: current };
}

export function FilterPanel({
  query,
  facets,
  pending,
}: {
  query: SearchQuery;
  facets: PropertyFacets;
  /** The results for the applied filters are still loading. */
  pending: boolean;
}) {
  const navigate = useNavigate();
  const [listing, setListing] = useState<"" | Listing>(query.listing ?? "");
  const initialCity = resolveSelection(facets.cities, query.city);
  const initialCompound = resolveSelection(facets.compounds, query.compound);
  const [city, setCity] = useState(initialCity.selected);
  const [compound, setCompound] = useState(initialCompound.selected);

  const range = listing ? facets.price[listing] : null;
  const priceSuffix = listing === "RENT" ? "EGP/month" : "EGP";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed === "" || (key === "sort" && trimmed === "newest")) continue;
      params.set(key, trimmed);
    }
    const search = params.toString();
    void navigate(search ? `/?${search}` : "/");
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Filter properties"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Listing</legend>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          {LISTING_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className="cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium text-muted transition-colors has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="listing"
                value={choice.value}
                checked={listing === choice.value}
                onChange={() => setListing(choice.value)}
                className="sr-only"
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field id="city" label="City">
          <select
            id="city"
            name="city"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              // The compounds on offer belong to the previously applied city.
              setCompound("");
            }}
            className={inputClass}
          >
            <option value="">All cities</option>
            {initialCity.unlisted ? (
              <option value={initialCity.unlisted}>
                {initialCity.unlisted}
              </option>
            ) : null}
            {facets.cities.map((city) => (
              <option key={city.value} value={city.value}>
                {city.value}
              </option>
            ))}
          </select>
        </Field>
        <Field id="compound" label="Compound">
          <select
            id="compound"
            name="compound"
            value={compound}
            onChange={(event) => setCompound(event.target.value)}
            className={inputClass}
          >
            <option value="">All compounds</option>
            {initialCompound.unlisted ? (
              <option value={initialCompound.unlisted}>
                {initialCompound.unlisted}
              </option>
            ) : null}
            {facets.compounds.map((compound) => (
              <option key={compound.value} value={compound.value}>
                {compound.value}
              </option>
            ))}
          </select>
        </Field>
        <Field id="type" label="Property type">
          <select
            id="type"
            name="type"
            defaultValue={query.type ?? ""}
            className={`${inputClass} capitalize`}
          >
            <option value="">All types</option>
            {facets.types.map((type) => (
              <option key={type.value} value={type.value}>
                {capitalise(type.value)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="bedroomsMin" label="Bedrooms">
          <select
            id="bedroomsMin"
            name="bedroomsMin"
            defaultValue={query.bedroomsMin?.toString() ?? ""}
            className={inputClass}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count}+
              </option>
            ))}
          </select>
        </Field>
        <Field id="priceMin" label={`Min price (${priceSuffix})`}>
          <input
            id="priceMin"
            name="priceMin"
            type="number"
            inputMode="numeric"
            min={0}
            step="any"
            defaultValue={query.priceMin ?? ""}
            placeholder={range ? formatNumber(range.min) : undefined}
            className={inputClass}
          />
        </Field>
        <Field id="priceMax" label={`Max price (${priceSuffix})`}>
          <input
            id="priceMax"
            name="priceMax"
            type="number"
            inputMode="numeric"
            min={0}
            step="any"
            defaultValue={query.priceMax ?? ""}
            placeholder={range ? formatNumber(range.max) : undefined}
            className={inputClass}
          />
        </Field>
        <Field id="areaMin" label="Min area (m²)">
          <input
            id="areaMin"
            name="areaMin"
            type="number"
            inputMode="numeric"
            min={0}
            step="any"
            defaultValue={query.areaMin ?? ""}
            className={inputClass}
          />
        </Field>
        <Field id="sort" label="Sort by">
          <select
            id="sort"
            name="sort"
            defaultValue={query.sort}
            className={inputClass}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Searching…" : "Apply filters"}
        </Button>
        <Link to="/" className={buttonClass("ghost")}>
          Reset
        </Link>
      </div>
    </form>
  );
}
