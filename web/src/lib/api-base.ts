import "server-only";

import { z } from "zod";

const DEFAULT_API_URL = "http://localhost:3001/api";

export const API_UNREACHABLE_MESSAGE =
  "The API is unreachable. Check that it is running and try again.";

export function apiBaseUrl(): string {
  const url =
    process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  return url.replace(/\/+$/, "");
}

const errorBodySchema = z.object({
  message: z.union([z.string(), z.array(z.string())]),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

export type ApiIssue = { path: string; message: string };

export type ApiErrorBody = { message: string; issues: ApiIssue[] };

export async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  const fallback = {
    message: `The API responded with status ${response.status}.`,
    issues: [],
  };
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    if (!parsed.success) return fallback;
    const { message, issues = [] } = parsed.data;
    return {
      message: Array.isArray(message) ? message.join("\n") : message,
      issues,
    };
  } catch {
    return fallback;
  }
}

export async function readErrorMessage(response: Response): Promise<string> {
  return (await readErrorBody(response)).message;
}
