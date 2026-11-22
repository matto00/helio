import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

import { currentUserId, registerUser } from "./support/auth";

// HEL-1624 -- on a fresh load of /dashboards/:id the app selects that dashboard directly; it never selects the landing
// default (the user's most recent OWNED dashboard) first. A grantee fixture: the user owns A (the landing default) and
// S is shared with them by someone else.
//   Signal 1 (RED on main): the persisted recents (`helio.recentVisits`). recentVisitsListeners records a visit on every
//   non-null selectedDashboardId transition, so a transient selection of A leaves A in the recents. (A `document.title`
//   setter recorder was tried first and stayed green on main: the title never names A, so it is not used.)
//   Signal 2 (GUARD on main): no request keyed on A (`/api/dashboards/A/...`) during the load. The panel fetch is gated on
//   tab hydration, so this is already green on main, and removing that gate alone does NOT turn it red (recorded: with the
//   gate removed and the reducer reverted only the recents assertion fails, see mutation-e2e-gate-and-reducer.txt). What it
//   can prove: a panel fetch for the landing dashboard would be seen. Mutation that turns it red (recorded in
//   mutation-e2e-panel-fetch-landing-default.txt): make App.tsx's `showDashboardPanels` effect target the first owned
//   dashboard instead of `selectedDashboardId`. What it cannot prove: that no realistic regression issues such a request.

const CSRF = { "X-Helio-Requested-With": "1" };
const DEV_PORT = process.env.DEV_PORT ?? "7056";
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RUN = Date.now();
const OWN_NAME = `HEL1624 own landing ${RUN}`;
const SHARED_NAME = `HEL1624 shared target ${RUN}`;

async function actor(browser: Browser, label: string) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  await registerUser(context.request, { prefix: "hel1624", label, displayName: "HEL1624" });
  return { context, id: await currentUserId(context.request) };
}

async function post<T>(context: BrowserContext, url: string, data: unknown): Promise<T> {
  const res = await context.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(201);
  return (await res.json()) as T;
}

test.describe("HEL-1624 direct load selection", () => {
  test.setTimeout(120_000);

  test("a grantee loading /dashboards/S never selects their own landing dashboard first", async ({
    browser,
  }) => {
    const owner = await actor(browser, "owner");
    const grantee = await actor(browser, "grantee");
    try {
      const shared = await post<{ id: string }>(owner.context, "/api/dashboards", {
        name: SHARED_NAME,
      });
      await post(owner.context, `/api/dashboards/${shared.id}/permissions`, {
        granteeId: grantee.id,
        role: "viewer",
      });
      // The grantee's own dashboard is created AFTER the share, so it is their newest owned dashboard (the landing default).
      const own = await post<{ id: string }>(grantee.context, "/api/dashboards", {
        name: OWN_NAME,
      });

      const page = await grantee.context.newPage();
      const ownRequests: string[] = [];
      page.on("request", (request) => {
        const { pathname } = new URL(request.url());
        if (
          pathname.startsWith(`/api/dashboards/${own.id}/`) ||
          pathname === `/api/dashboards/${own.id}`
        ) {
          ownRequests.push(`${request.method()} ${pathname}`);
        }
      });

      await page.goto(`/dashboards/${shared.id}`);
      await expect(page.getByRole("heading", { name: SHARED_NAME }).first()).toBeAttached();
      // Let hydration finish and any late request show up.
      await page.waitForLoadState("networkidle");

      // Every non-null selection transition records a recents visit (recentVisitsListeners), so a transient selection of
      // the landing dashboard leaves its id in the persisted recents even though it is gone a moment later.
      const recents = await page.evaluate(
        () =>
          JSON.parse(window.localStorage.getItem("helio.recentVisits") ?? "[]") as Array<{
            id: string;
          }>,
      );
      expect
        .soft(
          recents.map((r) => r.id),
          "dashboards the load selected (recents); the landing dashboard must not be one of them",
        )
        .not.toContain(own.id);
      expect.soft(recents.map((r) => r.id)).toContain(shared.id);
      expect
        .soft(ownRequests, "requests keyed on the landing dashboard during the load")
        .toEqual([]);
    } finally {
      await owner.context.close();
      await grantee.context.close();
    }
  });
});
