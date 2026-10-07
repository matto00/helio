import { expect, test, type APIRequestContext } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { currentUserId, registerUser } from "./support/auth";
import { loginThenIsolate } from "./support/isolateLivePage";
import { setUserTierForTest } from "./support/historySeed";

// HEL-1277 — the Output History view (scrubber + changed-rows diff) and the dashboard chart "vs"
// overlay, proven end to end against REAL pipeline runs:
//   * a table Output whose payload opt-in (`config.historyPayloads`) is set by PATCH (no UI toggle:
//     HEL-1331) on a freshly registered user whose tier is set to `beta` by exact id
//     (support/historySeed.ts `setUserTierForTest`): run 1 and run 2 store payloads with changed
//     rows, run 3 runs with the opt-in off (a summary-only point);
//   * a chart Output with `config.compare` ("previous_run") on a dashboard panel.
// Login happens through the UI, then `isolateLivePage` idles the page on about:blank BEFORE any API
// seeding (HEL-1289). Every created id is logged; resources are deleted by exact id in `finally`.
// Screenshots land in e2e-evidence/HEL-1277/ (support/evidencePath.ts), both themes.

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

async function runPipeline(request: APIRequestContext, pipelineId: string) {
  // Synchronous: the 200 returns after the history insert.
  const res = await request.post(`/api/pipelines/${pipelineId}/run`, { data: {}, headers: CSRF });
  expect(res.status(), await res.text()).toBe(200);
}

async function putRows(request: APIRequestContext, sourceId: string, rows: unknown[][]) {
  const res = await request.put(`/api/data-sources/${sourceId}/rows`, {
    data: { rows },
    headers: CSRF,
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function patchConfig(
  request: APIRequestContext,
  outputId: string,
  config: Record<string, unknown>,
) {
  const res = await request.patch(`/api/outputs/${outputId}`, { data: { config }, headers: CSRF });
  expect(res.status(), await res.text()).toBe(200);
}

for (const theme of ["light", "dark"] as const) {
  test(`History view: scrub, changed-rows highlight, summary-only point (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1277-table-${theme}`,
      displayName: "HEL-1277",
      logEmail: false,
    });
    const userId = await currentUserId(request);
    // Payload tier caps are per pipeline-owner tier (free = 0); set ONLY this user's, by exact id.
    console.log(
      `[HEL-1277 e2e] created user ${userId}; tier set for ${setUserTierForTest(userId, "beta")}`,
    );
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; output?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1277 orders ${theme}`,
          type: "static",
          columns: [
            { name: "region", type: "string" },
            { name: "amount", type: "integer" },
          ],
          rows: [
            ["east", 100],
            ["west", 200],
          ],
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1277 pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      const output = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        { kind: "table", name: "HEL-1277 Orders", config: {} },
        201,
      );
      created.output = output.id;
      console.log(
        `[HEL-1277 e2e] created source ${source.id} pipeline ${pipeline.id} output ${output.id}`,
      );

      // Run 1 and run 2 store payloads; run 2 changes one row and replaces another.
      await patchConfig(request, output.id, { historyPayloads: true });
      await runPipeline(request, pipeline.id);
      await putRows(request, source.id, [
        ["east", 100],
        ["west", 250],
        ["north", 300],
      ]);
      await runPipeline(request, pipeline.id);
      // Run 3: opt-in off => a summary-only point (no payload).
      await patchConfig(request, output.id, { historyPayloads: false });
      await putRows(request, source.id, [
        ["east", 100],
        ["west", 250],
      ]);
      await runPipeline(request, pipeline.id);

      const history = await (await request.get(`/api/outputs/${output.id}/history`)).json();
      expect(history.points.map((p: { hasPayload: boolean }) => p.hasPayload)).toEqual([
        false,
        true,
        true,
      ]);

      await page.goto(`/pipelines/${pipeline.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("tab", { name: /^Outputs/ }).click();
      await page.getByRole("button", { name: "History for HEL-1277 Orders" }).click();
      const dialog = page.getByRole("dialog", { name: /HEL-1277 Orders history/ });
      await expect(dialog).toBeVisible();

      // Newest point (run 3): summary only, no highlight, no removal count.
      const scrubber = dialog.getByRole("slider", { name: "Recorded runs" });
      await expect(scrubber).toHaveValue("2");
      await expect(dialog.getByText(/Rows weren.t stored for this run/)).toBeVisible();
      await expect(dialog.getByText("New or changed")).toHaveCount(0);
      await expect(dialog.getByText(/no longer present/)).toHaveCount(0);

      // Scrub older to run 2: both payloads -> exactly the west(250) and north rows are flagged,
      // and the one removed row (west 200) is counted.
      await dialog.getByRole("button", { name: "Older run" }).click();
      await expect(scrubber).toHaveValue("1");
      await expect(dialog.getByText("New or changed")).toHaveCount(2, { timeout: 15_000 });
      await expect(dialog.getByText(/1 row from .* no longer present/)).toBeVisible();
      const flagged = dialog.locator("tr.output-history__row--changed");
      await expect(flagged).toHaveCount(2);
      await expect(flagged.filter({ hasText: "north" })).toHaveCount(1);
      await expect(flagged.filter({ hasText: "east" })).toHaveCount(0);
      expect(await dialog.textContent()).not.toMatch(/previous run/i);

      // Highlight survives a sort.
      const sortAmount = dialog.getByRole("button", { name: "amount" });
      await sortAmount.click();
      await sortAmount.click();
      await expect(flagged).toHaveCount(2);
      await expect(flagged.filter({ hasText: "east" })).toHaveCount(0);

      await dialog.screenshot({ path: evidencePath("HEL-1277", `history-view-diff-${theme}.png`) });

      // Touch floor (DESIGN.md §3): at phone width the scrubber range is a 44px-high target.
      await page.setViewportSize({ width: 375, height: 812 });
      const rangeBox = await scrubber.boundingBox();
      expect(rangeBox!.height).toBeGreaterThanOrEqual(43);
      await page.setViewportSize({ width: 1440, height: 900 });

      // Oldest point: no comparison, no highlight.
      await dialog.getByRole("button", { name: "Older run" }).click();
      await expect(scrubber).toHaveValue("0");
      await expect(dialog.getByText("New or changed")).toHaveCount(0);
      await expect(dialog.getByText(/no longer present/)).toHaveCount(0);
      await expect(dialog.getByText(/nothing to compare against/)).toBeVisible();
    } finally {
      if (created.pipeline)
        console.log(
          `[HEL-1277 e2e] deleting pipeline ${created.pipeline} / source ${created.source}`,
        );
      if (created.pipeline)
        await request.delete(`/api/pipelines/${created.pipeline}`, { headers: CSRF });
      if (created.source)
        await request.delete(`/api/data-sources/${created.source}`, { headers: CSRF });
    }
  });

  test(`dashboard chart panel draws a labelled "vs" overlay from config.compare (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1277-chart-${theme}`,
      displayName: "HEL-1277",
      logEmail: false,
    });
    const userId = await currentUserId(request);
    // Payload tier caps are per pipeline-owner tier (free = 0); set ONLY this user's, by exact id.
    console.log(
      `[HEL-1277 e2e] created user ${userId}; tier set for ${setUserTierForTest(userId, "beta")}`,
    );
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1277 trend ${theme}`,
          type: "static",
          columns: [
            { name: "day", type: "string" },
            { name: "amount", type: "integer" },
          ],
          rows: [
            ["Mon", 10],
            ["Tue", 20],
            ["Wed", 15],
          ],
        },
        201,
      );
      created.source = source.id;
      const pipeline = await postJson<{ id: string }>(
        request,
        "/api/pipelines",
        { name: `HEL-1277 chart pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      const output = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "chart",
          name: "HEL-1277 Trend",
          config: {
            chartType: "line",
            fieldMapping: { xAxis: "day", yAxis: "amount" },
            compare: "previous_run",
          },
        },
        201,
      );
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1277 ${theme}` },
        201,
      );
      created.dashboard = dashboard.id;
      console.log(
        `[HEL-1277 e2e] created source ${source.id} pipeline ${pipeline.id} output ${output.id} dashboard ${dashboard.id}`,
      );
      await runPipeline(request, pipeline.id);
      await putRows(request, source.id, [
        ["Mon", 14],
        ["Tue", 18],
        ["Wed", 25],
      ]);
      await runPipeline(request, pipeline.id);
      const panel = await postJson<{ id: string }>(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1277 Trend",
          type: "output",
          config: { outputId: output.id },
        },
        201,
      );
      // Tall enough that the legend (hidden on a compact panel) shows the "vs previous" entry.
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        { items: [{ panelId: panel.id, w: 6, h: 5 }] },
        200,
      );
      const history = await (await request.get(`/api/outputs/${output.id}/history`)).json();
      expect(history.baseline.series.mode).toBe("rows");
      expect(history.baseline.series.points).toEqual([
        ["Mon", 10],
        ["Tue", 20],
        ["Wed", 15],
      ]);

      await page.goto(`/dashboards/${dashboard.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const card = page.locator(".react-grid-item", { hasText: "HEL-1277 Trend" });
      const canvas = card.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      // The chart is canvas-rendered; its axis tooltip is DOM, and lists every series by name.
      await expect
        .poll(
          async () => {
            const box = await canvas.boundingBox();
            if (!box) return "";
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
            return (await card.textContent()) ?? "";
          },
          { timeout: 15_000 },
        )
        .toMatch(/vs previous/);
      expect(await card.textContent()).not.toMatch(/previous run/i);
      // Settle the hover emphasis before the screenshot so it shows the resting colours.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await card.screenshot({ path: evidencePath("HEL-1277", `chart-overlay-panel-${theme}.png`) });
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
