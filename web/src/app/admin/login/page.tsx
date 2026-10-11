import { Suspense } from "react";
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
        <Suspense fallback={null}>
          <ExpiredNotice searchParams={searchParams} />
        </Suspense>
        <LoginForm />
      </div>
    </main>
  );
}

async function ExpiredNotice({
  searchParams,
}: {
  searchParams: PageProps<"/admin/login">["searchParams"];
}) {
  const { reason } = await searchParams;
  if (reason !== "expired") return null;
  return (
    <p
      role="status"
      className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
    >
      Your session is no longer valid. Please log in again.
    </p>
  );
}
