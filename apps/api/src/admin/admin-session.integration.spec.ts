import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import { createChatIntegrationApp } from '../testing/chat-integration-app.js';
import { FakeEmbeddings } from '../testing/fake-embeddings.js';
import { CSRF_HEADERS, TEST_ADMIN_TOKEN } from '../testing/integration-app.js';
import { ADMIN_SESSION_COOKIE } from './admin-session.service.js';

const databaseUrl = inject('integrationDatabaseUrl');

describe.skipIf(!databaseUrl)('admin session (integration)', () => {
  let created: Awaited<ReturnType<typeof createChatIntegrationApp>>;
  let sessionUrl: string;

  beforeAll(async () => {
    created = await createChatIntegrationApp(databaseUrl as string, {
      embeddings: new FakeEmbeddings(),
      // Each test is a different visitor (see `call`), so the login throttle of
      // one test cannot affect another.
      env: { TRUSTED_PROXY_HOPS: '1' },
    });
    sessionUrl = `${created.apiUrl}/admin/session`;
  });

  afterAll(async () => {
    await created?.app.close();
  });

  let visitorCount = 0;
  let visitorIp = '';
  beforeEach(() => {
    visitorCount += 1;
    visitorIp = `203.0.113.${visitorCount}`;
  });

  /** `fetch` as the current test's visitor. */
  function call(
    url: string,
    init: Omit<RequestInit, 'headers'> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { 'x-forwarded-for': visitorIp, ...init.headers },
    });
  }

  function login(
    token: string,
    headers: Record<string, string> = CSRF_HEADERS,
  ) {
    return call(sessionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ token }),
    });
  }

  /** The `name=value` pair of a Set-Cookie header, as a browser sends it back. */
  function cookiePair(response: Response): string {
    const setCookie = response.headers.get('set-cookie') ?? '';
    return setCookie.split(';')[0] ?? '';
  }

  it('logs in with the admin token and sets an httpOnly, SameSite=Strict cookie scoped to the admin endpoints', async () => {
    const response = await login(TEST_ADMIN_TOKEN);

    expect(response.status).toBe(204);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api/admin');
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).not.toContain('Secure');
    expect(setCookie).not.toContain(TEST_ADMIN_TOKEN);
  });

  it('rejects a wrong token without setting a cookie', async () => {
    const response = await login('not-the-admin-token');

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a login without the X-Requested-With header', async () => {
    const response = await login(TEST_ADMIN_TOKEN, {});

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a malformed login body', async () => {
    const response = await call(sessionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...CSRF_HEADERS },
      body: JSON.stringify({ password: 'x' }),
    });

    expect(response.status).toBe(400);
  });

  it('reports whether the caller is signed in', async () => {
    const anonymous = await call(sessionUrl);
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toEqual({ authenticated: false });

    const cookie = cookiePair(await login(TEST_ADMIN_TOKEN));
    const signedIn = await call(sessionUrl, { headers: { cookie } });
    expect(await signedIn.json()).toEqual({ authenticated: true });

    const forged = await call(sessionUrl, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${TEST_ADMIN_TOKEN}` },
    });
    expect(await forged.json()).toEqual({ authenticated: false });
  });

  it('lets the session cookie reach the admin endpoints, and nothing else does', async () => {
    const url = `${created.apiUrl}/admin/bookings`;
    expect((await call(url)).status).toBe(401);

    const cookie = cookiePair(await login(TEST_ADMIN_TOKEN));
    expect((await call(url, { headers: { cookie } })).status).toBe(200);
  });

  it('refuses state-changing admin requests without the header, even when authenticated', async () => {
    const cookie = cookiePair(await login(TEST_ADMIN_TOKEN));
    const response = await call(`${created.apiUrl}/admin/documents`, {
      method: 'POST',
      headers: { cookie },
      body: new FormData(),
    });

    expect(response.status).toBe(403);
  });

  it('logs out by expiring the cookie', async () => {
    const response = await call(sessionUrl, {
      method: 'DELETE',
      headers: CSRF_HEADERS,
    });

    expect(response.status).toBe(204);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=;`);
    expect(setCookie).toContain('Path=/api/admin');
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('throttles login attempts', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      statuses.push((await login('guess')).status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('throttles guesses of the token header on every admin endpoint', async () => {
    const guess = (url: string) =>
      call(url, { headers: { 'x-admin-token': 'guess' } });
    for (let i = 0; i < 5; i += 1) {
      expect((await guess(`${created.apiUrl}/admin/bookings`)).status).toBe(
        401,
      );
    }

    const refused = await guess(sessionUrl);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
    });
    const right = await call(sessionUrl, {
      headers: { 'x-admin-token': TEST_ADMIN_TOKEN },
    });
    expect(right.status).toBe(429);
  });
});
