import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";

// HEL-1683: a catastrophic-backtracking user regex in a draft extractRegex step must never block the browser main thread.
// Method: a `longtask` PerformanceObserver is installed before each pattern edit; the pattern is entered in ONE fill (not
// typed), so every long task in the window is the evaluation of that single pattern. The control edit proves the client
// evaluator ran in the window (no draft-preview request, client rows rendered) and bounds the dev-build noise; the probe edit
// enters `^(.*.*.*.*.*.*.*.*x)` over 2 rows of "a"x28 + "!", which V8 backtracks catastrophically when the client
// evaluates it, so the unmodified tree produces a finite long task far above the 100 ms bound (the server needs about
// 0.37 s per such cell, see ROW_COUNT). The failing assertions report the measured duration, never a timeout.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1683", displayName: "HEL-1683", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?.*)?$/;
const CELL = `${"a".repeat(28)}!`;
const PROBE_PATTERN = "^(.*.*.*.*.*.*.*.*x)";
// The saved pattern matches nothing (out is empty); the control matches, so its out value can only come from a client run.
const SAVED_PATTERN = "(x)";
const CONTROL_PATTERN = "(a+)!";
// Two rows keep the SERVER side of the probe deterministic: the Scala engine needs ~0.37 s per cell for the probe pattern
// (measured, 1.57 s for five cells, too close to its 2 s per-step budget under parallel load), so two cells leave >2.5x margin.
const ROW_COUNT = 2;
// Measured (evidence/server-overrun.md) to exceed the server's 2 s per-step regex budget on one such cell.
const OVERRUN_PATTERN = "^(a*a*a*a*a*a*a*a*a*a*)$";
const LONG_TASK_BOUND_MS = 100;
/** How the rows table renders a null cell. */
const NULL_CELL = "—";
const LONG_ROWS = 12;
const LONG_CELL_LENGTH = 10_000;
const LONG_PROBE_PATTERN = "(a*)b";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function seed(page: Page, cell = CELL, rowCount = ROW_COUNT): Promise<string> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1683-src",
    type: "static",
    columns: [{ name: "text", type: "string" }],
    rows: Array.from({ length: rowCount }, () => [cell]),
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1683-pipe",
    roots: [{ sourceId: source.id }],
  });
  await post(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "stringops",
    config: {
      operation: "extractRegex",
      field: "text",
      outputColumn: "out",
      pattern: SAVED_PATTERN,
    },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return pipeline.id;
}

/** Installs a long-task observer for one window; `read` returns the longest task (ms) seen since `start`. */
async function startLongTaskWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __hel1683: number[]; __hel1683Obs?: PerformanceObserver };
    w.__hel1683Obs?.disconnect();
    w.__hel1683 = [];
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__hel1683.push(e.duration);
    });
    obs.observe({ type: "longtask", buffered: false });
    w.__hel1683Obs = obs;
  });
}

async function longestTask(page: Page): Promise<{ longest: number; all: number[] }> {
  // takeRecords() flushes tasks the observer has not yet delivered.
  return page.evaluate(() => {
    const w = window as unknown as { __hel1683: number[]; __hel1683Obs: PerformanceObserver };
    for (const e of w.__hel1683Obs.takeRecords()) w.__hel1683.push(e.duration);
    return { longest: Math.max(0, ...w.__hel1683), all: [...w.__hel1683] };
  });
}

/** The text of every body cell in the `out` column of the rows table inside `rows`. */
async function outColumnCells(rows: Locator): Promise<string[]> {
  return rows.locator("table").evaluate((table) => {
    const heads = Array.from(table.querySelectorAll("thead th"), (th) =>
      (th.firstChild?.textContent ?? "").trim(),
    );
    const col = heads.findIndex((h) => h === "out");
    if (col < 0) throw new Error(`no out column among: ${heads.join(", ")}`);
    return Array.from(table.querySelectorAll("tbody tr"), (tr) => {
      const cell = tr.children[col];
      return cell ? (cell.textContent ?? "").trim() : "<missing>";
    });
  });
}

function recordApi(page: Page): { stop: () => string[] } {
  const log: string[] = [];
  const onRequest = (r: { method(): string; url(): string }) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith("/api/")) log.push(`${r.method()} ${pathname}`);
  };
  page.on("request", onRequest);
  return {
    stop: () => {
      page.off("request", onRequest);
      return log;
    },
  };
}

test.describe("HEL-1683 client regex main-thread guard (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(120_000);

  test("a catastrophic extractRegex pattern in a draft never blocks the main thread for more than 100 ms", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "regex" });
    expect(creds.email).toContain("hel1683");
    const pipelineId = await seed(page);
    const sample = page.waitForResponse((r) =>
      SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
    );
    await page.goto(`/pipelines/${pipelineId}`);
    await sample;
    await expect(page.getByRole("region", { name: /^Rows after step 1/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const pattern = page.getByRole("textbox", { name: "Pattern" });
    await expect(pattern).toBeVisible();
    const rows = page.getByRole("region", { name: /^Rows after step 1/ });

    // Control: a safe pattern is evaluated by the client, inside the same kind of window.
    await startLongTaskWindow(page);
    const controlApi = recordApi(page);
    await pattern.fill(CONTROL_PATTERN);
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();
    await expect(rows.getByText("2 rows")).toBeVisible();
    await expect(rows.getByText("a".repeat(28), { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    const controlRequests = controlApi.stop();
    const control = await longestTask(page);
    console.log(
      `[HEL-1683 e2e] control longest long task: ${control.longest.toFixed(1)} ms (tasks: ${control.all.map((n) => n.toFixed(1)).join(", ")})`,
    );
    expect(
      controlRequests.filter((r) => r.includes("/draft-preview")),
      `control must be client-evaluated (no draft-preview request): ${controlRequests.join(", ")}`,
    ).toEqual([]);
    expect(
      control.longest,
      `control (client-evaluated) longest task ${control.longest.toFixed(1)} ms must be <= ${LONG_TASK_BOUND_MS} ms; escalate, do not relax`,
    ).toBeLessThanOrEqual(LONG_TASK_BOUND_MS);

    // Probe: a catastrophic pattern over the same rows.
    await startLongTaskWindow(page);
    const probeApi = recordApi(page);
    await pattern.fill(PROBE_PATTERN);
    await page.waitForTimeout(3000);
    const probeRequests = probeApi.stop();
    const probe = await longestTask(page);
    console.log(
      `[HEL-1683 e2e] probe longest long task: ${probe.longest.toFixed(1)} ms (tasks: ${probe.all.map((n) => n.toFixed(1)).join(", ")}); requests: ${probeRequests.join(", ")}`,
    );
    expect(
      probe.longest,
      `probe pattern ${PROBE_PATTERN}: longest main-thread task was ${probe.longest.toFixed(1)} ms, must be <= ${LONG_TASK_BOUND_MS} ms (control ${control.longest.toFixed(1)} ms)`,
    ).toBeLessThanOrEqual(LONG_TASK_BOUND_MS);

    // Green only: the declined step is evaluated by the server draft preview.
    expect(
      probeRequests.filter((r) => r.includes("/draft-preview")).length,
      `the declined step goes to the server: ${probeRequests.join(", ")}`,
    ).toBeGreaterThan(0);
    // Either exact server outcome proves the server evaluated the step; which one appears depends on runner speed (the
    // engine needs ~0.3 s per probe cell against a 2 s per-step budget), so neither is assumed. If NEITHER appears this fails.
    const live = page.getByLabel("Preview is live");
    const budgetError = page
      .getByText(/pattern '.*' exceeded the 2 s regex time budget for this step/)
      .filter({ hasText: "^(.*.*.*.*.*.*.*.*x)" })
      .first();
    await expect(
      live.or(budgetError).first(),
      "the server's live result or its exact time-budget step error for the probe step",
    ).toBeVisible({ timeout: 15_000 });
    if (await live.isVisible()) {
      await expect(rows.getByText("2 rows")).toBeVisible();
      // The probe pattern matches nothing, so the server's `out` cell is null (rendered "—") for both rows.
      expect(await outColumnCells(rows), "the server's out cells for the probe pattern").toEqual([
        NULL_CELL,
        NULL_CELL,
      ]);
    }

    // Overrun: the server's time-budget step error is what the draft shows, and the main thread stays free meanwhile.
    await startLongTaskWindow(page);
    await pattern.fill(OVERRUN_PATTERN);
    await expect(
      page
        .getByText(/pattern '.*' exceeded the 2 s regex time budget for this step/)
        .filter({ hasText: OVERRUN_PATTERN })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    const overrun = await longestTask(page);
    console.log(`[HEL-1683 e2e] overrun longest long task: ${overrun.longest.toFixed(1)} ms`);
    expect(
      overrun.longest,
      `overrun pattern ${OVERRUN_PATTERN}: longest main-thread task was ${overrun.longest.toFixed(1)} ms, must be <= ${LONG_TASK_BOUND_MS} ms`,
    ).toBeLessThanOrEqual(LONG_TASK_BOUND_MS);
  });

  // HEL-1697: a single unbounded quantifier with a tail (`(a*)b`) is accepted by the allowlist but quadratic per cell (2.1 s
  // per 1,000 rows of 2,000 characters). This frame is LONG_ROWS x LONG_CELL_LENGTH = 12 x 10,000 (1.2e9 len^2 units, about
  // 120 KB): the unmodified tree runs it in a 1.2 s task, over 10x the 100 ms bound. The frame is deliberately small in total
  // characters: the dev build pays per-character render and saved-step re-walk costs in the input handler, which a 1.2 MB frame
  // (400 x 3,000) pushed to 138 ms on CI and 50 x 8,500 (425 KB) to 83 ms locally, while 12 x 10,000 stays at 0 ms.
  test("a single-quantifier pattern over long cells is declined to the server and never blocks the main thread", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "regex-long" });
    expect(creds.email).toContain("hel1683");
    const pipelineId = await seed(page, "a".repeat(LONG_CELL_LENGTH), LONG_ROWS);
    const sample = page.waitForResponse((r) =>
      SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
    );
    await page.goto(`/pipelines/${pipelineId}`);
    await sample;
    await expect(page.getByRole("region", { name: /^Rows after step 1/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const pattern = page.getByRole("textbox", { name: "Pattern" });
    await expect(pattern).toBeVisible();

    await startLongTaskWindow(page);
    const api = recordApi(page);
    await pattern.fill(LONG_PROBE_PATTERN);
    await page.waitForTimeout(4000);
    const requests = api.stop();
    const probe = await longestTask(page);
    console.log(
      `[HEL-1697 e2e] long-cell probe longest long task: ${probe.longest.toFixed(1)} ms (tasks: ${probe.all.map((n) => n.toFixed(1)).join(", ")}); requests: ${requests.join(", ")}`,
    );
    expect(
      probe.longest,
      `long-cell pattern ${LONG_PROBE_PATTERN}: longest main-thread task was ${probe.longest.toFixed(1)} ms, must be <= ${LONG_TASK_BOUND_MS} ms`,
    ).toBeLessThanOrEqual(LONG_TASK_BOUND_MS);
    expect(
      requests.filter((r) => r.includes("/draft-preview")).length,
      `the declined step goes to the server: ${requests.join(", ")}`,
    ).toBeGreaterThan(0);
    // The server's outcome is what the step shows: its live rows, or its exact time-budget step error for this pattern
    // (8,500-character cells may need longer than the engine's 2 s per-step budget, depending on runner speed). If NEITHER
    // appears this fails.
    const rows = page.getByRole("region", { name: /^Rows after step 1/ });
    const live = page.getByLabel("Preview is live");
    const budgetError = page
      .getByText(/pattern '.*' exceeded the 2 s regex time budget for this step/)
      .filter({ hasText: LONG_PROBE_PATTERN })
      .first();
    await expect(
      live.or(budgetError).first(),
      "the server's live result or its exact time-budget step error for the long-cell probe step",
    ).toBeVisible({ timeout: 30_000 });
    const branch = (await live.isVisible()) ? "live" : "time-budget error";
    console.log(`[HEL-1697 e2e] long-cell server outcome: ${branch}`);
    if (branch === "live") await expect(rows.getByText(`${LONG_ROWS} rows`)).toBeVisible();
  });
});
