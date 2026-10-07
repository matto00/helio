import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { backdateHistory, historyRowCount } from "./support/historySeed";
import { isolateLivePage } from "./support/isolateLivePage";
import { registerAndLogin } from "./support/auth";

// HEL-1275 — exit criterion of the metric history UI: a metric panel reads "1,204 ▲ 12% vs 7d" with
// a sparkline, from REAL history. Two real pipeline runs write the history (sum 1075, then sum
// 1204); only the first run's `captured_at` is moved back 7d1h (support/historySeed.ts, selected by
// this test's own output_id, ids recorded). The 7-day comparison is chosen through the Output
// editor UI — never seeded — so the picker, the PATCH and the render are proven as one chain.
// Run in both themes; screenshots land in the change dir. Cleans up by exact recorded ids.

const CSRF = { "X-Helio-Requested-With": "1" };
const SHOTS = resolve(
  __dirname,
  "../openspec/changes/archive/2026-10-05-metric-delta-sparkline-ui/screenshots",
);

const AUTH = { prefix: "hel1275", displayName: "HEL-1275" } as const;

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** Waits until a locator's box is unchanged across consecutive reads. After a viewport resize the
 *  grid reflows over several frames; a click on a button whose position is still moving lands on
 *  the card body instead (CI race: it opened the panel detail modal, not the popover). */
async function layoutSettled(locator: Locator) {
  const reads: string[] = [];
  await expect
    .poll(
      async () => {
        reads.push(JSON.stringify(await locator.boundingBox()));
        const last = reads.slice(-4);
        return last.length === 4 && last[0] !== "null" && last.every((r) => r === last[0]);
      },
      { timeout: 15_000, intervals: [50, 100, 100, 100, 250] },
    )
    .toBe(true);
}

/** Sets the viewport width and waits for the card to REFLOW to it: first until the card's width
 *  differs from its pre-resize width, then until the box stops changing. `layoutSettled` alone
 *  passes vacuously on four reads taken at the OLD size right after `setViewportSize`, before the
 *  grid has reflowed (HEL-1327). When the viewport is already `width` nothing resizes, so only the
 *  settle runs. */
async function resizeAndSettle(page: Page, card: Locator, width: number) {
  const before = (await card.boundingBox())?.width ?? null;
  expect(before, "card has no box before the resize").not.toBeNull();
  const resizes = page.viewportSize()?.width !== width;
  await page.setViewportSize({ width, height: 900 });
  if (resizes) {
    await expect
      .poll(async () => (await card.boundingBox())?.width ?? null, {
        timeout: 15_000,
        intervals: [50, 100, 100, 100, 250],
        message: `card width never changed from ${before}px after resizing the viewport to ${width}px`,
      })
      .not.toBe(before);
  }
  await layoutSettled(card);
}

async function runPipeline(request: APIRequestContext, pipelineId: string) {
  // Synchronous: the 200 returns after the history insert.
  const res = await request.post(`/api/pipelines/${pipelineId}/run`, { data: {}, headers: CSRF });
  expect(res.status(), await res.text()).toBe(200);
}

for (const theme of ["light", "dark"] as const) {
  test(`metric panel shows the server headline, ▲ 12% vs 7d, a sparkline and the compared-with row (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, AUTH);
    const me = await request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const userId = ((await me.json()) as { id: string }).id;
    console.log(`[HEL-1275 e2e] user id: ${userId}`);
    // The post-login page is live on `/`; idle it so its mount fetches cannot race the API seeding
    // (HEL-1289).
    await isolateLivePage(page);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1275 revenue ${theme}`,
          type: "static",
          columns: [
            { name: "region", type: "string" },
            { name: "amount", type: "integer" },
          ],
          rows: [
            ["east", 500],
            ["west", 575],
          ],
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1275 pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      // NO `compare` in the seeded config: the UI chooses it below (C5).
      const output = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "metric",
          name: "HEL-1275 Revenue",
          config: {
            fieldMapping: {},
            aggregation: { value: "amount", agg: "sum" },
            format: "integer",
          },
        },
        201,
      );
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1275 ${theme}` },
        201,
      );
      created.dashboard = dashboard.id;
      // Run 1 (sum 1075), then move ITS history row back 7d1h.
      await runPipeline(request, pipeline.id);
      expect(historyRowCount(output.id, userId)).toBe(1);
      const backdated = backdateHistory(output.id, userId, "7 days 1 hour", 1);
      console.log(`[HEL-1275 e2e] backdated history row ids: ${backdated.join(",")}`);

      // Run 2 (sum 1204) — the head.
      const put = await request.put(`/api/data-sources/${source.id}/rows`, {
        data: {
          rows: [
            ["east", 600],
            ["west", 604],
          ],
        },
        headers: CSRF,
      });
      expect(put.status(), await put.text()).toBe(200);
      await runPipeline(request, pipeline.id);
      expect(historyRowCount(output.id, userId)).toBe(2);

      await postJson(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1275 Revenue",
          type: "output",
          config: { outputId: output.id },
        },
        201,
      );

      // A second panel on the same Output, with a real viewer control (the first stays at its
      // default size with no control bar, for the exit-criterion proof).
      const withControl = await postJson<{ id: string }>(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1275 Filtered",
          type: "output",
          config: {
            outputId: output.id,
            controls: [{ id: "region-ctl", kind: "text", column: "region", label: "Region" }],
          },
        },
        201,
      );

      // Only the control-bearing panel is enlarged (its control bar needs the room); the plain
      // panel keeps its default 3x2 size for the exit-criterion proof.
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        {
          items: [{ panelId: withControl.id, w: 4, h: 4 }],
        },
        200,
      );

      // Choose "7 days" in the Output editor UI.
      await page.goto(`/pipelines/${pipeline.id}`);
      await page.getByRole("tab", { name: /^Outputs/ }).click();
      await page.getByRole("button", { name: "Open HEL-1275 Revenue output" }).click();
      await page.getByRole("combobox", { name: "Compare" }).click();
      await page.getByRole("option", { name: "7 days" }).click();
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("combobox", { name: "Compare" })).toBeHidden();

      await page.goto(`/dashboards/${dashboard.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const card = page.locator(".react-grid-item", { hasText: "HEL-1275 Revenue" });
      await expect(card.getByText("1,204", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText("▲ 12% vs 7d", { exact: true })).toBeVisible();
      await expect(card.getByRole("img", { name: /Trend over \d+ data points/ })).toBeVisible();
      expect(await card.textContent()).not.toMatch(/previous run/i);

      // Default 3x2 placement (no layout call): the sparkline sits inside the card, below the
      // header and clear of the value/delta, at the desktop widths 1440 and 1100.
      for (const width of [1440, 1100]) {
        await resizeAndSettle(page, card, width);
        const spark = card.getByRole("img", { name: /Trend over \d+ data points/ });
        await expect(spark).toBeVisible();
        const [c, sp, delta] = await Promise.all([
          card.boundingBox(),
          spark.boundingBox(),
          card.getByText("\u25B2 12% vs 7d", { exact: true }).boundingBox(),
        ]);
        expect(sp!.width).toBeGreaterThan(8);
        expect(sp!.height).toBeGreaterThan(8);
        expect(sp!.x).toBeGreaterThanOrEqual(c!.x);
        expect(sp!.x + sp!.width).toBeLessThanOrEqual(c!.x + c!.width);
        expect(sp!.y + sp!.height).toBeLessThanOrEqual(c!.y + c!.height);
        // beside the delta, not overlapping it
        expect(sp!.x).toBeGreaterThanOrEqual(delta!.x + delta!.width - 1);
      }
      // Wait for the reflow to finish before clicking (no fixed sleep).
      await resizeAndSettle(page, card, 1440);
      await layoutSettled(card.getByRole("button", { name: "Data provenance" }));
      await card.getByRole("button", { name: "Data provenance" }).click();
      const popover = page.getByRole("dialog", { name: /Data provenance/ });
      await expect(popover.getByRole("heading", { name: "Compared with" })).toBeVisible();
      await expect(popover.getByText(/1,075/)).toBeVisible();
      await page.keyboard.press("Escape");

      // Filtered state: a real viewer control. The headline becomes the filtered aggregate (604 for
      // the one "west" row, aggregated over `aggregation.value`), the delta/sparkline give way to
      // the unfiltered-data marker.
      const filtered = page.locator(".react-grid-item", { hasText: "HEL-1275 Filtered" });
      await expect(filtered.getByText("1,204", { exact: true })).toBeVisible();
      await filtered.getByRole("textbox", { name: /Region/ }).fill("west");
      await expect(filtered.getByText("604", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(filtered.getByTitle("comparison reflects unfiltered data")).toBeVisible();
      await expect(filtered.getByText(/vs 7d/)).toHaveCount(0);
      await expect(filtered.getByRole("img", { name: /Trend over/ })).toHaveCount(0);
      // The provenance row is hidden under the filter.
      await layoutSettled(filtered.getByRole("button", { name: "Data provenance" }));
      await filtered.getByRole("button", { name: "Data provenance" }).click();
      await expect(page.getByRole("dialog", { name: /Data provenance/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Compared with" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      mkdirSync(SHOTS, { recursive: true });
      await filtered.screenshot({ path: resolve(SHOTS, `metric-filtered-${theme}.png`) });

      // Editor -> back within the app (NO reload): a compare saved while the dashboard's history
      // is cached must show up without a full page load. 7d -> 1 day.
      // No-reload proof (HEL-1327): the history cache this step exercises survives only if no hop
      // of the round trip loads a new document. Two signals: a window sentinel (lost on ANY new
      // document, even one served without a network request) and a count of main-frame document
      // requests (names the URLs that reloaded).
      const sentinel = `hel1327-${Math.random().toString(36).slice(2)}`;
      await page.evaluate((t) => {
        (window as unknown as Record<string, string>).__hel1327NoReload = t;
      }, sentinel);
      const documentRequests: string[] = [];
      const onRequest = (req: Request) => {
        if (req.resourceType() === "document" && req.frame() === page.mainFrame())
          documentRequests.push(req.url());
      };
      page.on("request", onRequest);
      await page.getByRole("link", { name: "Data Pipelines" }).first().click();
      await page
        .getByRole("link", { name: new RegExp(`HEL-1275 pipeline ${theme}`) })
        .first()
        .click();
      await page.getByRole("tab", { name: /^Outputs/ }).click();
      await page.getByRole("button", { name: "Open HEL-1275 Revenue output" }).click();
      await page.getByRole("combobox", { name: "Compare" }).click();
      await page.getByRole("option", { name: "1 day" }).click();
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("combobox", { name: "Compare" })).toBeHidden();
      await page.getByRole("link", { name: "Dashboards" }).first().click();
      const switched = page.locator(".react-grid-item", { hasText: "HEL-1275 Revenue" });
      await expect(switched.getByText("\u25B2 12% vs 1d", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(switched.getByText(/vs 7d/)).toHaveCount(0);
      page.off("request", onRequest);
      expect(documentRequests, "full document loads during editor -> dashboard").toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, string>).__hel1327NoReload ?? null,
        ),
        "window sentinel lost: a full document load replaced the page",
      ).toBe(sentinel);
      await switched.screenshot({ path: resolve(SHOTS, `metric-compare-switch-${theme}.png`) });

      await card.screenshot({ path: resolve(SHOTS, `metric-delta-sparkline-${theme}.png`) });
      await page.screenshot({ path: resolve(SHOTS, `dashboard-${theme}.png`) });
    } finally {
      if (created.dashboard)
        await request.delete(`/api/dashboards/${created.dashboard}`, { headers: CSRF });
      if (created.pipeline)
        await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
      if (created.source)
        await request.delete(`/api/data-sources/${created.source}`, { headers: CSRF });
    }
  });
}
