import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ApiError, describeError } from "@/shared/api/http";
import { Button } from "@/shared/ui/button";
import { useLogin } from "./session-api";

const MAX_TOKEN_LENGTH = 512;

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return "That token is not valid.";
  }
  return describeError(error);
}

export function LoginForm() {
  const navigate = useNavigate();
  const login = useLogin();
  const [token, setToken] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const error = validation ?? (login.isError ? loginErrorMessage(login.error) : null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setValidation("Enter the admin token.");
      return;
    }
    setValidation(null);
    login.mutate(trimmed.slice(0, MAX_TOKEN_LENGTH), {
      onSuccess: () => void navigate("/admin", { replace: true }),
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
          value={token}
          onChange={(event) => setToken(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "token-error" : undefined}
          className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {error ? (
          <p id="token-error" role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={login.isPending}
      >
        {login.isPending ? "Checking…" : "Log in"}
      </Button>
    </form>
  );
}
