import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { endSessionOnUnauthorized } from "@/features/admin/auth/session-api";
import { ApiError } from "@/shared/api/http";

const MAX_RETRIES = 2;

/**
 * Failed requests are retried only when trying again can help: a 4xx answer
 * (bad filters, not signed in, rate limited) would just fail again.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  const refused = error instanceof ApiError && error.status < 500;
  return !refused && failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => endSessionOnUnauthorized(client, error),
    }),
    mutationCache: new MutationCache({
      onError: (error) => endSessionOnUnauthorized(client, error),
    }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000 },
    },
  });
  return client;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
