# 0005. Vite SPA served by NestJS, replacing Next.js

Date: 2026-10-13
Status: Accepted. Supersedes the earlier choice of Next.js (App Router) for the frontend.

## Context

This is a proof of concept with one landing page (chat plus filter search) and one admin area behind a shared secret. Nothing in it needs server-side rendering: the content is a live catalogue behind filters and an AI chat, and no page has to be indexed by search engines.

Next.js still shaped the architecture. Its server components, server actions and route handlers made it a second server in front of the API, so we added a backend-for-frontend layer: route handlers that proxied chat (stream, history, reset) and set the conversation cookie, server actions that held the admin token in a cookie, and a middleware that redirected `/admin`. Because the API then only ever saw the Next.js server as its client, per-visitor rate limiting needed an `INTERNAL_API_KEY`, an `x-client-ip` header, and `TRUSTED_PROXY_HOPS` logic in the web app to rebuild the visitor's address from `X-Forwarded-For`. No feature needed any of this.

## Decision

Replace the Next.js app with a Vite + React single-page app (React Router, TanStack Query, Tailwind 4) that NestJS serves from the same origin: built files at `/`, `index.html` for client-side routes, `/api` for the API. The two apps live in `apps/api` and `apps/web`.

- The browser talks to the API directly, with relative URLs. In development Vite proxies `/api` to NestJS.
- The API owns the cookies: the `chat_thread` conversation cookie and an `admin_session` cookie issued by `POST /api/admin/session`, both `HttpOnly`.
- Same origin plus `SameSite` cookies covers most CSRF risk; state-changing requests additionally require an `X-Requested-With: fetch` header. There is no CORS configuration.
- Rate limiting uses the real request IP through Express `trust proxy`, set from `TRUSTED_PROXY_HOPS`. `INTERNAL_API_KEY` and `x-client-ip` are removed.

## Consequences

- One process, one origin, one port in production; no proxy layer to keep in sync with the API, and noticeably less code (no route handlers, server actions or middleware).
- Throttling is simpler and harder to get wrong: the API sees the visitor, and a forged `X-Forwarded-For` has no effect unless proxies are explicitly trusted.
- No server-side rendering: first paint waits for the JavaScript bundle and the first API call, and the pages are not indexable by crawlers that do not run scripts. Acceptable for this product; if public listing pages ever need SEO, add them as server-rendered or pre-rendered routes in front of the same API.
- Deploying the API now also means deploying the web build (`pnpm build`, then `pnpm start`). The API starts without a build (it logs a warning and serves only `/api`).
- Admin sessions are signed, expiring cookies verified without server-side storage, so logging out clears the cookie but does not revoke a copied one before it expires (8 hours); changing `ADMIN_TOKEN` or restarting the API (the signing key is derived from the token with a per-process random salt) invalidates all of them.
