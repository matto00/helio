import { writeFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";
import { deleteExact } from "./support/remountBurstSeed";

// HEL-1392 C4 -- reused rows and Output metadata must never outlive a write the app itself made.
// In the running app: cross the desktop/phone boundary (cards reuse), edit an Output's config through
// the Output editor and re-run its pipeline through the "Run pipeline" button (both in-app, after a
// source write the page never saw), return to the dashboard WITHOUT a reload (the module-level caches
// are what is under test, so navigation goes through history, not `goto`), and confirm the fresh
// chart type and rows render, at both widths, with reuse resuming afterwards.

const DESKTOP = { width: 1400, height: 900 };
const PHONE = { width: 1000, height: 900 };

type EchartsInstance = {
  getOption(): { series?: unknown[]; legend?: { show?: boolean; type?: string }[] };
  getDom(): Element;
};
type ReactFiber = {
  stateNode?: { getEchartsInstance?: () => EchartsInstance } | null;
  return?: ReactFiber | null;
};

async function seriesTypes(card: Locator): Promise<string[]> {
  return card
    .locator("canvas")
    .first()
    .evaluate((canvas) => {
      let host: Element | null = canvas;
      while (host) {
        const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
        let f: ReactFiber | null | undefined = key
          ? (host as unknown as Record<string, ReactFiber>)[key]
          : null;
        while (f) {
          if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
            const o = f.stateNode.getEchartsInstance!().getOption();
            return ((o.series ?? []) as { type?: string }[]).map((s) => s.type ?? "");
          }
          f = f.return;
        }
        host = host.parentElement;
      }
      return [];
    })
    .catch(() => []);
}

async function spaNavigate(page: Page, path: string) {
  // History navigation keeps the page's JS module state (the caches) alive, unlike `goto`.
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function setViewport(page: Page, size: typeof DESKTOP) {
  await page.setViewportSize(size);
  if (size === PHONE) await expect(page.locator(".mobile-panel-stack")).toBeVisible();
  else await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
}

test.describe("HEL-1392 staleness in the running app", () => {
  test.setTimeout(240_000);

  for (const theme of ["dark", "light"] as const) {
    test(`an Output edit and a pipeline re-run are visible after a remount (${theme})`, async ({
      page,
      request,
    }) => {
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      const { email } = await registerAndLogin(page, request, {
        prefix: "hel1392s",
        label: theme,
        displayName: "HEL-1392 staleness",
        isolate: true,
      });
      const post = async <T>(url: string, data: unknown) => {
        const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
        expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
        return (await res.json()) as T;
      };
      const dash = await post<{ id: string }>("/api/dashboards", { name: "HEL-1392 stale" });
      const source = await post<{ id: string }>("/api/data-sources", {
        name: "HEL-1392 stale source",
        type: "static",
        columns: [
          { name: "region", type: "string", required: true },
          { name: "revenue", type: "integer", required: true },
        ],
        rows: [
          ["East", 100],
          ["West", 150],
        ],
      });
      const pipeline = await post<{ id: string }>("/api/pipelines", {
        name: "HEL-1392 stale pipeline",
        roots: [{ sourceId: source.id }],
      });
      const chart = await post<{ id: string }>(`/api/pipelines/${pipeline.id}/outputs`, {
        kind: "chart",
        name: "HEL-1392 stale chart",
        config: { chartType: "bar", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
      });
      const table = await post<{ id: string }>(`/api/pipelines/${pipeline.id}/outputs`, {
        kind: "table",
        name: "HEL-1392 stale table",
        config: {},
      });
      await post(`/api/pipelines/${pipeline.id}/run`, {});
      const panels = [] as { id: string }[];
      for (const [title, outputId] of [
        ["Stale chart", chart.id],
        ["Stale table", table.id],
      ]) {
        panels.push(
          await post("/api/panels", {
            dashboardId: dash.id,
            title,
            type: "output",
            config: { outputId },
          }),
        );
      }
      await post(`/api/dashboards/${dash.id}/auto-layout`, {
        items: panels.map((p) => ({ panelId: p.id, w: 6, h: 5 })),
      });
      const created = { dashboard: dash.id, pipeline: pipeline.id, source: source.id };
      console.log(`[HEL-1392 e2e] staleness user ${email} created ${JSON.stringify(created)}`);

      const apiCalls: string[] = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith("/api/")) apiCalls.push(`${r.method()} ${u.pathname}`);
      });
      const mark = () => apiCalls.length;
      const since = (from: number, re: RegExp) =>
        apiCalls.slice(from).filter((c) => re.test(c)).length;
      const ROWS = /GET \/api\/outputs\/[^/]+\/rows$/;
      const META = /GET \/api\/outputs\/[^/]+$/;
      const chartCard = () => page.locator(".panel-grid-card", { hasText: "Stale chart" });
      const tableCard = () => page.locator(".panel-grid-card", { hasText: "Stale table" });

      try {
        await page.setViewportSize(DESKTOP);
        await page.goto(`/dashboards/${dash.id}`);
        await expect(chartCard()).toBeVisible();
        await expect.poll(() => seriesTypes(chartCard())).toEqual(["bar"]);
        await expect(tableCard().getByRole("cell", { name: "East", exact: true })).toBeVisible();
        await expect(tableCard().getByRole("cell", { name: "West", exact: true })).toBeVisible();
        await page.waitForTimeout(3_000);

        // 1. Reuse: crossing re-requests neither rows nor metadata.
        let from = mark();
        await setViewport(page, PHONE);
        await page.waitForTimeout(2_500);
        expect(since(from, ROWS), "rows requests while crossing").toBe(0);
        expect(since(from, META), "metadata requests while crossing").toBe(0);
        await expect.poll(() => seriesTypes(chartCard())).toEqual(["bar"]);
        await page.screenshot({ path: evidencePath("HEL-1392", `phone-reused-${theme}.png`) });

        // 2. An in-app Output edit alone (no run): the pipeline is untouched, so only the Output
        // write's own invalidation can keep the chart from being served stale.
        await spaNavigate(page, `/pipelines/${pipeline.id}`);
        await page.getByRole("tab", { name: /^Outputs/ }).click();
        await page.getByRole("button", { name: "Open HEL-1392 stale chart" }).click();
        await page.getByRole("combobox", { name: "Chart type" }).click();
        await page.getByRole("option", { name: "Line" }).click();
        const patched = page.waitForResponse(
          (r) => r.request().method() === "PATCH" && r.url().includes(`/api/outputs/${chart.id}`),
        );
        await page.getByRole("button", { name: "Save" }).click();
        expect((await patched).status()).toBe(200);
        await page.waitForTimeout(1_000);
        from = mark();
        await spaNavigate(page, `/dashboards/${dash.id}`);
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
        await expect.poll(() => seriesTypes(chartCard())).toEqual(["line"]);
        expect(since(from, META), "metadata refetched after the edit").toBeGreaterThan(0);

        // 3. A source write the page never saw, then the in-app re-run, then back (no reload).
        await post(`/api/data-sources/${source.id}/rows`, { rows: [["North", 70]] });
        await spaNavigate(page, `/pipelines/${pipeline.id}`);
        const ran = page.waitForResponse(
          (r) =>
            r.request().method() === "POST" &&
            r.url().includes(`/api/pipelines/${pipeline.id}/run`),
        );
        await page.getByRole("button", { name: "Run pipeline" }).click();
        expect((await ran).status()).toBe(200);
        await page.waitForTimeout(1_500);
        from = mark();
        await spaNavigate(page, `/dashboards/${dash.id}`);
        await expect(page.locator(".mobile-panel-stack")).toBeVisible();
        await expect(tableCard().getByRole("cell", { name: "North", exact: true })).toBeVisible();
        const fresh = { rows: since(from, ROWS), meta: since(from, META) };
        expect(fresh.rows, "rows refetched after the re-run").toBeGreaterThan(0);

        // 4. Both widths show the fresh data. The run this page made is reconciled by the cards'
        // fan-out on remount (a real observation), which makes that first crossing conservative; the
        // crossing after it reuses again.
        await page.waitForTimeout(2_500);
        await setViewport(page, DESKTOP);
        await page.waitForTimeout(2_500);
        await expect.poll(() => seriesTypes(chartCard())).toEqual(["line"]);
        await expect(tableCard().getByRole("cell", { name: "North", exact: true })).toBeVisible();
        await page.screenshot({ path: evidencePath("HEL-1392", `desktop-fresh-${theme}.png`) });
        // The out-of-band source write also queues a server-side auto-run (debounce + scheduler
        // tick, up to ~35s) whose succeeded event legitimately invalidates the pipeline once. So
        // reuse must resume within a few round trips, not necessarily on the very next crossing.
        let after = { rows: -1, meta: -1 };
        const attempts: { rows: number; meta: number }[] = [];
        for (let attempt = 0; attempt < 4 && (after.rows !== 0 || after.meta !== 0); attempt++) {
          await setViewport(page, DESKTOP);
          await page.waitForTimeout(2_500);
          from = mark();
          await setViewport(page, PHONE);
          await page.waitForTimeout(2_500);
          after = { rows: since(from, ROWS), meta: since(from, META) };
          attempts.push(after);
        }
        await expect.poll(() => seriesTypes(chartCard())).toEqual(["line"]);
        expect(after, "reuse resumes after the fresh fetch").toEqual({ rows: 0, meta: 0 });
        await page.screenshot({ path: evidencePath("HEL-1392", `phone-fresh-${theme}.png`) });
        writeFileSync(
          evidencePath("HEL-1392", `staleness-${theme}.json`),
          JSON.stringify({ email, created, fresh, after, attempts }, null, 2),
        );
      } finally {
        const statuses = {
          dashboard: await deleteExact(request, `/api/dashboards/${dash.id}`),
          pipeline: await deleteExact(request, `/api/pipelines/${pipeline.id}`),
          source: await deleteExact(request, `/api/data-sources/${source.id}`),
        };
        console.log(`[HEL-1392 e2e] staleness deleted ${JSON.stringify(statuses)}`);
        await isolateLivePage(page).catch(() => undefined);
      }
    });
  }
});
