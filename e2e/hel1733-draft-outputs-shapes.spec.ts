import { expect, test, type Page } from "@playwright/test";

import { attachApiRequestCounter, type ApiRequestCounter } from "./support/apiRequestCounter";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { clickRowMenuItem, selectRow, spineRows } from "./support/pipelineSpine";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1733: Output create, edit and delete, shapes and the aggregate tail are DRAFT entries while a pipeline draft is
// open. Each of the eight actions, with a draft already open: is enabled; sends no Output/step write and no request that
// names a client id (`draft-...`); shows the change in the spine's Outputs section; and Save & run then sends ONE
// `draft/save` whose body carries it. After a reload the saved Outputs equal what the draft showed. Desktop runs in
// light, the 375px phone in dark; one desktop-dark and one phone-light smoke cover the other pairs. Every wait is a
// readiness signal (an aria-current row, a loaded row count, the sheet's populated field picker).

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1733", displayName: "HEL-1733", domain: "example.test" } as const;
const DRAFT_TEXT = "Draft · unsaved changes";

type Viewport = "desktop" | "phone";
type Theme = "light" | "dark";

const SAVED_OUTPUT = "hel1733 saved chart";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface Seeded {
  pipelineId: string;
  stepIds: string[];
  outputId: string;
  dashboardId: string;
}

/** 14 rows; steps filter, sort, compute; a chart Output on sort bound to a panel on a dashboard. */
async function seed(page: Page): Promise<Seeded> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1733-src-runs",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1733-pipe-runs",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, { type, config });
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
  const output = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: SAVED_OUTPUT,
    nodeStepId: sort.id,
    config: { chartType: "line", fieldMapping: SEEDED_MAPPING },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  const dashboard = await post<{ id: string }>(page, "/api/dashboards", {
    name: "hel1733-dash",
  });
  await post(page, "/api/panels", {
    dashboardId: dashboard.id,
    title: "hel1733 panel",
    type: "output",
    config: { outputId: output.id },
  });
  return {
    pipelineId: pipeline.id,
    stepIds: [filter.id, sort.id, compute.id],
    outputId: output.id,
    dashboardId: dashboard.id,
  };
}

/** Everything the page asks of /api (any method) from now until `stop` is called. */
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

/** An Output or step write, or ANY request that names a client id (`draft-...`) other than the save and the preview. */
function forbidden(log: string[]): string[] {
  return log.filter(
    (r) =>
      (!r.startsWith("GET ") &&
        /\/(outputs|pipeline-steps|steps)(\/|$|\?)/.test(r.replace(/\/draft\/save/, ""))) ||
      /draft-[0-9a-z]/.test(r.replace(/\/draft\/save|\/draft-preview/g, "")),
  );
}

const stepSheet = (page: Page) => page.getByRole("dialog", { name: "Step editor" });
const outputCards = (page: Page) => page.locator(".spine-output-card .spine-card__name");
const outputNames = (page: Page) => outputCards(page).allTextContents();

async function openPipeline(page: Page, pipelineId: string, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
  await expect(outputCards(page).first()).toHaveText(SAVED_OUTPUT);
  await page.evaluate(() => document.fonts.ready);
}

async function closeStepSheet(page: Page): Promise<void> {
  const s = stepSheet(page);
  if (await s.isVisible()) {
    await s.getByRole("button", { name: "Close" }).first().click();
    await expect(s).toBeHidden();
  }
}

/** Opens a draft by editing step 1's filter threshold (the way HEL-1631's own specs do). */
async function openDraft(page: Page, viewport: Viewport): Promise<void> {
  if (viewport === "phone") {
    await page.getByRole("button", { name: /^Step 1:/ }).click();
    await expect(stepSheet(page)).toBeVisible();
    await settleTransitions(page);
    await stepSheet(page)
      .locator(".pipeline-detail-page__filter-condition-row input")
      .last()
      .fill("300");
    await closeStepSheet(page);
  } else {
    await selectRow(page, 0);
    await page.locator(".pipeline-detail-page__filter-condition-row input").last().fill("300");
  }
  await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
}

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
  await expect(stepSheet(page)).toBeVisible();
  await settleTransitions(page);
  await stepSheet(page)
    .getByRole("button", { name: /^Step actions for / })
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

const outputSheet = (page: Page) => page.getByRole("dialog", { name: /^(New output|Edit )/ });

/** The sheet is ready when its column-type check is done (no "Checking column types…" hint) and Save is enabled. */
async function sheetReady(page: Page): Promise<void> {
  const s = outputSheet(page);
  await expect(s.getByLabel("Name")).toBeVisible();
  await expect(s.getByText("Checking column types")).toHaveCount(0);
}

async function pickOption(page: Page, label: string, option: string | RegExp): Promise<void> {
  await outputSheet(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).first().click();
}

async function createTable(page: Page, name: string): Promise<void> {
  const s = outputSheet(page);
  await sheetReady(page);
  await s.getByLabel("Name").fill(name);
  await pickOption(page, "Output kind", "Table");
  await sheetReady(page);
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await expect(s).toBeHidden();
}

interface BodyOutput {
  id?: string;
  clientId?: string;
  name: string;
  nodeStepId?: string;
  nodeStepClientId?: string;
  rootId?: string;
  config?: Record<string, unknown>;
}
interface Body {
  steps: { id?: string; clientId?: string; type: string }[];
  outputs: BodyOutput[];
}

async function saveAndRun(page: Page, confirmCascade = false): Promise<Body> {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/draft/save") && r.request().method() === "POST" && r.status() < 300,
  );
  await page.getByRole("button", { name: "Save and run" }).click();
  if (confirmCascade) {
    const dialog = page.getByRole("dialog").filter({ hasText: "This save removes other things" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Output: ${SAVED_OUTPUT}`)).toBeVisible();
    await expect(dialog.getByText(/1 panel bound to those Outputs/)).toBeVisible();
    await dialog.getByRole("button", { name: "Remove and save" }).click();
  }
  const response = await saved;
  return JSON.parse(response.request().postData() ?? "{}") as Body;
}

interface Action {
  name: string;
  /** Output names in the spine after the action. */
  expected: string[];
  run: (page: Page, viewport: Viewport) => Promise<void>;
  verifyBody: (body: Body, seeded: Seeded) => void;
  cascade?: boolean;
  /** Reads what the server stored after the save and reload. */
  verifyStored?: (page: Page, seeded: Seeded) => Promise<void>;
}

const SEEDED_MAPPING = { xAxis: "date", yAxis: "duration_s" };
interface StoredOutput {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

const NEW = "hel1733 new output";

const ACTIONS: Action[] = [
  {
    name: "create Output on a saved step",
    expected: [SAVED_OUTPUT, NEW],
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, "Add output");
      await createTable(page, NEW);
    },
    verifyBody: (body, s) => {
      const created = body.outputs.filter((o) => o.clientId !== undefined);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ name: NEW, nodeStepId: s.stepIds[0] });
    },
  },
  {
    name: "create Output on the root",
    expected: [SAVED_OUTPUT, NEW],
    run: async (page) => {
      await closeStepSheet(page);
      await page.getByRole("button", { name: "New output" }).click();
      await createTable(page, NEW);
    },
    verifyBody: (body) => {
      const created = body.outputs.filter((o) => o.clientId !== undefined);
      expect(created).toHaveLength(1);
      expect(created[0].rootId).toBeTruthy();
    },
  },
  {
    name: "create Output on a draft-new step",
    expected: [SAVED_OUTPUT, NEW],
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, "Insert step after");
      const option = page.locator("#step-palette-option-limit");
      await expect(option).toBeVisible();
      await option.click();
      await expect(option).toBeHidden();
      await closeStepSheet(page);
      await expect(spineRows(page).nth(1).locator(".spine-row__count")).toHaveText(/\d/);
      await stepMenu(page, viewport, 1, "Add output");
      await createTable(page, NEW);
    },
    verifyBody: (body) => {
      const created = body.outputs.filter((o) => o.clientId !== undefined);
      expect(created).toHaveLength(1);
      expect(created[0].nodeStepClientId).toBeTruthy();
    },
  },
  {
    name: "edit an Output",
    expected: ["hel1733 renamed"],
    run: async (page) => {
      await closeStepSheet(page);
      await page.getByRole("button", { name: `Open ${SAVED_OUTPUT} output` }).click();
      const s = outputSheet(page);
      await sheetReady(page);
      await s.getByLabel("Name").fill("hel1733 renamed");
      await pickOption(page, "Chart type", "Bar");
      await s.getByRole("button", { name: "Save", exact: true }).click();
      await expect(s).toBeHidden();
    },
    verifyBody: (body, s) => {
      expect(body.outputs).toHaveLength(1);
      expect(body.outputs[0]).toMatchObject({ id: s.outputId, name: "hel1733 renamed" });
      // The WHOLE resulting config (D4): the new chart type, the seeded mapping untouched.
      expect(body.outputs[0].config).toMatchObject({
        chartType: "bar",
        fieldMapping: SEEDED_MAPPING,
      });
    },
    verifyStored: async (page, s) => {
      const res = await page.request.get(`/api/pipelines/${s.pipelineId}/outputs`);
      const list = (await res.json()) as { items?: StoredOutput[] } | StoredOutput[];
      const stored = (Array.isArray(list) ? list : (list.items ?? [])).find(
        (o) => o.id === s.outputId,
      );
      expect(stored, "the edited Output is stored").toBeDefined();
      expect(stored).toMatchObject({ name: "hel1733 renamed" });
      expect(stored?.config).toMatchObject({ chartType: "bar", fieldMapping: SEEDED_MAPPING });
    },
  },
  {
    name: "delete an Output bound to a panel",
    expected: [],
    cascade: true,
    run: async (page) => {
      await closeStepSheet(page);
      await page.getByRole("button", { name: `Open ${SAVED_OUTPUT} output` }).click();
      const s = outputSheet(page);
      await sheetReady(page);
      await s.getByRole("button", { name: "Delete", exact: true }).click();
      await s.getByRole("button", { name: /^Confirm delete \(removes from 1 dashboard\)/ }).click();
      await expect(s).toBeHidden();
    },
    verifyBody: (body) => {
      expect(body.outputs).toEqual([]);
    },
  },
  {
    name: "delete an Output created in the draft",
    expected: [SAVED_OUTPUT],
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, "Add output");
      await createTable(page, NEW);
      await closeStepSheet(page);
      await page.getByRole("button", { name: `Open ${NEW} output` }).click();
      const s = outputSheet(page);
      await sheetReady(page);
      await s.getByRole("button", { name: "Delete", exact: true }).click();
      await s.getByRole("button", { name: /^Confirm delete/ }).click();
      await expect(s).toBeHidden();
    },
    verifyBody: (body) => {
      expect(body.outputs.filter((o) => o.clientId !== undefined)).toEqual([]);
    },
  },
  {
    name: "shape",
    expected: [SAVED_OUTPUT],
    run: async (page, viewport) => {
      if (viewport === "desktop") {
        await closeStepSheet(page);
        await page.getByRole("button", { name: "Add Outputs from a shape" }).click();
      } else {
        await page.getByRole("button", { name: /^Pipeline actions|^More/ }).click();
        await page.getByRole("menuitem", { name: "Add Outputs from a shape" }).click();
      }
      const modal = page.getByRole("dialog", { name: "Add Outputs from a shape" });
      await modal.getByRole("button", { name: /Passthrough/ }).click();
      await modal.getByLabel("Fields").fill("date,status");
      await modal.getByRole("button", { name: "Add steps" }).click();
      await expect(modal).toBeHidden();
      await expect(spineRows(page)).toHaveCount(4);
      await expect(spineRows(page).nth(3).locator(".spine-row__count")).toHaveText(/\d/);
    },
    verifyBody: (body) => {
      expect(body.steps.filter((st) => st.clientId !== undefined)).toHaveLength(1);
    },
  },
  {
    name: "aggregate tail",
    expected: [SAVED_OUTPUT, "hel1733 by status"],
    run: async (page, viewport) => {
      await stepMenu(page, viewport, 0, "Add output");
      const s = outputSheet(page);
      await sheetReady(page);
      await s.getByLabel("Name").fill("hel1733 by status");
      await pickOption(page, "Group by field", "status");
      await pickOption(page, "Aggregation value field", "duration_s");
      await pickOption(page, "Aggregation function", /sum/i);
      await s.getByRole("button", { name: "Add as tail with aggregate" }).click();
      await expect(s).toBeHidden();
    },
    verifyBody: (body) => {
      expect(body.steps.filter((st) => st.type === "aggregate")).toHaveLength(1);
      expect(body.outputs.filter((o) => o.clientId !== undefined)).toHaveLength(1);
    },
  },
];

function describeMode(viewport: Viewport, theme: Theme, actions: Action[]) {
  test.describe(`HEL-1733 draft Outputs and shapes: ${viewport}, ${theme} (live)`, () => {
    test.use({
      viewport: viewport === "phone" ? { width: 375, height: 812 } : { width: 1280, height: 800 },
      actionTimeout: 15_000,
    });
    test.setTimeout(120_000);

    let counter: ApiRequestCounter;
    test.beforeEach(({ page }) => {
      counter = attachApiRequestCounter(page);
    });
    test.afterEach(() => {
      expect(counter.report().count429, `rate-limited: ${counter.describe()}`).toBe(0);
    });

    for (const action of actions) {
      test(`${action.name}: a draft entry, saved atomically`, async ({ page, request }) => {
        await registerAndLogin(page, request, {
          ...AUTH,
          label: `${viewport}-${action.name.replace(/\W+/g, "")}`,
        });
        const seeded = await seed(page);
        await openPipeline(page, seeded.pipelineId, theme);
        await openDraft(page, viewport);

        const recording = recordApi(page);
        await action.run(page, viewport);
        await closeStepSheet(page);
        await expect.poll(() => outputNames(page), { timeout: 10_000 }).toEqual(action.expected);
        await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
        await page.screenshot({
          path: evidencePath(
            "HEL-1733",
            `${viewport}-${theme}-${action.name.replace(/\W+/g, "-")}-draft.png`,
          ),
        });
        await page.waitForTimeout(800);
        expect(
          forbidden(recording.stop()),
          "no Output/step write, no client id on the wire",
        ).toEqual([]);

        const body = await saveAndRun(page, action.cascade);
        action.verifyBody(body, seeded);
        await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
        await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
        await page.reload();
        // The reloaded page has settled once step 1 shows its saved count; the Outputs list is then final.
        await expect(spineRows(page).first()).toBeVisible();
        await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
        await expect.poll(() => outputNames(page)).toEqual(action.expected);
        await action.verifyStored?.(page, seeded);
        if (action.cascade) {
          const panels = await page.request.get(`/api/dashboards/${seeded.dashboardId}/panels`);
          expect(((await panels.json()) as { items: unknown[] }).items).toHaveLength(0);
        }
      });
    }

    if (viewport === "desktop" && theme === "light") {
      test("Discard drops a created Output with no request", async ({ page, request }) => {
        await registerAndLogin(page, request, { ...AUTH, label: "discard" });
        const seeded = await seed(page);
        await openPipeline(page, seeded.pipelineId, theme);
        await openDraft(page, viewport);
        await ACTIONS[0].run(page, viewport);
        await expect.poll(() => outputNames(page)).toEqual(ACTIONS[0].expected);
        const recording = recordApi(page);
        await page.getByRole("button", { name: "Discard draft" }).click();
        await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
        await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT]);
        await page.waitForTimeout(1200);
        expect(recording.stop()).toEqual([]);
      });
    }
  });
}

describeMode("desktop", "light", ACTIONS);
describeMode("phone", "dark", ACTIONS);
describeMode("desktop", "dark", [ACTIONS[0]]);
describeMode("phone", "light", [ACTIONS[0]]);

const KEPT_DRAFT_PREFIX = "helio.pipelineDraft.";
const PIPELINES_LIST = /\/pipelines$/;

/** Opens the pipeline through the list (so Back/Forward return to it) and waits for step 1's saved count. */
async function openFromList(page: Page, pipelineId: string): Promise<void> {
  await page.goto("/pipelines");
  await page.locator(`a[href="/pipelines/${pipelineId}"]`).first().click();
  await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
  await expect(outputCards(page).first()).toHaveText(SAVED_OUTPUT);
}

async function createOnStepOne(page: Page, name: string): Promise<void> {
  await stepMenu(page, "desktop", 0, "Add output");
  await createTable(page, name);
}

test.describe("HEL-1733 draft Outputs: kept drafts, stale base, undo, the draft-aware sheet, a shape with an Output (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });
  test.setTimeout(120_000);

  test("a draft with a created Output survives Back and Forward and shows it again", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "kept" });
    const { pipelineId } = await seed(page);
    await openFromList(page, pipelineId);
    await openDraft(page, "desktop");
    await createOnStepOne(page, NEW);
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT, NEW]);

    await page.goBack();
    await expect(page).toHaveURL(PIPELINES_LIST);
    await page.goForward();
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT, NEW]);
    await expect(page.getByRole("alert").filter({ hasText: "changed since" })).toHaveCount(0);
  });

  test("[guard] a draft kept in the v2 format (no Outputs in it) restores, and is NOT stale", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "v2" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    const key = KEPT_DRAFT_PREFIX + pipelineId;
    await expect
      .poll(() => page.evaluate((k) => window.sessionStorage.getItem(k), key))
      .not.toBeNull();
    // Rewrite the kept copy exactly as the previous build stored it: version 2, no `outputEdits`, no `outputsBase`.
    await page.evaluate((k) => {
      const kept = JSON.parse(window.sessionStorage.getItem(k) ?? "{}") as {
        overlay: { ops: unknown; configs: unknown; enabled: unknown };
        base: string;
      };
      window.sessionStorage.setItem(
        k,
        JSON.stringify({
          overlay: {
            version: 2,
            ops: kept.overlay.ops,
            configs: kept.overlay.configs,
            enabled: kept.overlay.enabled,
          },
          base: kept.base,
        }),
      );
    }, key);
    await page.goto("/pipelines");
    await page.goto(`/pipelines/${pipelineId}`);
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
    await expect(outputCards(page).first()).toHaveText(SAVED_OUTPUT);
    await expect(page.getByRole("alert").filter({ hasText: "changed since" })).toHaveCount(0);
  });

  test("a stale base keeps an Output edit: Reload re-applies it and Save & run sends it", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "stale" });
    const { pipelineId, stepIds, outputId } = await seed(page);
    await openFromList(page, pipelineId);
    await openDraft(page, "desktop");
    await ACTIONS[3].run(page, "desktop");
    await expect.poll(() => outputNames(page)).toEqual(["hel1733 renamed"]);
    await page.goBack();
    await expect(page).toHaveURL(PIPELINES_LIST);

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
    await expect.poll(() => outputNames(page)).toEqual(["hel1733 renamed"]);
    const recording = recordApi(page);
    await page.getByRole("button", { name: "Save and run" }).click();
    await page.waitForTimeout(800);
    expect(recording.stop().some((r) => r.includes("/draft/save"))).toBe(false);

    await notice.getByRole("button", { name: "Reload the saved pipeline" }).click();
    await expect(notice).toHaveCount(0);
    await expect.poll(() => outputNames(page)).toEqual(["hel1733 renamed"]);
    const body = await saveAndRun(page);
    expect(body.outputs[0]).toMatchObject({ id: outputId, name: "hel1733 renamed" });
  });

  test("Undo after saving a created Output and an edit of it restores the prior Outputs", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "undo" });
    const { pipelineId } = await seed(page);
    const read = async () => {
      const res = await page.request.get(`/api/pipelines/${pipelineId}?definition=true`);
      return (await res.json()) as { fingerprint: string };
    };
    const original = await read();
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    await createOnStepOne(page, NEW);
    await page.getByRole("button", { name: `Open ${NEW} output` }).click();
    const s = outputSheet(page);
    await sheetReady(page);
    await s.getByLabel("Name").fill("hel1733 edited new");
    await s.getByRole("button", { name: "Save", exact: true }).click();
    await expect(s).toBeHidden();
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT, "hel1733 edited new"]);

    const body = await saveAndRun(page);
    expect(body.outputs.filter((o) => o.clientId !== undefined)).toHaveLength(1);
    await expect(page.getByLabel("Notifications").getByText("Saved.")).toBeVisible();
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT, "hel1733 edited new"]);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Notifications").getByText("Undone.")).toBeVisible();
    expect((await read()).fingerprint).toBe(original.fingerprint);
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT]);
  });

  test("the sheet on a draft-new step lists the draft's columns from the server projection and names no draft id in any request", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "sheet" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    await clickRowMenuItem(page, 0, "Insert step after");
    const option = page.locator("#step-palette-option-limit");
    await expect(option).toBeVisible();
    await option.click();
    await expect(option).toBeHidden();
    await expect(spineRows(page).nth(1).locator(".spine-row__count")).toHaveText(/\d/);

    const recording = recordApi(page);
    await clickRowMenuItem(page, 1, "Add output");
    const s = outputSheet(page);
    await sheetReady(page);
    await s.getByRole("combobox", { name: "Group by field" }).click();
    await expect(page.getByRole("option", { name: "status" }).first()).toBeVisible();
    await expect(page.getByRole("option", { name: "duration_s" }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await s.getByRole("button", { name: "Cancel" }).click();
    await expect(s).toBeHidden();
    const log = recording.stop();
    expect(
      log.filter((r) => /draft-[0-9a-z]/.test(r.replace(/\/draft-preview/g, ""))),
      "no request names a draft id",
    ).toEqual([]);
    expect(log.filter((r) => r.includes("/analyze-proposal"))).not.toHaveLength(0);
    expect(forbidden(log)).toEqual([]);
  });

  test("(stubbed /expand) a shape with an Output is one draft entry: the step and the Output are saved together", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "shapeout" });
    const { pipelineId } = await seed(page);
    await page.route("**/api/pipeline-shapes/passthrough/expand", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          steps: [{ clientId: "step-0", kind: "select", config: { fields: ["date", "status"] } }],
          outputs: [{ nodeStepId: "step-0", kind: "table", name: "Shape output", config: {} }],
        }),
      }),
    );
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    await closeStepSheet(page);
    await ACTIONS[6].run(page, "desktop");
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT, "Shape output"]);
    const body = await saveAndRun(page);
    expect(body.steps.filter((st) => st.clientId !== undefined)).toHaveLength(1);
    const created = body.outputs.filter((o) => o.clientId !== undefined);
    expect(created).toHaveLength(1);
    expect(created[0].nodeStepClientId).toBeTruthy();
  });
});

test.describe("HEL-1733 draft Outputs: the Live Output column, Discard of everything, the type seam (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });
  test.setTimeout(120_000);

  test("the Live Output column renders a created Output from the draft rows and requests nothing by its client id", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "livecol" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    await closeStepSheet(page);
    await ACTIONS[1].run(page, "desktop");
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT, NEW]);

    const recording = recordApi(page);
    const column = page.getByRole("region", { name: "Live Output" });
    await column.getByRole("combobox", { name: "Displayed Output" }).click();
    await page.getByRole("option", { name: NEW }).click();
    // A root Output renders the cached sample: all 14 rows, labelled as the sample (a readiness signal, not a skeleton).
    await expect(column.getByText("Rendered from the cached sample.")).toBeVisible();
    await expect(
      column
        .locator(".live-output__tile")
        .filter({ hasText: "Rows out" })
        .locator(".live-output__tile-value"),
    ).toHaveText("14");
    await page.waitForTimeout(800);
    expect(
      recording.stop().filter((r) => /draft-[0-9a-z]/.test(r.replace(/\/draft-preview/g, ""))),
      "no request names the created Output's client id",
    ).toEqual([]);
    await page.screenshot({
      path: evidencePath("HEL-1733", "desktop-light-live-output-created.png"),
    });
  });

  test("Discard drops a created Output, an edit, a delete, a shape and an aggregate tail at once, with no request", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "discardall" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    const savedTitles = await spineRows(page).locator(".spine-row__title").allTextContents();
    await openDraft(page, "desktop");
    await closeStepSheet(page);

    // create, then edit a saved Output, then delete it, then a shape and an aggregate tail.
    await createOnStepOne(page, NEW);
    await page.getByRole("button", { name: `Open ${SAVED_OUTPUT} output` }).click();
    let s = outputSheet(page);
    await sheetReady(page);
    await s.getByLabel("Name").fill("hel1733 renamed");
    await s.getByRole("button", { name: "Save", exact: true }).click();
    await expect(s).toBeHidden();
    await page.getByRole("button", { name: "Open hel1733 renamed output" }).click();
    s = outputSheet(page);
    await sheetReady(page);
    await s.getByRole("button", { name: "Delete", exact: true }).click();
    await s.getByRole("button", { name: /^Confirm delete/ }).click();
    await expect(s).toBeHidden();
    await ACTIONS[6].run(page, "desktop");
    await ACTIONS[7].run(page, "desktop");
    await closeStepSheet(page);
    await expect.poll(() => outputNames(page)).toEqual([NEW, "hel1733 by status"]);
    await expect(spineRows(page)).toHaveCount(savedTitles.length + 2);

    const recording = recordApi(page);
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByText(DRAFT_TEXT)).toHaveCount(0);
    await expect.poll(() => outputNames(page)).toEqual([SAVED_OUTPUT]);
    await expect
      .poll(() => spineRows(page).locator(".spine-row__title").allTextContents())
      .toEqual(savedTitles);
    await page.waitForTimeout(1200);
    expect(recording.stop()).toEqual([]);
  });

  test("the sheet's histogram field follows the DRAFT's column types from the real analyze-proposal: a draft cast makes a text column offerable", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "typeseam" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId, "light");
    await openDraft(page, "desktop");
    await clickRowMenuItem(page, 2, "Insert step after");
    const option = page.locator("#step-palette-option-cast");
    await expect(option).toBeVisible();
    await option.click();
    await expect(option).toBeHidden();
    await selectRow(page, 3);
    // The cast editor lists the columns the draft frame delivers: ready once `status` has its row.
    const castStatus = page.getByRole("combobox", { name: "Target type for status" });
    await expect(castStatus).toBeVisible();

    const histogramOffers = async (): Promise<string[]> => {
      await clickRowMenuItem(page, 3, "Add output");
      const sheet = outputSheet(page);
      await sheetReady(page);
      await pickOption(page, "Chart type", "Histogram");
      await sheet.getByRole("combobox", { name: "Histogram field" }).click();
      const names = await page.getByRole("option").allTextContents();
      await page.keyboard.press("Escape");
      await sheet.getByRole("button", { name: "Cancel" }).click();
      await expect(sheet).toBeHidden();
      return names;
    };
    expect(await histogramOffers(), "before the cast `status` is text").not.toContain("status");

    await castStatus.click();
    await page.getByRole("option", { name: "float", exact: true }).click();
    await expect(page.getByText(DRAFT_TEXT).first()).toBeVisible();
    await page.screenshot({ path: evidencePath("HEL-1733", "desktop-light-type-seam.png") });
    expect(await histogramOffers(), "after the draft cast `status` is a float").toContain("status");
  });
});

for (const [viewport, theme] of [
  ["desktop", "light"],
  ["desktop", "dark"],
  ["phone", "light"],
  ["phone", "dark"],
] as const) {
  test.describe(`HEL-1733 the sheet's draft hint is read before Save: ${viewport}, ${theme} (live)`, () => {
    test.use({
      viewport: viewport === "phone" ? { width: 375, height: 812 } : { width: 1280, height: 800 },
      actionTimeout: 15_000,
    });
    test.setTimeout(120_000);

    test("create and edit mode show it in view, spaced from the fields", async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, { ...AUTH, label: `hint-${viewport}-${theme}` });
      const { pipelineId } = await seed(page);
      await openPipeline(page, pipelineId, theme);
      await openDraft(page, viewport);
      for (const mode of ["create", "edit"] as const) {
        if (mode === "create") await stepMenu(page, viewport, 0, "Add output");
        else {
          await closeStepSheet(page);
          await page.getByRole("button", { name: `Open ${SAVED_OUTPUT} output` }).click();
        }
        const s = outputSheet(page);
        await sheetReady(page);
        const hint = s.getByText("Saved with the draft on Save & run");
        // Readable without scrolling the body, and not flush against the field above it.
        await expect(hint).toBeInViewport();
        const gap = await hint.evaluate((el) => {
          const prev = el.previousElementSibling as HTMLElement;
          return el.getBoundingClientRect().top - prev.getBoundingClientRect().bottom;
        });
        expect(gap).toBeGreaterThanOrEqual(8);
        await page.screenshot({
          path: evidencePath("HEL-1733", `sheet-hint-${viewport}-${theme}-${mode}.png`),
        });
        await s.getByRole("button", { name: "Cancel" }).click();
        await expect(s).toBeHidden();
      }
    });
  });
}
