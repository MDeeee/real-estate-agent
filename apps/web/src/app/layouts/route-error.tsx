import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { buttonClass } from "@/shared/ui/button";
import { SiteHeader } from "./site-header";

/** What a visitor sees when a page crashes or a link leads nowhere. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
        <div
          role="alert"
          className="rounded-xl border border-border bg-surface p-6"
        >
          <title>{notFound ? "Page not found" : "Something went wrong"}</title>
          <h1 className="text-xl font-semibold">
            {notFound ? "Page not found" : "Something went wrong"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {notFound
              ? "There is nothing at this address."
              : error instanceof Error && error.message
                ? error.message
                : "An unexpected error occurred."}
          </p>
          <Link to="/" className={`${buttonClass("secondary")} mt-4`}>
            Back to the listings
          </Link>
        </div>
      </main>
    </>
  );
}
