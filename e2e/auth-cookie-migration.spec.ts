import {
  expect,
  request as apiRequest,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// HEL-287 — httpOnly-cookie session migration, live verification (design.md
// Migration Plan / tasks.md section 7). Runs against real dev servers
// (frontend Vite proxy + backend Pekko HTTP, same-origin in dev — see
// playwright.config.ts). Exercises: login, register, OAuth callback
// (network-intercepted, mirroring the backend's own stubbed-exchange test
// pattern), an authenticated request via cookie alone, a mutating request's
// CSRF-header requirement, logout clearing the cookie, sessionStorage never
// holding the token, PAT bearer auth being unaffected, and the pipeline
// run-events SSE auth path.

const CSRF_HEADER = "X-Helio-Requested-With";
const SESSION_COOKIE = "helio_session";
const BASE_URL = `http://localhost:${process.env.DEV_PORT ?? "5173"}`;

function uniqueEmail(label: string): string {
  return `hel287-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function sessionCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name === SESSION_COOKIE);
}

async function sessionStorageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.sessionStorage));
}

async function sessionStorageValues(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.sessionStorage).map((k) => window.sessionStorage.getItem(k) ?? ""),
  );
}

test.describe("HEL-287 httpOnly-cookie session migration", () => {
  test("register: sets an HttpOnly session cookie, response body has no token, sessionStorage stays empty", async ({
    page,
    context,
  }) => {
    const email = uniqueEmail("register");
    await page.goto("/register");
    await page.fill("#email", email);
    await page.fill("#password", "correcthorsebattery1");
    await page.fill("#displayName", "E2E Register User");

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/auth/register") && r.request().method() === "POST",
      ),
      page.click("button[type=submit]"),
    ]);

    expect(response.status()).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain('"token"');

    await page.waitForURL("/");

    const cookie = await sessionCookie(context);
    expect(cookie, "helio_session cookie should be set").toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax"); // dev: COOKIE_SECURE unset -> Secure=false -> SameSite=Lax
    expect(cookie?.secure).toBe(false);
    expect(cookie?.path).toBe("/");

    // Alert #8's acceptance check: the raw token must never land in
    // sessionStorage, whatever key shape a regression might reintroduce it under.
    expect(await sessionStorageKeys(page)).toHaveLength(0);
  });

  test("login: sets the session cookie, response body has no token, sessionStorage stays empty", async ({
    page,
    context,
    request,
  }) => {
    const email = uniqueEmail("login");
    const password = "correcthorsebattery1";
    // Bootstrap the account directly via the API (UI registration is already covered above).
    await request.post("/api/auth/register", {
      data: { email, password, displayName: "E2E Login User" },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
      ),
      page.click("button[type=submit]"),
    ]);

    expect(response.status()).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("token");

    await page.waitForURL("/");

    const cookie = await sessionCookie(context);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);

    expect(await sessionStorageKeys(page)).toHaveLength(0);
  });

  test("OAuth callback (network-intercepted exchange): sets the cookie, no token in sessionStorage", async ({
    page,
    context,
  }) => {
    const oauthUser = {
      id: "oauth-e2e-user",
      email: "oauth-e2e@example.com",
      displayName: "OAuth E2E User",
      avatarUrl: null,
      createdAt: "2026-01-01T00:00:00Z",
    };

    // Mirrors the backend's own GoogleOAuthRoutesSpec pattern (stub the
    // Google token/profile exchange) — this test proves the FRONTEND handles
    // the callback response correctly (cookie set, no token in the body it
    // reads, no sessionStorage write), independent of the real Google flow.
    // The fabricated cookie isn't a real backend session, so once the app
    // lands on "/" it fires dashboard-bootstrap requests that would 401
    // against the real backend and trigger httpClient's global redirect —
    // stub every other /api/** call to 200 too, so nothing else races the
    // assertions below with a hard `window.location` navigation.
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/auth/google/callback")) {
        await route.fulfill({
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": `${SESSION_COOKIE}=e2e-oauth-fake-session-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          },
          body: JSON.stringify({ expiresAt: "2026-12-31T00:00:00Z", user: oauthUser }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    });

    await page.goto("/auth/callback?code=fake-code&state=fake-state");
    await page.waitForURL("/");

    const cookie = await sessionCookie(context);
    expect(cookie?.value).toBe("e2e-oauth-fake-session-token");
    expect(cookie?.httpOnly).toBe(true);

    expect(await sessionStorageKeys(page)).toHaveLength(0);
  });

  test("authenticated GET succeeds via the cookie alone, and never via a manual Authorization header", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("getdash");
    const password = "correcthorsebattery1";
    await request.post("/api/auth/register", {
      data: { email, password },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    // page.request shares the browser context's cookie jar; no Authorization
    // header is attached — this is exactly what httpClient.ts does now.
    const response = await page.request.get("/api/dashboards");
    expect(response.status()).toBe(200);
  });

  test("CSRF: a mutating request without the header is rejected (403); with the header, it succeeds", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("csrf");
    const password = "correcthorsebattery1";
    await request.post("/api/auth/register", {
      data: { email, password },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    const withoutHeader = await page.request.post("/api/dashboards", {
      data: { name: "Should be rejected" },
    });
    expect(withoutHeader.status()).toBe(403);

    const withHeader = await page.request.post("/api/dashboards", {
      data: { name: "Should succeed" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(withHeader.status()).toBe(201);
  });

  test("logout clears the cookie; a subsequent authenticated request returns 401", async ({
    page,
    context,
    request,
  }) => {
    const email = uniqueEmail("logout");
    const password = "correcthorsebattery1";
    // Use the isolated `request` fixture (not `page.request`) to bootstrap
    // the account — `page.request` shares the browser context's cookie jar,
    // which would authenticate the page itself and make PublicOnlyRoute
    // redirect away from /login before the form can be filled.
    await request.post("/api/auth/register", {
      data: { email, password },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    expect(await sessionCookie(context)).toBeDefined();

    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/login");

    const cookieAfterLogout = await sessionCookie(context);
    expect(cookieAfterLogout, "cookie should be cleared by the expired Set-Cookie").toBeUndefined();

    const response = await page.request.get("/api/dashboards");
    expect(response.status()).toBe(401);
  });

  test("PAT bearer auth (helio-mcp-style) still authenticates unchanged, independent of the session cookie", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("pat");
    const password = "correcthorsebattery1";
    await request.post("/api/auth/register", {
      data: { email, password },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    // Mint a PAT the same way a real user would from the UI's token
    // management flow: an authenticated (cookie + CSRF) POST /api/tokens.
    const createRes = await page.request.post("/api/tokens", {
      data: { name: "e2e-pat" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(createRes.status()).toBe(201);
    const { token: rawPat } = (await createRes.json()) as { token: string };
    expect(rawPat).toMatch(/^helio_pat_[0-9a-f]{64}$/);

    // A brand-new request context with NO cookies at all, bearer-token only —
    // exactly the helio-mcp / non-browser client shape (HEL-148). Uses the
    // top-level `request` factory (aliased apiRequest), not the `request`
    // *fixture* (which is already a bound context and has no .newContext()).
    const patContext = await apiRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${rawPat}` },
    });
    const patResponse = await patContext.get("/api/dashboards");
    expect(patResponse.status()).toBe(200);
    await patContext.dispose();

    // No credential at all still 401s (sanity check on the same endpoint).
    const anonContext = await apiRequest.newContext({ baseURL: BASE_URL });
    const anonResponse = await anonContext.get("/api/dashboards");
    expect(anonResponse.status()).toBe(401);
    await anonContext.dispose();
  });

  test("pipeline run-events SSE endpoint authenticates via the session cookie alone (not a header)", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("sse");
    const password = "correcthorsebattery1";
    // See the logout test above for why this must be the isolated `request`
    // fixture, not `page.request`.
    await request.post("/api/auth/register", {
      data: { email, password },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    expect(await sessionStorageValues(page)).toHaveLength(0);

    // A syntactically-valid but non-existent pipeline id for this fresh
    // user — a 404 (business logic) rather than a 401 (auth) is exactly the
    // signal that the cookie authenticated the request, matching
    // usePipelineRunEvents.ts's `credentials: "include"` fetch (no
    // Authorization header at all).
    const response = await page.request.get(
      "/api/pipelines/00000000-0000-0000-0000-000000000000/run-events",
    );
    expect(response.status()).toBe(404);
  });
});
