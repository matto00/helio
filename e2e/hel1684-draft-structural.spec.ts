import { expect, test, type Locator, type Page } from "@playwright/test";

import { attachApiRequestCounter, type ApiRequestCounter } from "./support/apiRequestCounter";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { clickRowMenuItem, editorAction, selectRow, spineRows } from "./support/pipelineSpine";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1684: the step structure actions (add, insert, duplicate, "+ lane", Move up/down, drag) are DRAFT entries while a
// pipeline draft is open. Each one, with a draft already open: is enabled, sends no step write (and no request carrying a
// client id), shows the new structure with draft counts, and Save & run then sends ONE `draft/save` whose body carries the
// client id(s); after a reload the saved structure equals the structure the draft showed. Discard restores the saved
// pipeline with no request. Desktop runs in light, the 375px phone in dark; one desktop-dark and one phone-light smoke
// cover the other two theme/size pairs. Every wait is a readiness signal (an aria-current row, a loaded row count).

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1684", displayName: "HEL-1684", domain: "example.test" } as const;
const KEPT_DRAFT_PREFIX = "helio.pipelineDraft.";

const FILTER = "Filter rows";
const SORT = "Sort rows";
const COMPUTE = "Compute column";
const LIMIT = "Limit rows";

type Viewport = "desktop" | "phone";
type Theme = "light" | "dark";

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
  /** A "+ lane" step hanging off step 1 (a rename), so step 1 has a tail. */
  tail?: boolean;
}

/** 14 rows; filter >= 260 keeps all 14. Steps: filter, sort, compute (a trunk of three). */
async function seed(page: Page, email: string, options: SeedOptions = {}): Promise<Seeded> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1684-src-runs",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1684-pipe-runs",
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
  if (options.tail) {
    const tail = await step(
      "rename",
      { renames: { status: "state" } },
      { parentStepId: filter.id, attachAsTail: true },
    );
    stepIds.push(tail.id);
  }
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return { pipelineId: pipeline.id, stepIds, email };
}

interface Api {
  stop: () => string[];
  bodies: () => { url: string; method: string; body: string | null }[];
}

/** Everything the page asks of /api (any method) from now until `stop` is called. */
function recordApi(page: Page): Api {
  const log: string[] = [];
  const full: { url: string; method: string; body: string | null }[] = [];
  const onRequest = (r: { method(): string; url(): string; postData(): string | null }) => {
    const { pathname, search } = new URL(r.url());
    if (!pathname.startsWith("/api/")) return;
    log.push(`${r.method()} ${pathname}${search}`);
    full.push({ url: pathname + search, method: r.method(), body: r.postData() });
  };
  page.on("request", onRequest);
  return {
    stop: () => {
      page.off("request", onRequest);
      return log;
    },
    bodies: () => full,
  };
}

/** A step write: any non-GET to a step route, or ANY request that names a client id (`draft-...`). */
function stepWrites(log: string[]): string[] {
  return log.filter(
    (r) =>
      (!r.startsWith("GET ") && /\/(pipeline-steps|steps)(\/|$|\?)/.test(r)) ||
      /draft-[0-9a-z]/.test(r.replace(/\/draft\/save|\/draft-preview/g, "")),
  );
}

const DRAFT_TEXT = "Draft · unsaved changes";
const sheet = (page: Page) => page.getByRole("dialog", { name: "Step editor" });
const titles = (page: Page) => spineRows(page).locator(".spine-row__title").allTextContents();

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
}

/** Opens the pipeline and waits until step 1 shows its saved row count (the page has settled), in the given theme. */
async function openPipeline(page: Page, pipelineId: string, theme: Theme): Promise<void> {
  await setTheme(page, theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function closeSheet(page: Page): Promise<void> {
  const s = sheet(page);
  if (await s.isVisible()) {
    await s.getByRole("button", { name: "Close" }).first().click();
    await expect(s).toBeHidden();
  }
}

/** Opens a draft by editing step 1's filter threshold, the way HEL-1631's own specs do. */
async function openDraft(page: Page, viewport: Viewport): Promise<void> {
  if (viewport === "phone") {
    await page.getByRole("button", { name: /^Step 1:/ }).click();
    await expect(sheet(page)).toBeVisible();
    await settleTransitions(page);
    await sheet(page)
      .locator(".pipeline-detail-page__filter-condition-row input")
      .last()
      .fill("300");
    await closeSheet(page);
  } else {
    await selectRow(page, 0);
    await page.locator(".pipeline-detail-page__filter-condition-row input").last().fill("300");
  }
  await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
}

async function pickStep(page: Page, kind: string): Promise<void> {
  const option = page.locator(`#step-palette-option-${kind}`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(option).toBeHidden();
}

/** Opens step `index`'s quiet menu (the desktop row menu, or the phone sheet's "Step actions") and clicks an item. */
async function stepMenu(
  page: Page,
  viewport: Viewport,
  index: number,
  item: string | RegExp,
): Promise<void> {
  if (viewport === "desktop") {
    await clickRowMenuItem(page, index, item);
    return;
  }
  await spineRows(page).nth(index).locator(".spine-row__select").click();
  await expect(sheet(page)).toBeVisible();
  await settleTransitions(page);
  await sheet(page)
    .getByRole("button", { name: /^Step actions for / })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

interface Action {
  name: string;
  /** Spine titles after the action, in document order. */
  expected: string[];
  /** Whether the action adds a step (the Save & run body then carries exactly one client id). */
  addsStep: boolean;
  /** Where the new step is, when it adds one (its spine row index). */
  newRow?: number;
  run: (page: Page, viewport: Viewport) => Promise<void>;
  desktopOnly?: boolean;
  /** What the Save & run body must say, so one op cannot pass for another (a lane and an insert show the same titles). */
  verifyBody?: (steps: BodyStep[], stepIds: string[]) => void;
}

const ACTIONS: Action[] = [
  {
    name: "add step",
    expected: [FILTER, SORT, COMPUTE, LIMIT],
    addsStep: true,
    newRow: 3,
    run: async (page, viewport) => {
      await closeSheet(page);
      void viewport;
      await page.getByRole("button", { name: "+ Add transformation step" }).click();
      await pickStep(page, "limit");
    },
  },
  {
    name: "insert step",
    expected: [FILTER, LIMIT, SORT, COMPUTE],
    addsStep: true,
    newRow: 1,
    verifyBody: (steps, ids) => {
      const fresh = steps.find((st) => st.clientId !== undefined)!;
      expect(fresh).toMatchObject({ parentStepId: ids[0], position: 0 });
      expect(steps.find((st) => st.id === ids[1])).toMatchObject({
        parentClientId: fresh.clientId,
      });
    },
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, "Insert step after");
      await pickStep(page, "limit");
    },
  },
  {
    name: "duplicate step",
    expected: [FILTER, SORT, SORT, COMPUTE],
    addsStep: true,
    newRow: 2,
    verifyBody: (steps, ids) => {
      const clone = steps.find((st) => st.clientId !== undefined)!;
      expect(clone).toMatchObject({ parentStepId: ids[1], position: 0, type: "sort" });
      expect(steps.find((st) => st.id === ids[2])).toMatchObject({
        parentClientId: clone.clientId,
      });
    },
    run: async (page, viewport) => {
      if (viewport === "desktop") {
        await selectRow(page, 1);
        await editorAction(page, "Duplicate step").click();
      } else {
        await spineRows(page).nth(1).locator(".spine-row__select").click();
        await expect(sheet(page)).toBeVisible();
        await settleTransitions(page);
        await sheet(page).getByRole("button", { name: "Duplicate step" }).click();
      }
    },
  },
  {
    name: "+ lane step",
    expected: [FILTER, LIMIT, SORT, COMPUTE],
    addsStep: true,
    newRow: 1,
    verifyBody: (steps, ids) => {
      const lane = steps.find((st) => st.clientId !== undefined)!;
      expect(lane.parentStepId).toBe(ids[0]);
      expect(lane.position).toBeGreaterThanOrEqual(1);
      expect(steps.find((st) => st.id === ids[1])).toMatchObject({
        parentStepId: ids[0],
        position: 0,
      });
    },
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, "Branch from here");
      await pickStep(page, "limit");
    },
  },
  {
    name: "Move down",
    expected: [SORT, FILTER, COMPUTE],
    addsStep: false,
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, /^Move step down/);
    },
  },
  {
    name: "Move up",
    expected: [FILTER, COMPUTE, SORT],
    addsStep: false,
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 2, /^Move step up/);
    },
  },
  {
    name: "drag reorder",
    expected: [SORT, FILTER, COMPUTE],
    addsStep: false,
    desktopOnly: true,
    run: async (page) => {
      const src = await spineRows(page).nth(0).locator(".spine-row__grip").elementHandle();
      const dst = await spineRows(page).nth(2).elementHandle();
      // The grip is a plain HTML5 `draggable`; the drag events are dispatched on the elements the app listens on
      // (the same approach as hel908-trunk-reorder-drag.spec.ts), a frame apart so React commits the over index.
      await page.evaluate(
        async ([s, d]) => {
          const dataTransfer = new DataTransfer();
          const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const fire = (el: Element, type: string) =>
            el.dispatchEvent(
              new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
            );
          fire(s as Element, "dragstart");
          await raf();
          fire(d as Element, "dragover");
          await raf();
          await raf();
          fire(d as Element, "drop");
          await raf();
          fire(s as Element, "dragend");
        },
        [src, dst],
      );
    },
  },
];

function rowCount(page: Page): Locator {
  return spineRows(page);
}

interface BodyStep {
  id?: string;
  clientId?: string;
  type: string;
  parentStepId?: string;
  parentClientId?: string;
  position: number;
}

async function saveAndRun(page: Page): Promise<{ steps: BodyStep[] }> {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/draft/save") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save and run" }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  return JSON.parse(response.request().postData() ?? "{}");
}

function describeMode(viewport: Viewport, theme: Theme, actions: Action[], discard: boolean) {
  test.describe(`HEL-1684 draft structure actions: ${viewport}, ${theme} (live)`, () => {
    test.use({
      viewport: viewport === "phone" ? { width: 375, height: 812 } : { width: 1280, height: 800 },
    });
    test.setTimeout(120_000);
    // A disabled control fails its click after this, not after the whole test timeout.
    test.use({ actionTimeout: 15_000 });

    let counter: ApiRequestCounter;
    test.beforeEach(({ page }) => {
      counter = attachApiRequestCounter(page);
    });
    test.afterEach(() => {
      expect(counter.report().count429, `rate-limited: ${counter.describe()}`).toBe(0);
    });

    for (const action of actions) {
      test(`${action.name}: a draft entry, saved atomically with the structure the draft showed`, async ({
        page,
        request,
      }) => {
        const creds = await registerAndLogin(page, request, {
          ...AUTH,
          label: `${viewport}-${action.name.replace(/\W+/g, "")}`,
        });
        const { pipelineId, stepIds } = await seed(page, creds.email);
        await openPipeline(page, pipelineId, theme);
        await openDraft(page, viewport);

        const recording = recordApi(page);
        await action.run(page, viewport);
        await closeSheet(page);
        await expect.poll(() => titles(page), { timeout: 10_000 }).toEqual(action.expected);
        await expect(rowCount(page)).toHaveCount(action.expected.length);
        if (action.newRow !== undefined) {
          await expect(spineRows(page).nth(action.newRow).locator(".spine-row__count")).toHaveText(
            /\d/,
          );
        }
        await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
        const summaries = await spineRows(page).locator(".spine-row__summary").allTextContents();
        await page.screenshot({
          path: evidencePath(
            "HEL-1684",
            `${viewport}-${theme}-${action.name.replace(/\W+/g, "-")}-draft.png`,
          ),
        });
        await page.waitForTimeout(800);
        expect(stepWrites(recording.stop()), "no step write, no client id on the wire").toEqual([]);

        const body = await saveAndRun(page);
        const clientIds = body.steps.filter((s) => s.clientId !== undefined);
        expect(clientIds, JSON.stringify(body.steps)).toHaveLength(action.addsStep ? 1 : 0);
        expect(body.steps.filter((s) => s.clientId !== undefined && s.id !== undefined)).toEqual(
          [],
        );
        expect(body.steps).toHaveLength(action.expected.length);
        action.verifyBody?.(body.steps, stepIds);
        await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
        await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);

        await openPipeline(page, pipelineId, theme).catch(async () => {
          // After a move the first row is not "Filter rows, 14 rows": the structure assertion below is the real check.
          await expect(spineRows(page).first()).toBeVisible();
        });
        await expect.poll(() => titles(page)).toEqual(action.expected);
        expect(await spineRows(page).locator(".spine-row__summary").allTextContents()).toEqual(
          summaries,
        );
      });

      if (discard && !action.desktopOnly) {
        test(`${action.name}: Discard restores the saved pipeline with no request`, async ({
          page,
          request,
        }) => {
          const creds = await registerAndLogin(page, request, {
            ...AUTH,
            label: `${viewport}-d-${action.name.replace(/\W+/g, "")}`,
          });
          const { pipelineId } = await seed(page, creds.email);
          await openPipeline(page, pipelineId, theme);
          const saved = await titles(page);
          await openDraft(page, viewport);
          await action.run(page, viewport);
          await closeSheet(page);
          await expect.poll(() => titles(page)).toEqual(action.expected);

          const recording = recordApi(page);
          await page.getByRole("button", { name: "Discard draft" }).click();
          await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
          await expect.poll(() => titles(page)).toEqual(saved);
          await page.waitForTimeout(1200);
          expect(recording.stop()).toEqual([]);
        });
      }
    }
  });
}

describeMode("desktop", "light", ACTIONS, true);
describeMode(
  "phone",
  "dark",
  ACTIONS.filter((a) => !a.desktopOnly),
  false,
);
describeMode(
  "desktop",
  "dark",
  ACTIONS.filter((a) => a.name === "insert step"),
  false,
);
describeMode(
  "phone",
  "light",
  ACTIONS.filter((a) => a.name === "insert step"),
  false,
);

test.describe("HEL-1684 draft structure: kept drafts, stale base, undo, delete (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });
  test.setTimeout(120_000);

  test("a draft with an inserted step survives Back and Forward and is shown again", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "back" });
    const { pipelineId } = await seed(page, creds.email);
    await page.goto("/pipelines");
    await page.locator(`a[href="/pipelines/${pipelineId}"]`).first().click();
    await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
    await openDraft(page, "desktop");
    await clickRowMenuItem(page, 0, "Insert step after");
    await pickStep(page, "limit");
    await expect.poll(() => titles(page)).toEqual([FILTER, LIMIT, SORT, COMPUTE]);

    await page.goBack();
    await expect(page).toHaveURL(/\/pipelines$/);
    await page.goForward();
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
    await expect.poll(() => titles(page)).toEqual([FILTER, LIMIT, SORT, COMPUTE]);
  });

  test("[guard] a draft kept in the earlier format (deleted ids) still restores", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "v1" });
    const { pipelineId, stepIds } = await seed(page, creds.email);
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    const key = KEPT_DRAFT_PREFIX + pipelineId;
    await expect
      .poll(() => page.evaluate((k) => window.sessionStorage.getItem(k), key))
      .not.toBeNull();
    // Rewrite the kept copy exactly as the earlier build stored it: `{overlay: {configs, enabled, deleted}, base}`.
    await page.evaluate(
      ([k, deletedId]) => {
        const kept = JSON.parse(window.sessionStorage.getItem(k) ?? "{}") as {
          overlay: { configs: unknown; enabled: unknown };
          base: string;
        };
        window.sessionStorage.setItem(
          k,
          JSON.stringify({
            overlay: {
              configs: kept.overlay.configs,
              enabled: kept.overlay.enabled,
              deleted: [deletedId],
            },
            base: kept.base,
          }),
        );
      },
      [key, stepIds[1]],
    );
    await page.goto("/pipelines");
    await page.goto(`/pipelines/${pipelineId}`);
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
    await expect.poll(() => titles(page)).toEqual([FILTER, COMPUTE]);
  });

  test("a kept draft with a new step over a base that changed is restored as stale; Reload keeps the step", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "stale" });
    const { pipelineId, stepIds } = await seed(page, creds.email);
    await page.goto("/pipelines");
    await page.locator(`a[href="/pipelines/${pipelineId}"]`).first().click();
    await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
    await openDraft(page, "desktop");
    await clickRowMenuItem(page, 0, "Insert step after");
    await pickStep(page, "limit");
    await expect.poll(() => titles(page)).toEqual([FILTER, LIMIT, SORT, COMPUTE]);
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
    await expect.poll(() => titles(page)).toEqual([FILTER, LIMIT, SORT, COMPUTE]);
    const recording = recordApi(page);
    await page.getByRole("button", { name: "Save and run" }).click();
    await page.waitForTimeout(800);
    expect(recording.stop().some((r) => r.includes("/draft/save"))).toBe(false);

    await notice.getByRole("button", { name: "Reload the saved pipeline" }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => titles(page)).toEqual([FILTER, LIMIT, SORT, COMPUTE]);
    const body = await saveAndRun(page);
    expect(body.steps.filter((s) => s.clientId !== undefined)).toHaveLength(1);
  });

  test("Undo after saving an insert and a Move down restores the pre-draft structure, selection on a surviving step", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "undo" });
    const { pipelineId } = await seed(page, creds.email);
    const read = async () => {
      const res = await page.request.get(`/api/pipelines/${pipelineId}?definition=true`);
      return (await res.json()) as { fingerprint: string };
    };
    const original = await read();
    await openPipeline(page, pipelineId, "light");
    const before = await titles(page);
    await openDraft(page, "desktop");
    await clickRowMenuItem(page, 0, "Insert step after");
    await pickStep(page, "limit");
    await expect.poll(() => titles(page)).toEqual([FILTER, LIMIT, SORT, COMPUTE]);
    // Select the new step so the save has to resolve its selection, then Move it down.
    await selectRow(page, 1);
    await clickRowMenuItem(page, 1, /^Move step down/);
    await expect.poll(() => titles(page)).toEqual([FILTER, SORT, LIMIT, COMPUTE]);

    await saveAndRun(page);
    await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
    // The selected new step is now the saved step it became: same row, and the URL no longer names a client id.
    await expect(
      page.locator(".spine-row__select[aria-current='true'] .spine-row__title"),
    ).toHaveText(LIMIT);
    await expect.poll(() => new URL(page.url()).searchParams.get("step")).not.toMatch(/^draft-/);
    await expect.poll(() => titles(page)).toEqual([FILTER, SORT, LIMIT, COMPUTE]);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Notifications").getByText("Undone.")).toBeVisible();
    expect((await read()).fingerprint).toBe(original.fingerprint);
    await expect.poll(() => titles(page)).toEqual(before);
    await expect(page.locator(".spine-row__select[aria-current='true']")).toHaveCount(1);
  });

  test("deleting a step inserted after a step that has a tail removes the tail, and Save & run asks to confirm it by name", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "tail" });
    const { pipelineId } = await seed(page, creds.email, { tail: true });
    await openPipeline(page, pipelineId, "light");
    await expect(spineRows(page)).toHaveCount(4);
    await openDraft(page, "desktop");
    await clickRowMenuItem(page, 0, "Insert step after");
    await pickStep(page, "limit");
    await expect(spineRows(page)).toHaveCount(5);
    const newRow = spineRows(page).filter({ hasText: LIMIT }).first();
    await newRow.locator(".spine-row__select").click();
    await expect(newRow.locator(".spine-row__select")).toHaveAttribute("aria-current", "true");
    await editorAction(page, "Remove step").click();
    // The new step is gone, the first child (sort) took its slot, and the tail went with it.
    await expect.poll(() => titles(page)).toEqual([FILTER, SORT, COMPUTE]);
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();

    await page.getByRole("button", { name: "Save and run" }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Rename column" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: evidencePath("HEL-1684", "desktop-light-tail-cascade.png") });
  });
});
