import "server-only";

import { headers } from "next/headers";
import {
  clientIpFromForwardedFor,
  parseTrustedProxyHops,
} from "./client-ip";

export const INTERNAL_KEY_HEADER = "x-internal-key";
export const CLIENT_IP_HEADER = "x-client-ip";

/**
 * Headers that let the API rate-limit per visitor instead of per web server.
 *
 * Server-rendered pages call the API from this server, so without them every
 * visitor shares one IP and one budget. The API only honours `x-client-ip`
 * when `x-internal-key` matches its INTERNAL_API_KEY.
 *
 * The visitor IP is taken from the RIGHT of `x-forwarded-for`, counting the
 * `TRUSTED_PROXY_HOPS` proxies we run in front of Next (default 0 = none, so
 * no IP is sent and everyone shares the web server's budget). The left side of
 * that header is chosen by the visitor and is never used; `x-real-ip` is not
 * used either. See `clientIpFromForwardedFor` and the README deployment notes.
 *
 * Reads request headers, so call it from code that renders dynamically.
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  const key = process.env.INTERNAL_API_KEY;
  if (!key) return {};

  const ip = clientIpFromForwardedFor(
    (await headers()).get("x-forwarded-for"),
    parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS),
  );
  if (!ip) return {};

  return { [INTERNAL_KEY_HEADER]: key, [CLIENT_IP_HEADER]: ip };
}
