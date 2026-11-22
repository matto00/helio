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
// HEL-1807: the start-anchored form of an over-budget pattern is one match attempt per cell, so it stays on the client.
const ANCHORED_PATTERN = "^(.*)$";

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

/** One Long Animation Frame, reduced to what attributes a long task (HEL-1808). */
interface Loaf {
  at: number;
  dur: number;
  blocking: number;
  render: number;
  styleLayout: number;
  scripts: string[];
}

/** Installs a long-task (and Long Animation Frame) observer for one window. */
async function startLongTaskWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __hel1683: number[];
      __hel1683Obs?: PerformanceObserver;
      __hel1683Loaf: unknown[];
      __hel1683LoafObs?: PerformanceObserver;
      __hel1683T0: number;
    };
    w.__hel1683Obs?.disconnect();
    w.__hel1683LoafObs?.disconnect();
    w.__hel1683 = [];
    w.__hel1683Loaf = [];
    w.__hel1683T0 = performance.timeOrigin + performance.now();
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__hel1683.push(e.duration);
    });
    obs.observe({ type: "longtask", buffered: false });
    w.__hel1683Obs = obs;
    try {
      const loafObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          const x = e as unknown as {
            startTime: number;
            duration: number;
            blockingDuration: number;
            renderStart: number;
            styleAndLayoutStart: number;
            scripts: {
              invoker: string;
              sourceURL: string;
              sourceFunctionName: string;
              duration: number;
            }[];
          };
          w.__hel1683Loaf.push({
            at: performance.timeOrigin + x.startTime,
            dur: x.duration,
            blocking: x.blockingDuration,
            render: x.renderStart > 0 ? x.startTime + x.duration - x.renderStart : 0,
            styleLayout:
              x.styleAndLayoutStart > 0 ? x.startTime + x.duration - x.styleAndLayoutStart : 0,
            scripts: x.scripts.map(
              (sc) =>
                `${sc.invoker}|${sc.sourceURL.replace(/^.*\//, "")}:${sc.sourceFunctionName}|${sc.duration.toFixed(0)}`,
            ),
          });
        }
      });
      loafObs.observe({ type: "long-animation-frame", buffered: false });
      w.__hel1683LoafObs = loafObs;
    } catch {
      // Long Animation Frames are Chromium-only diagnostics; the longtask bound does not depend on them.
    }
  });
}

interface WindowReading {
  longest: number;
  all: number[];
  loaf: Loaf[];
  t0: number;
}

async function longestTask(page: Page): Promise<WindowReading> {
  // takeRecords() flushes tasks the observer has not yet delivered.
  return page.evaluate(() => {
    const w = window as unknown as {
      __hel1683: number[];
      __hel1683Obs: PerformanceObserver;
      __hel1683Loaf: Loaf[];
      __hel1683LoafObs?: PerformanceObserver;
      __hel1683T0: number;
    };
    for (const e of w.__hel1683Obs.takeRecords()) w.__hel1683.push(e.duration);
    return {
      longest: Math.max(0, ...w.__hel1683),
      all: [...w.__hel1683],
      loaf: [...w.__hel1683Loaf],
      t0: w.__hel1683T0,
    };
  });
}

/** One line per window: every long task plus the animation frames (script/render split) that contained work. */
function attribution(reading: WindowReading, api: ApiTimeline): string {
  const frames = reading.loaf
    .filter((f) => f.dur >= 30)
    .map(
      (f) =>
        `LoAF@${(f.at - reading.t0).toFixed(0)}ms dur=${f.dur.toFixed(0)} block=${f.blocking.toFixed(0)} render=${f.render.toFixed(0)} styleLayout=${f.styleLayout.toFixed(0)} scripts=[${f.scripts.join("; ")}]`,
    );
  return `frames: ${frames.join(" || ") || "none >= 30 ms"}; api: ${api.timeline(reading.t0)}`;
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

interface ApiTimeline {
  stop: () => string[];
  /** Responses that landed in the window, as `METHOD path@ms-since-window-start`. */
  timeline: (t0: number) => string;
}

function recordApi(page: Page): ApiTimeline {
  const log: string[] = [];
  const responses: { label: string; at: number }[] = [];
  const onRequest = (r: { method(): string; url(): string }) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith("/api/")) log.push(`${r.method()} ${pathname}`);
  };
  const onResponse = (r: { url(): string; request(): { method(): string } }) => {
    const { pathname } = new URL(r.url());
    if (pathname.startsWith("/api/"))
      responses.push({ label: `${r.request().method()} ${pathname}`, at: Date.now() });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  return {
    stop: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
      return log;
    },
    timeline: (t0) =>
      responses.map((x) => `${x.label}@${(x.at - t0).toFixed(0)}ms`).join(", ") || "none",
  };
}

/**
 * HEL-1808 diagnostic only: HEL1808_CPU_THROTTLE=4 slows the page's CPU (CDP) to reproduce the slow-CI-host tail.
 * Unset (CI never sets it) or 1 makes no CDP call; any other non-integer-or-below-1 value throws.
 */
async function applyDiagnosticThrottle(page: Page): Promise<void> {
  const raw = process.env.HEL1808_CPU_THROTTLE;
  if (raw === undefined || raw === "" || raw === "1") return;
  if (!/^[2-9]$|^[1-9][0-9]+$/.test(raw)) {
    throw new Error(`HEL1808_CPU_THROTTLE must be an integer >= 1 (e.g. 4), got "${raw}"`);
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(raw) });
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
    await applyDiagnosticThrottle(page);

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
      `[HEL-1683 e2e] control longest long task: ${control.longest.toFixed(1)} ms (tasks: ${control.all.map((n) => n.toFixed(1)).join(", ")}); ${attribution(control, controlApi)}`,
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
      `[HEL-1683 e2e] probe longest long task: ${probe.longest.toFixed(1)} ms (tasks: ${probe.all.map((n) => n.toFixed(1)).join(", ")}); requests: ${probeRequests.join(", ")}; ${attribution(probe, probeApi)}`,
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
    const overrunApi = recordApi(page);
    await pattern.fill(OVERRUN_PATTERN);
    await expect(
      page
        .getByText(/pattern '.*' exceeded the 2 s regex time budget for this step/)
        .filter({ hasText: OVERRUN_PATTERN })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    overrunApi.stop();
    const overrun = await longestTask(page);
    console.log(
      `[HEL-1683 e2e] overrun longest long task: ${overrun.longest.toFixed(1)} ms; ${attribution(overrun, overrunApi)}`,
    );
    expect(
      overrun.longest,
      `overrun pattern ${OVERRUN_PATTERN}: longest main-thread task was ${overrun.longest.toFixed(1)} ms, must be <= ${LONG_TASK_BOUND_MS} ms`,
    ).toBeLessThanOrEqual(LONG_TASK_BOUND_MS);
  });

  // HEL-1697: a single unbounded quantifier with a tail (`(a*)b`) is accepted by the allowlist but quadratic per cell (2.1 s
  // per 1,000 rows of 2,000 characters). This frame is LONG_ROWS x LONG_CELL_LENGTH = 12 x 10,000 (1.2e9 len^2 units, about
  // 120 KB): with the decline disabled the Playwright harness measures one 1.1-1.3 s main-thread task (1147, 1259, 1349 ms), far over the 100 ms bound. The frame is deliberately small in total
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
    // (10,000-character cells may need longer than the engine's 2 s per-step budget, depending on runner speed). If NEITHER
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
  // HEL-1807: `^(.*)$` is as quadratic as `(.*)$` when V8 may restart at every position, but it is anchored: V8 makes one
  // attempt per cell, and the cost model charges one attempt. Over the same 12 x 10,000 frame as the test above, the unrefined
  // model declines it (its per-position charge is about 2.4e9 units) and the refined one evaluates it on the client.
  test("a start-anchored pattern over long cells is evaluated on the client without blocking the main thread", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "regex-anchored" });
    expect(creds.email).toContain("hel1683");
    const longCell = "a".repeat(LONG_CELL_LENGTH);
    const pipelineId = await seed(page, longCell, LONG_ROWS);
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

    await startLongTaskWindow(page);
    const api = recordApi(page);
    await pattern.fill(ANCHORED_PATTERN);
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();
    // The saved pattern matches nothing (out is empty), so the cells can only hold the cell text if a run of `^(.*)$` produced them.
    await expect
      .poll(async () => (await outColumnCells(rows)).filter((c) => c.startsWith("aaaa")).length, {
        message: "the rows table shows the anchored pattern's out cells",
        timeout: 15_000,
      })
      .toBe(LONG_ROWS);
    await page.waitForTimeout(1500);
    const requests = api.stop();
    const reading = await longestTask(page);
    console.log(
      `[HEL-1807 e2e] anchored longest long task: ${reading.longest.toFixed(1)} ms (tasks: ${reading.all.map((n) => n.toFixed(1)).join(", ")}); requests: ${requests.join(", ")}`,
    );
    expect(
      requests.filter((r) => r.includes("/draft-preview")),
      `the anchored pattern is client-evaluated (no draft-preview request): ${requests.join(", ")}`,
    ).toEqual([]);
    expect(
      reading.longest,
      `anchored pattern ${ANCHORED_PATTERN}: longest main-thread task was ${reading.longest.toFixed(1)} ms, must be <= ${LONG_TASK_BOUND_MS} ms`,
    ).toBeLessThanOrEqual(LONG_TASK_BOUND_MS);
    expect(await outColumnCells(rows), "every out cell holds the whole cell").toEqual(
      Array.from({ length: LONG_ROWS }, () => longCell),
    );
  });
});
