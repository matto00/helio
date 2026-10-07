import { expect, test, type APIRequestContext, type Request } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { backdateHistory, historyRowCount } from "./support/historySeed";
import { currentUserId, registerUser } from "./support/auth";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1350 — a chart Output's Compare picker (Output editor) turns on the dashboard "vs" overlay.
// The comparison is chosen through the editor UI (never seeded): picker -> PATCH body -> dashboard
// overlay, in one chain, from REAL history (run 1, backdated 7d1h, then run 2). The overlay is
// canvas-rendered, so "vs 7d" is read from the DOM axis tooltip on hover (as hel1277 does).
// Both themes; screenshots land in e2e-evidence/<ticket>/ (support/evidencePath.ts). Every created id is logged and deleted by
// exact id in `finally`.

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
  const res = await request.post(`/api/pipelines/${pipelineId}/run`, { data: {}, headers: CSRF });
  expect(res.status(), await res.text()).toBe(200);
}

for (const theme of ["light", "dark"] as const) {
  test(`chart Compare picker sets compare and the dashboard draws the "vs 7d" overlay (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const credentials = await registerUser(request, {
      prefix: `hel1350-${theme}`,
      displayName: "HEL-1350",
      logEmail: false,
    });
    const userId = await currentUserId(request);
    console.log(`[HEL-1350 e2e] created user ${userId}`);
    await loginThenIsolate(page, credentials);

    const created: { source?: string; pipeline?: string; dashboard?: string } = {};
    try {
      const source = await postJson<{ id: string }>(
        request,
        "/api/data-sources",
        {
          name: `HEL-1350 trend ${theme}`,
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
        { name: `HEL-1350 pipeline ${theme}`, roots: [{ sourceId: source.id }] },
        201,
      );
      created.pipeline = pipeline.id;
      // NO `compare` in the seeded config: the editor UI chooses it below.
      const output = await postJson<{ id: string }>(
        request,
        `/api/pipelines/${pipeline.id}/outputs`,
        {
          kind: "chart",
          name: "HEL-1350 Trend",
          config: { chartType: "line", fieldMapping: { xAxis: "day", yAxis: "amount" } },
        },
        201,
      );
      const dashboard = await postJson<{ id: string }>(
        request,
        "/api/dashboards",
        { name: `HEL-1350 ${theme}` },
        201,
      );
      created.dashboard = dashboard.id;
      console.log(
        `[HEL-1350 e2e] created source ${source.id} pipeline ${pipeline.id} output ${output.id} dashboard ${dashboard.id}`,
      );

      // Run 1, move ITS history row back 7d1h, then run 2 (the head).
      await runPipeline(request, pipeline.id);
      expect(historyRowCount(output.id, userId)).toBe(1);
      const backdated = backdateHistory(output.id, userId, "7 days 1 hour", 1);
      console.log(`[HEL-1350 e2e] backdated history row ids: ${backdated.join(",")}`);
      const put = await request.put(`/api/data-sources/${source.id}/rows`, {
        data: {
          rows: [
            ["Mon", 14],
            ["Tue", 18],
            ["Wed", 25],
          ],
        },
        headers: CSRF,
      });
      expect(put.status(), await put.text()).toBe(200);
      await runPipeline(request, pipeline.id);
      expect(historyRowCount(output.id, userId)).toBe(2);

      const panel = await postJson<{ id: string }>(
        request,
        "/api/panels",
        {
          dashboardId: dashboard.id,
          title: "HEL-1350 Trend",
          type: "output",
          config: { outputId: output.id },
        },
        201,
      );
      // Tall enough (non-compact) that the overlay legend/tooltip renders.
      await postJson(
        request,
        `/api/dashboards/${dashboard.id}/auto-layout`,
        { items: [{ panelId: panel.id, w: 6, h: 5 }] },
        200,
      );

      // Open the editor, read the help text, choose "7 days", save.
      await page.goto(`/pipelines/${pipeline.id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("tab", { name: /^Outputs/ }).click();
      await page.getByRole("button", { name: "Open HEL-1350 Trend output" }).click();
      const picker = page.getByRole("combobox", { name: "Compare" });
      await expect(picker).toBeVisible();
      await expect(picker).toHaveAccessibleDescription(/Adds a .vs. line or bars/);
      await picker.click();
      // HEL-1285: chart Outputs offer "Previous" (same list as metric Outputs), exactly once.
      await expect(page.getByRole("option", { name: "Previous" })).toHaveCount(1);
      await page.getByRole("option", { name: "7 days" }).click();
      await page.screenshot({
        path: evidencePath("HEL-1350", `editor-compare-picker-${theme}.png`),
      });

      // No-reload proof: window sentinel + main-frame document requests (HEL-1327).
      const sentinel = `hel1350-${Math.random().toString(36).slice(2)}`;
      await page.evaluate((t) => {
        (window as unknown as Record<string, string>).__hel1350NoReload = t;
      }, sentinel);
      const documentRequests: string[] = [];
      const onRequest = (req: Request) => {
        if (req.resourceType() === "document" && req.frame() === page.mainFrame())
          documentRequests.push(req.url());
      };
      page.on("request", onRequest);
      const patched = page.waitForRequest(
        (r) => r.method() === "PATCH" && r.url().includes(`/api/outputs/${output.id}`),
      );
      await page.getByRole("button", { name: "Save" }).click();
      const body = (await patched).postDataJSON() as { config: { compare?: unknown } };
      expect(body.config.compare).toBe("7d");
      await expect(page.getByRole("combobox", { name: "Compare" })).toBeHidden();

      await page.getByRole("link", { name: "Dashboards" }).first().click();
      const card = page.locator(".react-grid-item", { hasText: "HEL-1350 Trend" });
      const canvas = card.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });
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
        .toMatch(/vs 7d/);
      page.off("request", onRequest);
      expect(documentRequests, "full document loads during editor -> dashboard").toEqual([]);
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, string>).__hel1350NoReload ?? null,
        ),
        "window sentinel lost: a full document load replaced the page",
      ).toBe(sentinel);
      expect(await card.textContent()).not.toMatch(/previous/i);
      // Settle the hover emphasis before the screenshot so it shows the resting colours.
      await page.mouse.move(0, 0);
      await page.waitForTimeout(800);
      await card.screenshot({ path: evidencePath("HEL-1350", `chart-overlay-panel-${theme}.png`) });
    } finally {
      console.log(
        `[HEL-1350 e2e] deleting dashboard ${created.dashboard} pipeline ${created.pipeline} source ${created.source}`,
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
