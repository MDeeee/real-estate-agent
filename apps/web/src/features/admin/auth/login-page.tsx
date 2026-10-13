import { Navigate, useSearchParams } from "react-router";
import { LoginForm } from "./login-form";
import { useAdminSession } from "./session-api";

export const ADMIN_HOME = "/admin";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const session = useAdminSession();
  const expired = searchParams.get("reason") === "expired";

  // Someone who is already signed in has no use for the form. The API vouches
  // for the session (a cookie alone proves nothing: the token may have been
  // rotated). `expired` means the API just refused this very session.
  if (session.data?.authenticated && !expired) {
    return <Navigate to={ADMIN_HOME} replace />;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <title>Admin login | Real-estate AI agent</title>
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Admin login</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the admin token to manage listings and bookings.
        </p>
        {expired ? (
          <p
            role="status"
            className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
          >
            Your session is no longer valid. Please log in again.
          </p>
        ) : null}
        <LoginForm />
      </div>
    </main>
  );
}
