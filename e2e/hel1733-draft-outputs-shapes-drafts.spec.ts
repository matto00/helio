import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { clickRowMenuItem, selectRow, spineRows } from "./support/pipelineSpine";
import {
  CSRF,
  AUTH,
  DRAFT_TEXT,
  SAVED_OUTPUT,
  seed,
  recordApi,
  forbidden,
  outputCards,
  outputNames,
  openPipeline,
  closeStepSheet,
  openDraft,
  stepMenu,
  outputSheet,
  sheetReady,
  pickOption,
  createTable,
  saveAndRun,
  NEW,
  ACTIONS,
} from "./support/hel1733-draft-outputs-shapes";

// HEL-1733: Output create, edit and delete, shapes and the aggregate tail are DRAFT entries while a pipeline draft is
// open. Each of the eight actions, with a draft already open: is enabled; sends no Output/step write and no request that
// names a client id (`draft-...`); shows the change in the spine's Outputs section; and Save & run then sends ONE
// `draft/save` whose body carries it. After a reload the saved Outputs equal what the draft showed. Desktop runs in
// light, the 375px phone in dark; one desktop-dark and one phone-light smoke cover the other pairs. Every wait is a
// readiness signal (an aria-current row, a loaded row count, the sheet's populated field picker).
// Part of HEL-1733 split by HEL-1778 (hel1733-draft-outputs-shapes.spec.ts): the drafts part; shared code in support/hel1733-draft-outputs-shapes.ts.

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
