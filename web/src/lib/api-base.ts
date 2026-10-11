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
});

export async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `The API responded with status ${response.status}.`;
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    if (!parsed.success) return fallback;
    const { message } = parsed.data;
    return Array.isArray(message) ? message.join("\n") : message;
  } catch {
    return fallback;
  }
}
