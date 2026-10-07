import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { backdateHistory, historyRowCount } from "./support/historySeed";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1351 — an AGGREGATED chart Output (sum(amount) by region, compare 7d) on a dashboard:
//   item 1: the panel plots GROUPED bars (east 15, west 7) and overlays the grouped "vs 7d" baseline;
//   item 3: at a phone viewport (390px, mobile stack) the chart canvas is genuinely compact
//           (< 179px tall) and keeps a scrolling legend naming the overlay, read from the live
//           ECharts option; the same Output WITHOUT compare keeps its legend hidden (the red
//           control: it fails if the compact-legend rule is reverted or applied unconditionally);
//   item 4: the placement panel stores no chart type, so it renders the Output's `bar` (not line).
// Real runs + real history (run 1 backdated 7d1h, then run 2). The chart is canvas-rendered, so the
// grouped values / "vs 7d" are read from the DOM axis tooltip on hover (as hel1277/hel1350 do); the
// compact legend is a canvas element, so it is proven by the saved screenshots of both themes.
// Every created id is logged and deleted by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };
const SHOTS = resolve(
  __dirname,
  "../openspec/changes/dashboard-chart-overlay-coverage/screenshots",
);

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

async function runPipeline(request: APIRequestContext, pipelineId: string) {
  const res = await request.post(`/api/pipelines/${pipelineId}/run`, { data: {}, headers: CSRF });
  expect(res.status(), await res.text()).toBe(200);
}

async function registerThenLogin(page: Page, request: APIRequestContext, theme: string) {
  const email = `hel1351-${theme}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: "HEL-1351" },
    headers: CSRF,
  });
  expect(res.status()).toBe(201);
  const me = await request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  const userId = ((await me.json()) as { id: string }).id;
  console.log(`[HEL-1351 e2e] created user ${userId}`);
  await loginThenIsolate(page, { email, password });
  return userId;
}

/** The live ECharts option + canvas height of the first chart inside `card`. */
async function liveChart(card: Locator) {
  return card
    .locator("canvas")
    .first()
    .evaluate((canvas) => {
      let host: Element | null = canvas;
      let comp: any = null;
      while (host && !comp) {
        const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
        let f: any = key ? (host as any)[key] : null;
        while (f) {
          if (f.stateNode && typeof f.stateNode.getEchartsInstance === "function") {
            comp = f.stateNode;
            break;
          }
          f = f.return;
        }
        host = host.parentElement;
      }
      if (!comp) return null;
      const inst = comp.getEchartsInstance();
      const o = inst.getOption();
      const legend = (o.legend ?? [])[0] ?? {};
      return {
        height: inst.getDom().getBoundingClientRect().height as number,
        legendShow: legend.show as boolean | undefined,
        legendType: legend.type as string | undefined,
        series: ((o.series ?? []) as { name?: string }[]).map((x) => x.name),
      };
    });
}

for (const theme of ["light", "dark"] as const) {
  test(`aggregated chart Output: grouped bars, "vs 7d" overlay and compact legend (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const userId = await registerThenLogin(page, request, theme);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1351 sales ${theme}`,
          type: "static",
          columns: [
            { name: "region", type: "string" },
            { name: "amount", type: "integer" },
          ],
          rows: [
            ["east", 8],
            ["east", 3],
            ["west", 9],
          ],
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1351 pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      const output = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "chart",
          name: "HEL-1351 Sales",
          config: {
            chartType: "bar",
            fieldMapping: { xAxis: "region", yAxis: "amount" },
            aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
            compare: "7d",
          },
        },
        201,
      );
      // Red control: the SAME aggregation with NO compare, so no overlay is ever drawn.
      const plainOutput = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "chart",
          name: "HEL-1351 Plain",
          config: {
            chartType: "bar",
            fieldMapping: { xAxis: "region", yAxis: "amount" },
            aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
          },
        },
        201,
      );
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1351 ${theme}` },
        201,
      );
      created.dashboard = dashboard.id;
      console.log(
        `[HEL-1351 e2e] created source ${source.id} pipeline ${pipeline.id} output ${output.id} dashboard ${dashboard.id}`,
      );

      // Run 1, move ITS history row back 7d1h, then change the rows and run 2 (the head).
      await runPipeline(request, pipeline.id);
      expect(historyRowCount(output.id, userId)).toBe(1);
      const backdated = backdateHistory(output.id, userId, "7 days 1 hour", 1);
      console.log(`[HEL-1351 e2e] backdated history row ids: ${backdated.join(",")}`);
      const put = await request.put(`/api/data-sources/${source.id}/rows`, {
        data: {
          rows: [
            ["east", 10],
            ["east", 5],
            ["west", 7],
          ],
        },
        headers: CSRF,
      });
      expect(put.status(), await put.text()).toBe(200);
      await runPipeline(request, pipeline.id);
      expect(historyRowCount(output.id, userId)).toBe(2);

      // Two placements of the same Output, NEITHER storing a chart type (item 4): tall + compact.
      const tall = await postJson<{ id: string }>(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1351 Tall",
          type: "output",
          config: { outputId: output.id },
        },
        201,
      );
      const compact = await postJson<{ id: string }>(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1351 Compact",
          type: "output",
          config: { outputId: output.id },
        },
        201,
      );
      const plain = await postJson<{ id: string }>(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1351 Plain",
          type: "output",
          config: { outputId: plainOutput.id },
        },
        201,
      );
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        {
          items: [
            { panelId: tall.id, w: 6, h: 5 },
            { panelId: compact.id, w: 6, h: 3 },
            { panelId: plain.id, w: 6, h: 3 },
          ],
        },
        200,
      );

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1351 ${theme}`).first().click();
      const tallCard = page.locator(".react-grid-item", { hasText: "HEL-1351 Tall" });
      const canvas = tallCard.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });

      // Hover across the plot until the axis tooltip names the primary series, a grouped value and
      // the overlay: sum(amount) / east 15 (10+5 grouped, not a raw 10 or 5) / "vs 7d" baseline 11.
      await expect
        .poll(
          async () => {
            const box = await canvas.boundingBox();
            if (!box) return "";
            for (const fx of [0.3, 0.4, 0.5, 0.6, 0.7]) {
              await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.5);
              const text = (await tallCard.textContent()) ?? "";
              if (/vs 7d/.test(text)) return text;
            }
            return "";
          },
          { timeout: 20_000 },
        )
        .toMatch(/sum\(amount\)/);
      const hovered = (await tallCard.textContent()) ?? "";
      expect(hovered).toMatch(/vs 7d/);
      expect(hovered).toMatch(/\b(15|7)\b/);
      expect(hovered).not.toMatch(/previous/i);

      mkdirSync(SHOTS, { recursive: true });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await tallCard.screenshot({ path: resolve(SHOTS, `aggregated-overlay-tall-${theme}.png`) });

      // Item 3: a phone viewport puts the panels in the mobile stack, where the canvas is < 179px.
      await page.setViewportSize({ width: 390, height: 844 });
      // The desktop grid must be gone, so only mobile-stack articles can match below.
      await expect(page.locator(".react-grid-item")).toHaveCount(0, { timeout: 15_000 });
      const stackCompact = page.locator("article", { hasText: "HEL-1351 Compact" });
      const stackPlain = page.locator("article", { hasText: "HEL-1351 Plain" });
      await expect(stackCompact.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
      await expect(stackPlain.locator("canvas").first()).toBeVisible({ timeout: 15_000 });

      // Poll on the whole snapshot and assert on the value the poll captured (never re-read: the
      // lazily loaded chart can be momentarily unreachable between two reads).
      type Snap = Awaited<ReturnType<typeof liveChart>>;
      let withOverlay: Snap = null;
      await expect
        .poll(
          async () => {
            withOverlay = await liveChart(stackCompact);
            return withOverlay !== null && withOverlay.series.includes("vs 7d");
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      expect(withOverlay!.height, "canvas must really be compact").toBeLessThan(179);
      expect(withOverlay!.legendShow).toBe(true);
      expect(withOverlay!.legendType).toBe("scroll");
      // Red control: no overlay drawn -> the compact legend stays hidden.
      let withoutOverlay: Snap = null;
      await expect
        .poll(
          async () => {
            withoutOverlay = await liveChart(stackPlain);
            return withoutOverlay !== null && withoutOverlay.series.length > 0;
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      expect(withoutOverlay!.height).toBeLessThan(179);
      expect(withoutOverlay!.series).not.toContain("vs 7d");
      expect(withoutOverlay!.legendShow).toBe(false);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await stackCompact.screenshot({
        path: resolve(SHOTS, `aggregated-overlay-compact-legend-${theme}.png`),
      });
      await stackPlain.screenshot({
        path: resolve(SHOTS, `aggregated-no-overlay-compact-hidden-legend-${theme}.png`),
      });
    } finally {
      console.log(
        `[HEL-1351 e2e] deleting dashboard ${created.dashboard} pipeline ${created.pipeline} source ${created.source}`,
      );
      if (created.dashboard)
        await request.delete(`/api/dashboards/${created.dashboard}`, { headers: CSRF });
      if (created.pipeline)
        await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
      if (created.source)
        await request.delete(`/api/data-sources/${created.source}`, { headers: CSRF });
    }
  });
}
