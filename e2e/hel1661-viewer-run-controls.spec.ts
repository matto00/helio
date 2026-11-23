import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  DESKTOP,
  OUTPUT_NAME,
  PHONE,
  collaborator,
  openPipeline,
  seedSharedPipeline,
} from "./support/hel1661Fixture";

// HEL-1661: a viewer grantee gets no run entry on the pipeline page (desktop header, phone pills, Output sheet);
// "View only" is shown instead; an editor keeps every control. Real backend, real grants, both themes.

test.describe("HEL-1661 viewer run controls (live)", () => {
  test("viewer: no Run pipeline / Dry run, desktop and phone, both themes, 'View only' shown; editor keeps both", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    await registerAndLogin(page, request, {
      prefix: "hel1661",
      label: "owner",
      displayName: "HEL-1661",
    });
    const editor = await collaborator(browser, baseURL, "editor");
    const viewer = await collaborator(browser, baseURL, "viewer");
    const pipelineId = await seedSharedPipeline(page, editor, viewer);

    for (const [name, viewport] of [
      ["desktop", DESKTOP],
      ["phone", PHONE],
    ] as const) {
      for (const theme of ["light", "dark"] as const) {
        await openPipeline(viewer.page, pipelineId, theme, viewport);
        await expect(viewer.page.getByText("View only").first(), `${name}/${theme}`).toBeVisible();
        await expect(viewer.page.getByRole("button", { name: "Run pipeline" })).toHaveCount(0);
        await expect(viewer.page.getByRole("button", { name: "Dry run" })).toHaveCount(0);
        await viewer.page.screenshot({
          path: evidencePath("HEL-1661", `viewer-${name}-${theme}.png`),
        });

        // Control: the editor sees both, enabled, and no indicator.
        await openPipeline(editor.page, pipelineId, theme, viewport);
        await expect(editor.page.getByRole("button", { name: "Run pipeline" })).toBeEnabled();
        await expect(editor.page.getByRole("button", { name: "Dry run" })).toBeEnabled();
        await expect(editor.page.getByText("View only")).toHaveCount(0);
      }
    }
    await editor.context.close();
    await viewer.context.close();
  });

  test("viewer opening an Output sheet is offered no Run pipeline; the editor is", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndLogin(page, request, {
      prefix: "hel1661",
      label: "owner2",
      displayName: "HEL-1661",
    });
    const editor = await collaborator(browser, baseURL, "editor2");
    const viewer = await collaborator(browser, baseURL, "viewer2");
    const pipelineId = await seedSharedPipeline(page, editor, viewer);

    for (const [who, expected] of [
      [editor, 1],
      [viewer, 0],
    ] as const) {
      await openPipeline(who.page, pipelineId, "light", DESKTOP);
      await who.page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
      const dialog = who.page.getByRole("dialog");
      // HEL-1794: a viewer's paragraph does not invite a run; an editor's keeps the "Run the pipeline" line.
      await expect(
        dialog.getByText(
          who === viewer
            ? "This Output has no rows yet"
            : "hasn’t been included in a saved run yet",
        ),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Run pipeline" })).toHaveCount(expected);
    }
    await editor.context.close();
    await viewer.context.close();
  });
});
