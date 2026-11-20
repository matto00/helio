import {
  expect,
  request as apiRequest,
  test,
  type APIRequestContext,
  type Page,
  type Request,
} from "@playwright/test";

import { currentUserId, registerUser, type Credentials } from "./support/auth";
import { isolateLivePage, uiLogin } from "./support/isolateLivePage";

// HEL-1634 -- sign-out must discard every per-user client cache. User A signs in, opens a dashboard
// (panel list, rows, run history), opens the provenance popover and records a palette recent; A
// signs out; user B signs in on the SAME page with no full document load. Nothing of A's may be
// visible to B, and no request B's session sends may carry any id of A's (this includes the Home
// summary request's viewed-dashboard ids, which come from a localStorage store that is not keyed
// by user).

const CSRF = { "X-Helio-Requested-With": "1" };
const BASE_URL = `http://localhost:${process.env.DEV_PORT ?? "5173"}`;
const A_BOARD = "HEL-1634 A private board";
const A_PANEL = "HEL-1634 A revenue";
const B_BOARD = "HEL-1634 B board";
const B_PANEL = "HEL-1634 B revenue";

interface Workspace {
  source: string;
  pipeline: string;
  output: string;
  dashboard: string;
  panel: string;
}

async function post<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status = 201,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** One dashboard with one metric panel over a real pipeline run, so history and provenance exist. */
async function seedWorkspace(
  request: APIRequestContext,
  names: { board: string; panel: string; rows: number[] },
): Promise<Workspace> {
  const source = await post<{ id: string }>(request, "/api/data-sources", {
    name: `${names.board} source`,
    type: "static",
    columns: [
      { name: "region", type: "string" },
      { name: "amount", type: "integer" },
    ],
    rows: names.rows.map((amount, i) => [`r${i}`, amount]),
  });
  const pipeline = await post<{ id: string }>(request, "/api/pipelines", {
    name: `${names.board} pipeline`,
    roots: [{ sourceId: source.id }],
  });
  const output = await post<{ id: string }>(request, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "metric",
    name: names.panel,
    config: {
      fieldMapping: {},
      aggregation: { value: "amount", agg: "sum" },
      format: "integer",
    },
  });
  const dashboard = await post<{ id: string }>(request, "/api/dashboards", { name: names.board });
  const run = await request.post(`/api/pipelines/${pipeline.id}/run`, { data: {}, headers: CSRF });
  expect(run.status(), await run.text()).toBe(200);
  const panel = await post<{ id: string }>(request, "/api/panels", {
    dashboardId: dashboard.id,
    title: names.panel,
    type: "output",
    config: { outputId: output.id },
  });
  return {
    source: source.id,
    pipeline: pipeline.id,
    output: output.id,
    dashboard: dashboard.id,
    panel: panel.id,
  };
}

async function openPalette(page: Page) {
  await page.getByRole("button", { name: "Search, jump, or ask" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Search commands" })).toBeVisible();
  return dialog;
}

test.describe("HEL-1634 sign-out then another user on the same tab", () => {
  test("user B sees nothing of user A's dashboards, panels, history, provenance or recents, and sends no request with A's ids", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1504, height: 900 });

    // ---- A: real data, opened in the UI ----
    const a = await registerUser(request, {
      prefix: "hel1634",
      label: "a",
      displayName: "HEL-1634",
    });
    const userA = await currentUserId(request);
    console.log(`[HEL-1634 e2e] user A id: ${userA}`);
    const wsA = await seedWorkspace(request, {
      board: A_BOARD,
      panel: A_PANEL,
      rows: [4000, 3731],
    });
    const aIds = Object.values(wsA);

    await uiLogin(page, a);
    await page.goto(`/dashboards/${wsA.dashboard}`);
    const cardA = page.locator(".react-grid-item", { hasText: A_PANEL });
    await expect(cardA.getByText("7,731", { exact: true })).toBeVisible({ timeout: 15_000 });
    await cardA.getByRole("button", { name: "Data provenance" }).click();
    await expect(page.getByRole("dialog", { name: /Data provenance/ })).toBeVisible();
    await page.keyboard.press("Escape");
    // The precondition: A's own palette really lists the board A just visited.
    const paletteA = await openPalette(page);
    await expect(paletteA.getByText(A_BOARD).first()).toBeVisible();
    await page.keyboard.press("Escape");

    // ---- A signs out; from here on there must be no full document load ----
    const sentinel = `hel1634-${Math.random().toString(36).slice(2)}`;
    await page.evaluate((t) => {
      (window as unknown as Record<string, string>).__hel1634NoReload = t;
    }, sentinel);
    const documentRequests: string[] = [];
    page.on("request", (req: Request) => {
      if (req.resourceType() === "document" && req.frame() === page.mainFrame())
        documentRequests.push(req.url());
    });
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL("/login");

    // ---- B: a different user, on the same page ----
    const apiB = await apiRequest.newContext({ baseURL: BASE_URL });
    try {
      const b: Credentials = await registerUser(apiB, {
        prefix: "hel1634",
        label: "b",
        displayName: "HEL-1634",
      });
      const wsB = await seedWorkspace(apiB, { board: B_BOARD, panel: B_PANEL, rows: [100, 22] });

      const sent: { url: string; body: string }[] = [];
      // No request B's session sends carries an id of A's (URL or body). Soft, so a run against
      // unfixed code reports this beside the visible leaks instead of stopping at the first.
      const assertNoLeak = () => {
        const leaks = sent.filter((req) =>
          aIds.some((id) => req.url.includes(id) || req.body.includes(id)),
        );
        expect
          .soft(
            leaks.map((req) => req.url),
            "requests in B's session that carry an id of user A's",
          )
          .toEqual([]);
      };
      page.on("request", (req: Request) => {
        if (req.url().includes("/api/")) sent.push({ url: req.url(), body: req.postData() ?? "" });
      });

      await page.fill("#email", b.email);
      await page.fill("#password", b.password);
      await page.click("button[type=submit]");
      await page.waitForURL("/home", { waitUntil: "commit" });
      // Home has loaded its summary by now: that request must not carry A's viewed dashboard ids.
      await page.waitForTimeout(2_000);
      assertNoLeak();
      await page.getByRole("link", { name: "Dashboards" }).first().click();
      // The list B is shown must never hold A's board, not even before B's own list arrives.
      await expect.soft(page.getByText(A_BOARD)).toHaveCount(0);
      await page.getByText(B_BOARD).first().click();
      const cardB = page.locator(".react-grid-item", { hasText: B_PANEL });
      await expect(cardB.getByText("122", { exact: true })).toBeVisible({ timeout: 15_000 });
      await cardB.getByRole("button", { name: "Data provenance" }).click();
      await expect(page.getByRole("dialog", { name: /Data provenance/ })).toBeVisible();
      await page.keyboard.press("Escape");
      const paletteB = await openPalette(page);
      await expect(paletteB.getByText(B_BOARD).first()).toBeVisible();
      await expect(paletteB.getByText(A_BOARD)).toHaveCount(0);
      await page.keyboard.press("Escape");
      // Let any late response from the earlier session land before asserting.
      await page.waitForTimeout(1_500);

      const body = (await page.locator("body").innerText()) + (await page.content());
      expect(body).not.toContain(A_BOARD);
      expect(body).not.toContain(A_PANEL);
      expect(body).not.toContain("7,731");
      expect(
        await page.evaluate(() => window.localStorage.getItem("helio.recentVisits") ?? ""),
      ).not.toContain(wsA.dashboard);
      expect(
        await page.evaluate(() => window.localStorage.getItem("helio.dashboardSeen") ?? ""),
      ).not.toContain(wsA.dashboard);

      assertNoLeak();
      expect(documentRequests, "full document loads between A's sign-out and B's view").toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, string>).__hel1634NoReload ?? null,
        ),
        "window sentinel lost: a full document load replaced the page",
      ).toBe(sentinel);

      await apiB.delete(`/api/dashboards/${wsB.dashboard}`, { headers: CSRF });
    } finally {
      await apiB.dispose();
      await isolateLivePage(page).catch(() => undefined);
    }
  });
});
