import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-muted hover:text-foreground">
              &larr; Site
            </Link>
            <span className="text-sm font-semibold">Admin</span>
          </div>
          <form action={logout}>
            <Button type="submit" variant="ghost">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
