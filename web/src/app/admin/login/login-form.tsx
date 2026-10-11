"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

const initial: LoginState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initial);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="token" className="block text-sm font-medium">
          Admin token
        </label>
        <input
          id="token"
          name="token"
          type="password"
          required
          autoComplete="current-password"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "token-error" : undefined}
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {state.error ? (
          <p id="token-error" role="alert" className="mt-2 text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={pending}
      >
        {pending ? "Checking…" : "Log in"}
      </Button>
    </form>
  );
}
