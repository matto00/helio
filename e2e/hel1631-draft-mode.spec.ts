import { expect, test, type Page } from "@playwright/test";

import {
  attachApiRequestCounter,
  MAX_WINDOW_TARGET,
  type ApiRequestCounter,
} from "./support/apiRequestCounter";
import { registerAndLogin } from "./support/auth";
import { psql } from "./support/db.cjs";
import { evidencePath } from "./support/evidencePath";
import { startBreakdown } from "./support/hel1691Breakdown";

// HEL-1631: the pipeline page's draft mode, proven against the running app. Editing a step makes a client-only draft; a
// client-evaluable edit recomputes counts and rows in the browser with NO request at all; a server-only step goes through the
// paced draft-preview transport and never a run endpoint; Discard is exact and silent; Save & run is one atomic request with a
// run, and Undo restores the saved definition. Every "no request" claim below is checked against a log of EVERY /api request the
// page makes in the window (any method), not against one route.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1631", displayName: "HEL-1631", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?.*)?$/;
/** The scheduler's pacing: a 600 ms floor between sends, so N seconds of continuous edits send at most this many + 1. */
const PACING_FLOOR_MS = 600;

interface Seeded {
  pipelineId: string;
  stepIds: string[];
  email: string;
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface SeedOptions {
  /** Include a server-only step (convertformat) after the client steps. */
  serverStep?: boolean;
  /** Seed the second step disabled. */
  disableSort?: boolean;
}

/** 14 rows, durations 260..351; filter >= 260 keeps all 14, so each +7 of the threshold removes one more row. */
async function seed(page: Page, email: string, options: SeedOptions = {}): Promise<Seeded> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
    `note ${i}`,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1631-src-runs",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
      { name: "note", type: "string" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1631-pipe-runs",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown, extra: object = {}) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, { type, config, ...extra });
  const filter = await step("filter", {
    combinator: "and",
    conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
  });
  const sort = await step("sort", { sortBy: [{ field: "date", direction: "asc" }] });
  const compute = await step("compute", {
    column: "duration_min",
    expression: "$duration_s / 60",
    type: "float",
  });
  const stepIds = [filter.id, sort.id, compute.id];
  if (options.serverStep) {
    const convert = await step("convertformat", { field: "note", from: "text", to: "markdown" });
    stepIds.push(convert.id);
  }
  if (options.disableSort) {
    const res = await page.request.patch(`/api/pipeline-steps/${sort.id}`, {
      data: { enabled: false },
      headers: CSRF,
    });
    expect(res.status(), await res.text()).toBeLessThan(300);
  }
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return { pipelineId: pipeline.id, stepIds, email };
}

/** Everything the page asks of /api, any method, from now until the returned reader is called. */
function recordApi(page: Page): { stop: () => string[] } {
  const log: string[] = [];
  const onRequest = (r: { method(): string; url(): string }) => {
    const { pathname, search } = new URL(r.url());
    if (pathname.startsWith("/api/")) log.push(`${r.method()} ${pathname}${search}`);
  };
  page.on("request", onRequest);
  return {
    stop: () => {
      page.off("request", onRequest);
      return log;
    },
  };
}

/** Opens the pipeline and waits until the page has settled: spine rows, the one preview request and the source sample. */
async function openPipeline(page: Page, pipelineId: string): Promise<void> {
  const sample = page.waitForResponse((r) =>
    SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
  );
  await page.goto(`/pipelines/${pipelineId}`);
  await sample;
  await expect(page.getByRole("region", { name: /^Rows after step 1/ })).toBeVisible();
  await expect(page.locator(".step-preview__body tbody tr").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const filterValueInput = (page: Page) =>
  page.locator(".pipeline-detail-page__filter-condition-row input").last();
const stepCount = (page: Page, n: number) =>
  page.locator(".spine-row").nth(n).locator(".spine-row__count");

/** Sets the filter value the way a user's keystroke does and returns the milliseconds until step 1's count text changed. */
async function timedFilterEdit(page: Page, value: string): Promise<number> {
  return page.evaluate(
    (next) =>
      new Promise<number>((resolve) => {
        const input = document.querySelectorAll<HTMLInputElement>(
          ".pipeline-detail-page__filter-condition-row input",
        );
        const target = document.querySelector(".spine-row .spine-row__count");
        const field = input[input.length - 1];
        if (!field || !target) return resolve(-1);
        const before = target.textContent;
        const observer = new MutationObserver(() => {
          if (target.textContent !== before) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(target, { childList: true, characterData: true, subtree: true });
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        const start = performance.now();
        setter.call(field, next);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        setTimeout(() => {
          observer.disconnect();
          resolve(-2);
        }, 2000);
      }),
    value,
  );
}

// HEL-1691: the burst test is measured against the production build (React's development runtime alone is ~60% of an edit's cost
// on a CI runner); the `@prod-build` tag below is the whole opt-in (playwright.config.ts, `prod-build` project).
const BURST_TITLE =
  "a burst of client-evaluable edits sends no request of any kind and updates counts and rows within 50 ms each (the first edit within 100 ms)";

test.describe("HEL-1631 draft mode (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(120_000);

  let counter: ApiRequestCounter;
  test.beforeEach(({ page }) => {
    counter = attachApiRequestCounter(page);
  });
  test.afterEach(async ({ page: _page }, info) => {
    const r = counter.report();
    console.log(`[HEL-1631 e2e] ${info.title}: ${counter.describe()}`);
    expect(r.count429, `rate-limited (429) responses: ${counter.describe()}`).toBe(0);
    expect(
      r.maxWindow,
      `worst 60s /api window exceeds ${MAX_WINDOW_TARGET}: ${counter.describe()}`,
    ).toBeLessThanOrEqual(MAX_WINDOW_TARGET);
  });

  test(BURST_TITLE, { tag: "@prod-build" }, async ({ page, request }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "burst" });
    const { pipelineId } = await seed(page, creds.email);
    await openPipeline(page, pipelineId);
    await expect(stepCount(page, 0)).toHaveText("14");

    const recording = recordApi(page);
    const latencies: number[] = [];
    // HEL-1691: per-edit CPU-vs-wall breakdown, logged before the first `expect` so a failure carries it.
    const breakdown = await startBreakdown(page);
    for (let k = 1; k <= 10; k += 1) {
      latencies.push(await breakdown.measure(k, () => timedFilterEdit(page, String(260 + 7 * k))));
    }
    breakdown.log();
    // Let any debounced request that a regression would send (a 400 ms PATCH, a 500 ms preview) fire inside the window.
    await page.waitForTimeout(1500);
    const requests = recording.stop();

    expect(requests, `requests during the burst: ${requests.join(", ")}`).toEqual([]);
    expect(
      latencies.every((ms) => ms >= 0),
      `every edit updated the count: ${latencies}`,
    ).toBe(true);
    console.log(
      `[HEL-1631 e2e] per-edit latency ms: ${latencies.map((n) => n.toFixed(1)).join(", ")}`,
    );
    // The first edit runs cold JS (lazy V8 compile, ~20-25 ms at 4x CPU, see design.md); owner ruling `relax-cold-first-edit`.
    expect(latencies[0], `first edit: ${latencies}`).toBeLessThan(100);
    expect(Math.max(...latencies.slice(1)), `edits 2-10: ${latencies}`).toBeLessThan(50);

    await expect(stepCount(page, 0)).toHaveText("14 → 4");
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();
    const table = page.getByRole("region", { name: /^Rows after step 1/ });
    await expect(table.getByText("4 rows")).toBeVisible();
    await expect(table.getByLabel("Preview is live")).toBeVisible();
    await page.screenshot({ path: evidencePath("HEL-1631", "burst-1280-dark.png") });
  });

  test("Discard restores the saved pipeline exactly, with zero requests", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "discard" });
    const { pipelineId } = await seed(page, creds.email, { disableSort: true });
    const read = async () => {
      const res = await page.request.get(`/api/pipelines/${pipelineId}?definition=true`);
      expect(res.status()).toBe(200);
      return (await res.json()) as { fingerprint: string; definition: unknown };
    };
    const before = await read();
    await openPipeline(page, pipelineId);

    const snapshot = async () => ({
      titles: await page.locator(".spine-row__title").allTextContents(),
      summaries: await page.locator(".spine-row__summary").allTextContents(),
      off: await page.locator(".spine-row--disabled").count(),
      counts: await page.locator(".spine-row__count").allTextContents(),
      value: await filterValueInput(page).inputValue(),
    });
    // Show every step's saved preview once before the draft, so Discard has nothing left to fetch whichever step it lands on.
    for (const n of [3, 2, 1]) {
      await page.getByRole("button", { name: new RegExp(`^Step ${n}:`) }).click();
      await page.waitForTimeout(1500);
    }
    const saved = await snapshot();

    await timedFilterEdit(page, "300");
    await page.getByRole("button", { name: "Disable step" }).click();
    await page.getByRole("button", { name: /^Step 3:/ }).click();
    await page.getByRole("button", { name: "Remove step" }).click();
    await expect(page.locator(".spine-row")).toHaveCount(2);

    const recording = recordApi(page);
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByText("Draft · unsaved changes")).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(recording.stop()).toEqual([]);

    await page.getByRole("button", { name: /^Step 1:/ }).click();
    await expect(filterValueInput(page)).toBeVisible();
    expect(await snapshot()).toEqual(saved);
    const after = await read();
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.definition).toEqual(before.definition);
    await expect(page.getByRole("button", { name: "Run pipeline" })).toBeVisible();
  });

  test("Save & run is ONE draft save with a run and ONE journal row; Undo restores the saved definition; a disabled step stays disabled", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "save" });
    const { pipelineId, stepIds } = await seed(page, creds.email, { disableSort: true });
    const journalRows = () =>
      Number(
        psql(
          `select count(*) from patch_set_applications where owner_id = (select id from users where email = '${creds.email}')`,
        )[0],
      );
    const definition = async () => {
      const res = await page.request.get(`/api/pipelines/${pipelineId}?definition=true`);
      return (await res.json()) as {
        fingerprint: string;
        definition: { steps: { id: string; enabled?: boolean; config: unknown }[] };
      };
    };
    const original = await definition();
    const journalBefore = journalRows();
    await openPipeline(page, pipelineId);

    await timedFilterEdit(page, "300");
    const recording = recordApi(page);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/pipelines/*/draft/save", async (route) => {
      await gate;
      await route.continue();
    });
    const saved = page.waitForResponse(
      (r) => r.url().includes("/draft/save") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save and run" }).click();

    // While the request is open the header already shows the run, and Save & run / Discard are disabled.
    await expect(page.getByLabel("Run status: queued")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save and run" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Discard draft" })).toBeDisabled();
    release();
    const response = await saved;
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      saved: { applicationId: string };
      run: { started: boolean };
    };
    expect(body.run.started).toBe(true);

    await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
    await expect(page.getByText("Draft · unsaved changes")).toHaveCount(0);
    await page.waitForTimeout(1500);
    const requests = recording.stop();
    expect(
      requests.filter((r) => r === `POST /api/pipelines/${pipelineId}/draft/save`),
    ).toHaveLength(1);
    expect(requests.some((r) => r.startsWith("PATCH ") || r.startsWith("DELETE "))).toBe(false);
    expect(requests.filter((r) => r.includes("?definition=true"))).toHaveLength(1);
    console.log(`[HEL-1631 e2e] Save & run requests: ${requests.join(" | ")}`);

    // The finished run's persisted counts are shown, and the save wrote exactly one journal row.
    await expect(stepCount(page, 0)).toHaveText("8");
    expect(journalRows()).toBe(journalBefore + 1);
    const saved1 = await definition();
    expect(saved1.definition.steps.find((s) => s.id === stepIds[1])?.enabled).toBe(false);
    expect(saved1.fingerprint).not.toBe(original.fingerprint);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Notifications").getByText("Undone.")).toBeVisible();
    expect((await definition()).fingerprint).toBe(original.fingerprint);
    await expect(filterValueInput(page)).toHaveValue("260");
  });

  test("a server-only step updates through the draft-preview transport: pending, paced, never a run endpoint", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "server" });
    const { pipelineId, stepIds } = await seed(page, creds.email, { serverStep: true });
    await openPipeline(page, pipelineId);
    await page.getByRole("button", { name: /^Step 4:/ }).click();
    const destination = page.getByRole("textbox", { name: "Destination field" });
    await expect(destination).toBeVisible();

    const recording = recordApi(page);
    const started = Date.now();
    for (let i = 0; i < 30; i += 1) {
      await destination.fill(`out${i}`);
      await page.waitForTimeout(100);
    }
    const elapsed = Date.now() - started;
    // The pending state is visible while a request is queued or in flight.
    await expect(page.getByRole("button", { name: /^Step 4:/ })).toBeVisible();
    await expect(page.getByLabel("Preview is live")).toBeVisible({ timeout: 8000 });
    const requests = recording.stop();
    const previews = requests.filter(
      (r) => r === `POST /api/pipelines/${pipelineId}/draft-preview`,
    );
    const bound = Math.ceil(elapsed / PACING_FLOOR_MS) + 2;
    console.log(
      `[HEL-1631 e2e] ${previews.length} draft-preview requests in ${elapsed} ms (bound ${bound})`,
    );
    expect(previews.length).toBeGreaterThan(0);
    expect(previews.length).toBeLessThanOrEqual(bound);
    expect(requests.filter((r) => !r.includes("/draft-preview"))).toEqual([]);
    expect(requests.some((r) => /\/run($|\?)/.test(r))).toBe(false);
    await expect(stepCount(page, 3)).toHaveText("14");
    expect(stepIds).toHaveLength(4);
    await page.screenshot({ path: evidencePath("HEL-1631", "server-step-1280-dark.png") });
  });

  test("a base that changed under the draft offers ONLY 'Reload the saved pipeline', and the draft survives the reload", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "stale" });
    const { pipelineId, stepIds } = await seed(page, creds.email);
    await openPipeline(page, pipelineId);
    await timedFilterEdit(page, "300");

    // Another session changes the pipeline after this page loaded.
    const patch = await page.request.patch(`/api/pipeline-steps/${stepIds[1]}`, {
      data: { config: { sortBy: [{ field: "status", direction: "asc" }] } },
      headers: CSRF,
    });
    expect(patch.status(), await patch.text()).toBeLessThan(300);

    const recording = recordApi(page);
    await page.getByRole("button", { name: "Save and run" }).click();
    const notice = page
      .getByRole("alert")
      .filter({ hasText: "This pipeline changed since you started editing." });
    await expect(notice).toBeVisible();
    await expect(notice.getByRole("button")).toHaveText(["Reload the saved pipeline"]);
    expect(recording.stop().some((r) => r.includes("/draft/save"))).toBe(false);

    await notice.getByRole("button", { name: "Reload the saved pipeline" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();
    await expect(filterValueInput(page)).toHaveValue("300");

    const save = page.waitForResponse(
      (r) => r.url().includes("/draft/save") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save and run" }).click();
    expect((await save).status()).toBe(200);
  });

  test("a run the guard refused after the save committed says so, with the retry time and a Run now action", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "refused" });
    const { pipelineId } = await seed(page, creds.email);
    await openPipeline(page, pipelineId);
    await timedFilterEdit(page, "300");
    // The real save commits; only its `run` outcome is replaced (the backend half is HEL-1629's own spec).
    await page.route("**/api/pipelines/*/draft/save", async (route) => {
      const real = await route.fetch();
      const json = await real.json();
      json.run = {
        started: false,
        code: 429,
        retryAfterSeconds: 12,
        reason: "Pipeline run rate limit exceeded",
      };
      await route.fulfill({ response: real, json });
    });
    await page.getByRole("button", { name: "Save and run" }).click();
    await expect(
      page
        .getByLabel("Notifications")
        .getByText("Saved. Run not started: rate limit, retry in 12 s"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
    await expect(page.getByText("Draft · unsaved changes")).toHaveCount(0);
    await page.screenshot({ path: evidencePath("HEL-1631", "run-refused-1280-dark.png") });
  });

  test("Back with a draft open does not lose it: forward again shows the same draft (skeptic-final-1 CR1)", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "back" });
    const { pipelineId } = await seed(page, creds.email);
    await page.goto("/pipelines");
    await page.locator(`a[href="/pipelines/${pipelineId}"]`).first().click();
    await expect(page.getByRole("region", { name: /^Rows after step 1/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await timedFilterEdit(page, "300");
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/pipelines$/);
    await page.goForward();
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();
    await expect(filterValueInput(page)).toHaveValue("300");
    await expect(stepCount(page, 0)).toContainText("→");
  });

  test("a draft kept across Back is NOT silently saved over a change made while away: the stale path applies (skeptic-final-2)", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "back-stale" });
    const { pipelineId, stepIds } = await seed(page, creds.email);
    await page.goto("/pipelines");
    await page.locator(`a[href="/pipelines/${pipelineId}"]`).first().click();
    await expect(page.getByRole("region", { name: /^Rows after step 1/ })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await timedFilterEdit(page, "300");
    await page.goBack();
    await expect(page).toHaveURL(/\/pipelines$/);

    const patch = await page.request.patch(`/api/pipeline-steps/${stepIds[1]}`, {
      data: { config: { sortBy: [{ field: "status", direction: "asc" }] } },
      headers: CSRF,
    });
    expect(patch.status(), await patch.text()).toBeLessThan(300);

    await page.goForward();
    const notice = page
      .getByRole("alert")
      .filter({ hasText: "This pipeline changed since you started editing." });
    await expect(notice).toBeVisible();
    await expect(page.getByText("Draft · unsaved changes")).toBeVisible();
    const recording = recordApi(page);
    await page.getByRole("button", { name: "Save and run" }).click();
    await page.waitForTimeout(800);
    expect(recording.stop().some((r) => r.includes("/draft/save"))).toBe(false);
    await expect(notice).toBeVisible();
  });

  // skeptic-final-1 CR5, owner ruling `amend-ac-fetch-on-view`: a step first opened WHILE the draft exists has no cached saved
  // preview, so Discard sends no request of its own and that step fetches its one preview on view, nothing else.
  test("after Discard, a step first opened during the draft fetches exactly its own saved preview and nothing else", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "discard-fresh" });
    const { pipelineId, stepIds } = await seed(page, creds.email);
    await openPipeline(page, pipelineId);
    await timedFilterEdit(page, "300");
    await page.getByRole("button", { name: /^Step 3:/ }).click();
    await page.waitForTimeout(500);
    const recording = recordApi(page);
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByText("Draft · unsaved changes")).toHaveCount(0);
    await page.waitForTimeout(1500);
    const sent = recording.stop();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(`GET /api/pipelines/${pipelineId}/steps/${stepIds[2]}/preview`);
  });

  test("structural controls are disabled with a reason while a draft exists", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "blocked" });
    const { pipelineId } = await seed(page, creds.email);
    await openPipeline(page, pipelineId);
    await timedFilterEdit(page, "300");
    const add = page.getByRole("button", { name: "+ Add transformation step" });
    await expect(add).toBeDisabled();
    await expect(add).toHaveAttribute("title", "Save or discard your draft first");
    await expect(page.getByRole("button", { name: "Duplicate step" })).toBeDisabled();
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(add).toBeEnabled();
  });
});

test.describe("HEL-1631 draft mode on a phone (live)", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.setTimeout(120_000);

  test("375px: the draft status fills the action bar's slot and the pills become Discard and Save & run", async ({
    page,
    request,
  }) => {
    const counter = attachApiRequestCounter(page);
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "phone" });
    const { pipelineId } = await seed(page, creds.email);
    await page.goto(`/pipelines/${pipelineId}`);
    await page.getByRole("button", { name: /^Step 1:/ }).click();
    const sheet = page.getByRole("dialog", { name: "Step editor" });
    await expect(sheet).toBeVisible();

    const recording = recordApi(page);
    await sheet.locator(".pipeline-detail-page__filter-condition-row input").last().fill("300");
    await page.waitForTimeout(1200);
    expect(recording.stop()).toEqual([]);

    await sheet.getByRole("button", { name: "Close" }).first().click();
    const slot = page.locator('[data-slot="draft-status"]');
    await expect(slot).toHaveText("Draft · unsaved changes");
    await expect(page.getByRole("button", { name: "Discard draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save and run" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run pipeline" })).toHaveCount(0);

    // The list still clears the action bar.
    const bar = (await page.locator(".mobile-actions").boundingBox())!;
    const lastRow = (await page.locator(".spine-row").last().boundingBox())!;
    expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(bar.y + 1);
    await page.screenshot({ path: evidencePath("HEL-1631", "phone-375-draft-dark.png") });
    expect(counter.report().count429).toBe(0);
  });
});
