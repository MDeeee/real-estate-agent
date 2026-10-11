/**
 * The landing page grid. One column on mobile, ordered heading, filters,
 * "Ask the AI", results; two columns from `lg` with the AI panel on the right
 * spanning the heading, filters and results rows.
 */
export const HOME_GRID_CLASS =
  "mx-auto grid w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] content-start gap-x-8 gap-y-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]";

export const ASIDE_CLASS =
  "order-1 lg:order-none lg:col-start-2 lg:row-span-3 lg:row-start-1";

export const RESULTS_CLASS = "order-2 min-w-0 lg:order-none";
