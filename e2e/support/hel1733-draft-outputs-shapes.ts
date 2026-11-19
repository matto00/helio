import { expect, test, type Page } from "@playwright/test";
import { attachApiRequestCounter, type ApiRequestCounter } from "./apiRequestCounter";
import { registerAndLogin } from "./auth";
import { evidencePath } from "./evidencePath";
import { clickRowMenuItem, selectRow, spineRows } from "./pipelineSpine";
import { settleTransitions } from "./settleTransitions";

// Shared by the parts of the HEL-1733 spec (split by HEL-1778); moved verbatim from the original spec file.
export const CSRF = { "X-Helio-Requested-With": "1" };
export const AUTH = { prefix: "hel1733", displayName: "HEL-1733", domain: "example.test" } as const;
export const DRAFT_TEXT = "Draft · unsaved changes";

export type Viewport = "desktop" | "phone";
export type Theme = "light" | "dark";

export const SAVED_OUTPUT = "hel1733 saved chart";

export async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

export interface Seeded {
  pipelineId: string;
  stepIds: string[];
  outputId: string;
  dashboardId: string;
}

/** 14 rows; steps filter, sort, compute; a chart Output on sort bound to a panel on a dashboard. */
export async function seed(page: Page): Promise<Seeded> {
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
export function recordApi(page: Page): { stop: () => string[] } {
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
export function forbidden(log: string[]): string[] {
  return log.filter(
    (r) =>
      (!r.startsWith("GET ") &&
        /\/(outputs|pipeline-steps|steps)(\/|$|\?)/.test(r.replace(/\/draft\/save/, ""))) ||
      /draft-[0-9a-z]/.test(r.replace(/\/draft\/save|\/draft-preview/g, "")),
  );
}

export const stepSheet = (page: Page) => page.getByRole("dialog", { name: "Step editor" });
export const outputCards = (page: Page) => page.locator(".spine-output-card .spine-card__name");
export const outputNames = (page: Page) => outputCards(page).allTextContents();

export async function openPipeline(page: Page, pipelineId: string, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("button", { name: /^Step 1: Filter rows, 14 rows/ })).toBeVisible();
  await expect(outputCards(page).first()).toHaveText(SAVED_OUTPUT);
  await page.evaluate(() => document.fonts.ready);
}

export async function closeStepSheet(page: Page): Promise<void> {
  const s = stepSheet(page);
  if (await s.isVisible()) {
    await s.getByRole("button", { name: "Close" }).first().click();
    await expect(s).toBeHidden();
  }
}

/** Opens a draft by editing step 1's filter threshold (the way HEL-1631's own specs do). */
export async function openDraft(page: Page, viewport: Viewport): Promise<void> {
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

export async function stepMenu(
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

export const outputSheet = (page: Page) =>
  page.getByRole("dialog", { name: /^(New output|Edit )/ });

/** The sheet is ready when its column-type check is done (no "Checking column types…" hint) and Save is enabled. */
export async function sheetReady(page: Page): Promise<void> {
  const s = outputSheet(page);
  await expect(s.getByLabel("Name")).toBeVisible();
  await expect(s.getByText("Checking column types")).toHaveCount(0);
}

export async function pickOption(
  page: Page,
  label: string,
  option: string | RegExp,
): Promise<void> {
  await outputSheet(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).first().click();
}

export async function createTable(page: Page, name: string): Promise<void> {
  const s = outputSheet(page);
  await sheetReady(page);
  await s.getByLabel("Name").fill(name);
  await pickOption(page, "Output kind", "Table");
  await sheetReady(page);
  await s.getByRole("button", { name: "Save", exact: true }).click();
  await expect(s).toBeHidden();
}

export interface BodyOutput {
  id?: string;
  clientId?: string;
  name: string;
  nodeStepId?: string;
  nodeStepClientId?: string;
  rootId?: string;
  config?: Record<string, unknown>;
}
export interface Body {
  steps: { id?: string; clientId?: string; type: string }[];
  outputs: BodyOutput[];
}

export async function saveAndRun(page: Page, confirmCascade = false): Promise<Body> {
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

export interface Action {
  name: string;
  /** Output names in the spine after the action. */
  expected: string[];
  run: (page: Page, viewport: Viewport) => Promise<void>;
  verifyBody: (body: Body, seeded: Seeded) => void;
  cascade?: boolean;
  /** Reads what the server stored after the save and reload. */
  verifyStored?: (page: Page, seeded: Seeded) => Promise<void>;
}

export const SEEDED_MAPPING = { xAxis: "date", yAxis: "duration_s" };
export interface StoredOutput {
  id: string;
  name: string;
  config: Record<string, unknown>;
}

export const NEW = "hel1733 new output";

export const ACTIONS: Action[] = [
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

export function describeMode(viewport: Viewport, theme: Theme, actions: Action[]) {
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
