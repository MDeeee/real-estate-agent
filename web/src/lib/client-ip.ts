import { isIP } from "node:net";

/**
 * Number of trusted reverse proxies between the internet and this Next.js
 * server (env `TRUSTED_PROXY_HOPS`). Anything that is not a non-negative
 * integer counts as 0: the safe answer is "trust nothing".
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || !/^\d{1,2}$/.test(raw.trim())) return 0;
  return Number(raw.trim());
}

/**
 * The visitor's IP from an `x-forwarded-for` value, or `undefined` when it
 * cannot be known safely.
 *
 * Why the rightmost entries: a visitor can send any `x-forwarded-for` they like,
 * and every proxy APPENDS the address of the peer it talked to. So the left
 * side is attacker-controlled, and only the entries our own proxies added on
 * the right can be believed. Next.js (observed on 16.4, `next dev` and
 * `next start`) leaves a present header untouched and does not append the
 * socket address, so with N trusted proxies the list ends
 * `[..., visitor, proxy1, ..., proxyN-1]` and the visitor is entry
 * `length - N`.
 *
 * With 0 trusted proxies the header is entirely client-controlled (Next only
 * fills it in when it is absent, which cannot be told apart from a forged
 * value), so no IP is derived and the API counts this server's own address.
 * A header with fewer entries than proxies was not built by our proxies and is
 * rejected, as is anything that is not an IP address.
 */
export function clientIpFromForwardedFor(
  header: string | null | undefined,
  trustedProxyHops: number,
): string | undefined {
  if (!header || trustedProxyHops < 1) return undefined;
  const entries = header.split(",").map((entry) => entry.trim());
  const index = entries.length - trustedProxyHops;
  if (index < 0) return undefined;
  const candidate = entries[index];
  return candidate && isIP(candidate) !== 0 ? candidate : undefined;
}
