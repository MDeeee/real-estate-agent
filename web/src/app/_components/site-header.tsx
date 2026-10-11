import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Real-estate AI agent
        </Link>
        <nav aria-label="Primary">
          <Link
            href="/admin"
            className="text-sm text-muted transition-colors hover:text-foreground"
          >
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
