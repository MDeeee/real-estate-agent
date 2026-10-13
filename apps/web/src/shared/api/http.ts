import { z } from "zod";

/** The API lives on the same origin as the app: in production NestJS serves both, in development Vite proxies `/api`. */
export const API_BASE = "/api";

/**
 * Sent with every request. The API refuses state-changing requests without it
 * (CSRF defence): a plain cross-site form or image cannot set a custom header.
 */
export const CSRF_HEADERS = { "X-Requested-With": "fetch" } as const;

export const API_UNREACHABLE_MESSAGE =
  "The API is unreachable. Check that it is running and try again.";
const UNEXPECTED_RESPONSE_MESSAGE = "The API returned an unexpected response.";
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ApiIssue {
  path: string;
  message: string;
}

/** A request the API refused, or could not answer. `status` 503 also stands for "unreachable". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ApiIssue[] = [],
    /** Seconds from the `Retry-After` header of a 429 or 503. */
    readonly retryAfterSeconds?: number,
    /** Whether `message` is the API's own text (not the status fallback). */
    readonly hasServerMessage = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const errorBodySchema = z.object({
  message: z.union([z.string(), z.array(z.string())]),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

/** A longer `Retry-After` is not worth showing as a countdown. */
const MAX_RETRY_AFTER_SECONDS = 3600;

function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_RETRY_AFTER_SECONDS
    ? seconds
    : undefined;
}

/** Turns a non-2xx response into an `ApiError`, using the API's own message when it sent one. */
export async function toApiError(response: Response): Promise<ApiError> {
  let message = `The API responded with status ${response.status}.`;
  let issues: ApiIssue[] = [];
  let hasServerMessage = false;
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      message = Array.isArray(parsed.data.message)
        ? parsed.data.message.join("\n")
        : parsed.data.message;
      issues = parsed.data.issues ?? [];
      hasServerMessage = true;
    }
  } catch {
    // No readable body: the status message stands.
  }
  return new ApiError(
    response.status,
    message,
    issues,
    retryAfterSeconds(response),
    hasServerMessage,
  );
}

export type ApiFetchInit = Omit<RequestInit, "body"> & {
  /** Sent as a JSON body. */
  json?: unknown;
  /** Sent as is (multipart uploads); the browser sets the content type. */
  body?: FormData;
};

/**
 * `fetch` for the API: path relative to `/api`, CSRF header, JSON bodies. A
 * non-2xx answer is returned as is (the SSE client reads its status); network
 * failures become an `ApiError`, aborts pass through untouched.
 */
export async function apiFetch(
  path: string,
  { json, headers, ...init }: ApiFetchInit = {},
): Promise<Response> {
  const merged = new Headers(headers);
  for (const [name, value] of Object.entries(CSRF_HEADERS)) {
    merged.set(name, value);
  }
  if (json !== undefined) merged.set("content-type", "application/json");

  try {
    return await fetch(`${API_BASE}${path}`, {
      credentials: "same-origin",
      ...init,
      headers: merged,
      body: json !== undefined ? JSON.stringify(json) : init.body,
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(503, API_UNREACHABLE_MESSAGE);
  }
}

/** A request whose successful answer has no body. */
export async function requestVoid(
  path: string,
  init: ApiFetchInit = {},
): Promise<void> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await toApiError(response);
  await response.body?.cancel().catch(() => undefined);
}

/** A request whose answer is JSON, checked against `schema`. */
export async function request<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init: ApiFetchInit = {},
): Promise<z.output<TSchema>> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await toApiError(response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(502, UNEXPECTED_RESPONSE_MESSAGE);
  return parsed.data;
}

/** A sentence for the screen: the API's message, or how long to wait after a 429. */
export function describeError(
  error: unknown,
  fallback = GENERIC_ERROR_MESSAGE,
): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 429 && error.retryAfterSeconds !== undefined) {
    return `Too many requests. Please wait ${Math.ceil(error.retryAfterSeconds)} seconds and try again.`;
  }
  return error.message;
}
