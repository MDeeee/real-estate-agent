import { Link, Outlet, useNavigate } from "react-router";
import { Button } from "@/shared/ui/button";
import { useLogout } from "./auth/session-api";

/** The admin area's frame: header with the way back to the site and "Log out". */
export function AdminLayout() {
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <div className="flex-1">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-muted hover:text-foreground">
              &larr; Site
            </Link>
            <span className="text-sm font-semibold">Admin</span>
          </div>
          <Button
            variant="ghost"
            disabled={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                onSuccess: () => void navigate("/admin/login", { replace: true }),
              })
            }
          >
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
