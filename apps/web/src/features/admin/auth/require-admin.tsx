import { Navigate, Outlet } from "react-router";
import { describeError } from "@/shared/api/http";
import { Button } from "@/shared/ui/button";
import { useAdminSession } from "./session-api";

export const LOGIN_PATH = "/admin/login";

/** Route guard: the admin pages render only for a visitor with a valid admin session. */
export function RequireAdmin() {
  const session = useAdminSession();

  if (session.isPending) {
    return (
      <p role="status" className="px-4 py-16 text-center text-sm text-muted">
        Checking your session…
      </p>
    );
  }
  if (session.isError) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        <div role="alert" className="rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">Could not check your session</h1>
          <p className="mt-2 text-sm text-muted">{describeError(session.error)}</p>
          <Button className="mt-4" onClick={() => void session.refetch()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }
  if (!session.data.authenticated) {
    return (
      <Navigate
        to={session.data.expired ? `${LOGIN_PATH}?reason=expired` : LOGIN_PATH}
        replace
      />
    );
  }
  return <Outlet />;
}
