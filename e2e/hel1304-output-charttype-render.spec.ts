import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { currentUserId, registerUser } from "./support/auth";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1304 — a chart Output's `config.chartType` is what a dashboard panel renders when the panel
// stores no chart type of its own (panel appearance -> Output config -> line).
//   AC1: Outputs created via `POST /api/pipelines/:id/outputs` (what `add_output` calls) and placed via
//        `POST /api/panels/batch` with the exact `place_outputs` body (no appearance) render `bar` / `pie`.
//   AC2: a panel whose appearance stores `chartType: "line"` still overrides the Output's `bar`.
//   D1:  a legend-only chart patch (no chartType) on a chartless placement must NOT invent "line" —
//        the panel keeps rendering the Output's `bar` (red without the backend merge-base fix).
// The rendered type is read from the live ECharts option (`series[].type`), not the panel JSON.
// Every created id is logged and deleted by exact id in `finally`.

const CSRF = { "X-Helio-Requested-With": "1" };

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

/** The rendered `series[].type` list of the first chart inside `card` (null until reachable). */
async function seriesTypes(card: Locator): Promise<string[] | null> {
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
      const o = comp.getEchartsInstance().getOption();
      return ((o.series ?? []) as { type?: string }[]).map((s) => s.type ?? "");
    })
    .catch(() => null);
}

async function expectRendered(card: Locator, type: string) {
  await expect(card.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
  let seen: string[] | null = null;
  await expect
    .poll(
      async () => {
        seen = await seriesTypes(card);
        return seen !== null && seen.length > 0;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(
    seen!.every((t) => t === type),
    `series types ${JSON.stringify(seen)}`,
  ).toBe(true);
}

for (const theme of ["light", "dark"] as const) {
  test(`Output config.chartType renders on batch-placed panels (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1304-${theme}`,
      displayName: "HEL-1304",
      logEmail: false,
    });
    const userId = await currentUserId(request);
    console.log(`[HEL-1304 e2e] created user ${userId}`);
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1304 sales ${theme}`,
          type: "static",
          columns: [
            { name: "region", type: "string" },
            { name: "amount", type: "integer" },
          ],
          rows: [
            ["east", 8],
            ["west", 9],
            ["north", 4],
          ],
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1304 pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      const chartOutput = (name: string, chartType: string) =>
        postJson<{ id: string }>(
          request,
          `/api/pipelines/${pipeline.id}/outputs`,
          {
            kind: "chart",
            name,
            config: { chartType, fieldMapping: { xAxis: "region", yAxis: "amount" } },
          },
          201,
        );
      const bar = await chartOutput("HEL-1304 Bar", "bar");
      const pie = await chartOutput("HEL-1304 Pie", "pie");
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1304 ${theme}` },
        201,
      );
      created.dashboard = dashboard.id;
      console.log(
        `[HEL-1304 e2e] created source ${source.id} pipeline ${pipeline.id} outputs ${bar.id},${pie.id} dashboard ${dashboard.id}`,
      );
      const run = await request.post(`/api/pipelines/${pipeline.id}/run`, {
        data: {},
        headers: CSRF,
      });
      expect(run.status(), await run.text()).toBe(200);

      // The exact `place_outputs` request body (helio-mcp `placeOutputs`): no appearance at all.
      const batch = await postJson<{ panels: { id: string; title: string }[] }>(
        request,
        "/api/panels/batch",
        {
          dashboardId: dashboard.id,
          panels: [
            ["HEL-1304 PlacedBar", bar.id],
            ["HEL-1304 PlacedPie", pie.id],
            ["HEL-1304 Override", bar.id],
            ["HEL-1304 LegendOnly", bar.id],
          ].map(([title, outputId]) => ({ title, type: "output", config: { outputId } })),
        },
        201,
      );
      const byTitle = Object.fromEntries(batch.panels.map((p) => [p.title, p.id]));
      const patch = async (id: string, chart: unknown) => {
        const res = await request.patch(`/api/panels/${id}`, {
          data: { appearance: { chart } },
          headers: CSRF,
        });
        expect(res.status(), await res.text()).toBe(200);
      };
      await patch(byTitle["HEL-1304 Override"], { chartType: "line" });
      await patch(byTitle["HEL-1304 LegendOnly"], { legend: { show: false, position: "top" } });
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        { items: batch.panels.map((p) => ({ panelId: p.id, w: 6, h: 4 })) },
        200,
      );

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByText(`HEL-1304 ${theme}`).first().click();
      const card = (title: string) => page.locator(".react-grid-item", { hasText: title });

      await expectRendered(card("HEL-1304 PlacedBar"), "bar"); // AC1
      await expectRendered(card("HEL-1304 PlacedPie"), "pie"); // AC1
      await expectRendered(card("HEL-1304 Override"), "line"); // AC2
      await expectRendered(card("HEL-1304 LegendOnly"), "bar"); // D1
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await page.screenshot({ path: evidencePath("HEL-1304", `output-charttype-${theme}.png`) });
    } finally {
      console.log(
        `[HEL-1304 e2e] deleting dashboard ${created.dashboard} pipeline ${created.pipeline} source ${created.source}`,
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
