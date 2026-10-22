import { expect, test } from "@playwright/test";

// HEL-1691: fail-closed guard for the `prod-build` project. Every `@prod-build` test depends on this one, so a tag alone
// is guarded. It fetches baseURL's HTML directly (independent of any test's navigation) and fails unless the server is
// serving a production build: a 2xx response, no Vite dev client, and a hashed module script under /assets/. `/` is the
// landing page and `/pipelines` is the SPA shell (app.html); the shell is the one that must carry the hashed bundle.
test("baseURL serves a production build, not the Vite dev server", async ({ request }) => {
  for (const path of ["/", "/pipelines"]) {
    const res = await request.get(path);
    expect(res.status(), `${path} status`).toBeLessThan(300);
    expect(res.status(), `${path} status`).toBeGreaterThanOrEqual(200);
    const html = await res.text();
    expect(html, `${path} must not load the Vite dev client`).not.toContain("/@vite/client");
    if (path === "/pipelines") {
      expect(html, `${path} must reference a hashed /assets/*.js module script`).toMatch(
        /<script[^>]+type="module"[^>]+src="\/assets\/[^"]+\.js"/,
      );
    }
  }
});
