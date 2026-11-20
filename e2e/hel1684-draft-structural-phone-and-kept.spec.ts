import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { clickRowMenuItem, editorAction, selectRow, spineRows } from "./support/pipelineSpine";
import {
  ACTIONS,
  AUTH,
  COMPUTE,
  CSRF,
  describeMode,
  DRAFT_TEXT,
  FILTER,
  KEPT_DRAFT_PREFIX,
  LIMIT,
  openDraft,
  openPipeline,
  pickStep,
  recordApi,
  saveAndRun,
  seed,
  SORT,
  titles,
} from "./support/hel1684-draft-structural";

// HEL-1684: the phone-dark actions, the phone-light smoke and the kept-draft / stale-base / undo / delete cases.
// One of the `hel1684-draft-structural-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the shared seed, helpers, the action table and `describeMode` live in support/hel1684-draft-structural.ts.

describeMode(
  "phone",
  "dark",
  ACTIONS.filter((a) => !a.desktopOnly),
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
