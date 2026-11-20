import { expect, test } from "@playwright/test";

import {
  CHROME_EXCLUDE,
  type Counts,
  DASH_NAME,
  type ElementResult,
  expectRecentRecorded,
  finishCell,
  newCell,
  PIPELINE_NAME,
  probeView,
  SOURCE_NAME,
  THEMES,
} from "./support/state-surface-contrast-guard";

// HEL-866 -- the overlays cell (command palette, modal, actions menu) and the chrome cell, both themes.
// One of the `state-surface-contrast-guard-*.spec.ts` parts (HEL-1789 split the spec so CI's file-level sharding can place them on
// different legs); the guard's helpers, cell setup and rationale live in support/state-surface-contrast-guard.ts.

test.describe("HEL-866 state-surface contrast guard", () => {
  test.describe.configure({ mode: "parallel" });
  test.setTimeout(120_000);

  // Cells are registered heaviest-first (overlays ~35 s, then the dense routes), then the cheap
  // ones: a worker that picks up a ~35 s cell last is the tail of the whole shard, so putting
  // the long cells first (longest-processing-time order) shortens the shard's makespan. Titles
  // and populations are unaffected by registration order.
  for (const theme of THEMES) {
    test(`overlays: command palette, modal and actions menu state backgrounds differ measurably from their backdrop (${theme})`, async ({
      page,
      request,
    }) => {
      const { client, pipelineId } = await newCell(page, request, theme);
      const results: ElementResult[] = [];
      const counts: Counts = { resolved: 0, unresolved: 0, pass: 0, fail: 0, advisory: 0 };

      // The unsplit walk reached the palette having visited, in order, `/home` -> `/sources` ->
      // `/pipelines` -> `/pipelines/<id>` -> `/connectors` -> `/chat` -> `/settings` -> `/home`, which
      // fills the palette's empty-query Recent section ({dashboard, pipeline}; localStorage
      // `helio.recentVisits`). Replay EXACTLY that sequence (never `/sources/<id>`, which the
      // unsplit walk never visits) so the palette population is the same SET, gating each step on
      // a readiness signal instead of a bare `goto` chain.
      await page.goto("/dashboards");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("button", { name: DASH_NAME, exact: true })).toBeVisible();
      await page.goto("/sources");
      await expect(page.getByText(SOURCE_NAME, { exact: true }).first()).toBeVisible();
      await page.goto("/pipelines");
      await expect(page.getByText(PIPELINE_NAME, { exact: true }).first()).toBeVisible();
      await page.goto(`/pipelines/${pipelineId}`);
      await expect(page.getByText(PIPELINE_NAME, { exact: true }).first()).toBeVisible();
      await expectRecentRecorded(page, "pipeline", pipelineId);
      await page.goto("/connectors");
      await expect(page).toHaveURL(/\/connectors$/);
      await expect(page.locator("main")).toBeVisible();
      await page.goto("/chat");
      await expect(page).toHaveURL(/\/chat$/);
      await expect(page.locator("main")).toBeVisible();
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
      await page.goto("/dashboards");
      await expect(page.getByRole("button", { name: DASH_NAME, exact: true })).toBeVisible();

      // Overlay: command palette (this ticket's canonical defect surface).
      await page.waitForTimeout(150);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
      const palette = page.locator(".command-palette[open]");
      await expect(palette).toHaveCount(1);
      // Per-run guarantee that the replayed recents are present (the equality proof is otherwise
      // one-time): the Recent rows must include the seeded dashboard and pipeline.
      const recentTitles = palette.locator(".command-palette__item-title");
      await expect(recentTitles.filter({ hasText: DASH_NAME }).first()).toBeVisible();
      await expect(recentTitles.filter({ hasText: PIPELINE_NAME }).first()).toBeVisible();
      await page.waitForTimeout(150);
      await probeView(page, client, "command-palette", theme, palette, results, counts);
      await page.keyboard.press("Escape");
      await expect(palette).toHaveCount(0);

      // Overlay: modal (AddSourceModal, on /sources). NOTE: DashboardList's "Add dashboard"
      // control is an INLINE form, not a `<Modal>`/native `<dialog>`, so it does not exercise the
      // modal-hosted population; AddSourceModal does.
      await page.goto("/sources");
      const addSourceTrigger = page.getByRole("button", { name: "Add source" }).first();
      await expect(addSourceTrigger).toBeVisible();
      await addSourceTrigger.click();
      const modal = page.getByRole("dialog").filter({ visible: true }).first();
      await expect(modal).toBeVisible();
      await page.waitForTimeout(150);
      await probeView(page, client, "modal:add-source", theme, modal, results, counts);
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await page.waitForTimeout(150);

      // Overlay: ActionsMenu (dashboard row). evaluation-2.md CR8 — navigate to `/home`, where the
      // dashboard row genuinely renders, and assert the trigger exists rather than conditionally
      // skipping — a missing overlay fails loudly.
      await page.goto("/dashboards");
      await expect(page.getByRole("button", { name: DASH_NAME, exact: true })).toBeVisible();
      const row = page.locator(".dashboard-list__item-row", { hasText: DASH_NAME });
      await expect(row).toHaveCount(1);
      const trigger = row.locator(`button[aria-label="${DASH_NAME} actions"]`);
      await expect(trigger).toHaveCount(1);
      // DashboardList.css clips the trigger to a 1x1 box until the row's own `:hover` (or
      // `:focus-within`) reveals it; hover the row first.
      await row.hover();
      await expect(trigger).toBeVisible();
      await trigger.click();
      const menu = page
        .locator("[role=menu], .actions-menu__panel")
        .filter({ visible: true })
        .first();
      await expect(menu).toBeVisible();
      await page.waitForTimeout(150);
      await probeView(page, client, "actions-menu", theme, menu, results, counts);
      await page.keyboard.press("Escape");
      finishCell(`overlays(${theme})`, results, counts);
    });
  }

  for (const theme of THEMES) {
    test(`chrome: every interactive state background differs measurably from its resolved backdrop (${theme})`, async ({
      page,
      request,
    }) => {
      const { client } = await newCell(page, request, theme);
      const results: ElementResult[] = [];
      const counts: Counts = { resolved: 0, unresolved: 0, pass: 0, fail: 0, advisory: 0 };
      await page.goto("/dashboards");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".app-command-bar")).toBeVisible();
      await page.waitForTimeout(200);
      await probeView(
        page,
        client,
        "chrome",
        theme,
        page.locator("body"),
        results,
        counts,
        CHROME_EXCLUDE,
      );
      finishCell(`chrome(${theme})`, results, counts);
    });
  }
});
