import "server-only";

import { headers } from "next/headers";

export const INTERNAL_KEY_HEADER = "x-internal-key";
export const CLIENT_IP_HEADER = "x-client-ip";

/**
 * Headers that let the API rate-limit per visitor instead of per web server.
 *
 * Server-rendered pages call the API from this server, so without them every
 * visitor shares one IP and one budget. The API only honours `x-client-ip`
 * when `x-internal-key` matches its INTERNAL_API_KEY. The visitor IP comes
 * from the proxy headers of the incoming request: the first `x-forwarded-for`
 * entry, else `x-real-ip`; when neither exists nothing is sent.
 *
 * Reads request headers, so call it from code that renders dynamically.
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return {};

  const incoming = await headers();
  const forwardedFor = incoming.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || incoming.get("x-real-ip")?.trim();
  if (!ip) return {};

  return { [INTERNAL_KEY_HEADER]: key, [CLIENT_IP_HEADER]: ip };
}
