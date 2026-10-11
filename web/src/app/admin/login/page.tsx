import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ADMIN_COOKIE, ADMIN_HOME, verifyToken } from "@/lib/admin-api";
import { LoginForm } from "./login-form";

export const metadata = { title: "Admin login | Real-estate AI agent" };

export default function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Admin login</h1>
        <p className="mt-2 text-sm text-muted">
          Enter the admin token to manage listings and bookings.
        </p>
        <Suspense
          fallback={
            <div
              aria-hidden
              className="mt-6 h-36 animate-pulse rounded-md bg-border/40"
            />
          }
        >
          <LoginBody searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * Someone who is already signed in has no use for the form. The cookie is
 * checked against the API, so a stale or invalid one still gets the form
 * (a cookie alone proves nothing: the admin token may have been rotated).
 */
async function redirectIfSignedIn(): Promise<void> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return;
  if ((await verifyToken(token)) === "valid") redirect(ADMIN_HOME);
}

async function LoginBody({
  searchParams,
}: {
  searchParams: PageProps<"/admin/login">["searchParams"];
}) {
  const { reason } = await searchParams;
  // `expired` means the API just rejected this very cookie: show the form.
  if (reason !== "expired") await redirectIfSignedIn();

  return (
    <>
      {reason === "expired" ? (
        <p
          role="status"
          className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          Your session is no longer valid. Please log in again.
        </p>
      ) : null}
      <LoginForm />
    </>
  );
}
