import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, request, requestVoid } from "@/shared/api/http";

/**
 * Whether the browser holds a valid admin session. The session cookie is
 * httpOnly, so the page can only ask the API. `expired` marks a session that
 * the API just refused (401), so the login page can say so.
 */
export interface SessionState {
  authenticated: boolean;
  expired?: boolean;
}

const sessionSchema = z.object({ authenticated: z.boolean() });

export const adminSessionKey = ["admin", "session"] as const;

export function useAdminSession() {
  return useQuery({
    queryKey: adminSessionKey,
    queryFn: ({ signal }): Promise<SessionState> =>
      request("/admin/session", sessionSchema, { signal }),
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      requestVoid("/admin/session", { method: "POST", json: { token } }),
    onSuccess: () =>
      queryClient.setQueryData<SessionState>(adminSessionKey, {
        authenticated: true,
      }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestVoid("/admin/session", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueryData<SessionState>(adminSessionKey, {
        authenticated: false,
      });
      // Nothing of the admin area may stay in memory for the next person.
      queryClient.removeQueries({
        queryKey: ["admin"],
        predicate: (query) => query.queryKey[1] !== "session",
      });
    },
  });
}

/**
 * Called for every failed request: when the API says the admin session is no
 * longer valid, every admin screen learns it at once and sends the visitor to
 * the login page.
 */
export function endSessionOnUnauthorized(
  queryClient: QueryClient,
  error: unknown,
): void {
  const signedIn =
    queryClient.getQueryData<SessionState>(adminSessionKey)?.authenticated;
  // A refused login (also 401) happens while signed out: nothing expired.
  if (signedIn && error instanceof ApiError && error.status === 401) {
    queryClient.setQueryData<SessionState>(adminSessionKey, {
      authenticated: false,
      expired: true,
    });
  }
}
