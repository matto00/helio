import { expect, test } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import {
  DESKTOP,
  PHONE,
  collaborator,
  openPipeline,
  seedSharedPipeline,
} from "./support/hel1661Fixture";

// HEL-1661: an editor or viewer on a valid shared pipeline whose source and step columns belong to the owner never
// sees "source type we don't yet recognize" or "A step in this pipeline has a problem"; an editor can still run.

const UNRECOGNIZED = /source type we don.t yet recognize/;
const STEP_PROBLEM = /A step in this pipeline has a problem/;

test.describe("HEL-1661 grantee verdict banner (live)", () => {
  test("editor and viewer see neither banner on a valid shared pipeline; the editor's Run pipeline is enabled", async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndLogin(page, request, {
      prefix: "hel1661",
      label: "ownerb",
      displayName: "HEL-1661",
    });
    const editor = await collaborator(browser, baseURL, "editorb");
    const viewer = await collaborator(browser, baseURL, "viewerb");
    const pipelineId = await seedSharedPipeline(page, editor, viewer);

    // Control: the owner's own page never showed the banners.
    for (const [name, viewport] of [
      ["desktop", DESKTOP],
      ["phone", PHONE],
    ] as const) {
      for (const who of [editor, viewer] as const) {
        await openPipeline(who.page, pipelineId, "light", viewport);
        await expect(who.page.getByText(UNRECOGNIZED)).toHaveCount(0);
        await expect(who.page.getByText(STEP_PROBLEM)).toHaveCount(0);
      }
      await expect(editor.page.getByRole("button", { name: "Run pipeline" })).toBeEnabled();
      await editor.page.screenshot({ path: evidencePath("HEL-1661", `banner-editor-${name}.png`) });
    }
    await editor.context.close();
    await viewer.context.close();
  });
});
