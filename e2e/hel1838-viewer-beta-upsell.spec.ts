import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import {
  DESKTOP,
  OUTPUT_NAME,
  collaborator,
  openPipeline,
  seedSharedPipeline,
} from "./support/hel1661Fixture";

// HEL-1838: the Output sheet's History card shows the "Request Beta access" upsell to a viewer grantee and to an editor, the
// same as the owner (owner ruling: today's behaviour is kept and pinned). Real backend, real grants, real free-tier owner.
//
// Every locator is scoped to the History card (the card holding the h3 "History"): a free-tier user's collapsed "Ask about this
// Output" panel has an upsell with the same accessible name. Liveness is proved by CLICKING the link (a popup at
// /settings#beta-access while the original tab keeps the sheet), not by toBeEnabled, which is vacuous on an anchor.

const LINK_NAME = "Request Beta access (opens in a new tab)";

async function historyCard(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "History", level: 3 })).toBeVisible();
  return dialog.locator(".output-editor-sheet__group--card", {
    has: page.getByRole("heading", { name: "History", level: 3 }),
  });
}

for (const role of ["viewer", "editor"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`${role === "viewer" ? "a viewer" : "an editor"} sees and can follow the History card's Request Beta access link (${theme})`, async ({
      browser,
      page,
      request,
      baseURL,
    }) => {
      await registerAndLogin(page, request, {
        prefix: "hel1838",
        label: "owner",
        displayName: "HEL-1838",
      });
      const editor = await collaborator(browser, baseURL, "editor");
      const viewer = await collaborator(browser, baseURL, "viewer");
      const pipelineId = await seedSharedPipeline(page, editor, viewer);
      const grantee = role === "viewer" ? viewer : editor;
      const gp = grantee.page;

      // The owner is free tier: asserted from the real Output response the grantee receives, not assumed.
      const outputs = await gp.request.get(`/api/pipelines/${pipelineId}/outputs`);
      expect(outputs.status()).toBe(200);
      const items = ((await outputs.json()) as { items: Record<string, unknown>[] }).items;
      const saved = items.find((o) => o.name === OUTPUT_NAME);
      expect(saved?.kind).toBe("table");
      expect(saved?.historyPayloadsAvailable).toBe(false);

      await openPipeline(gp, pipelineId, theme, DESKTOP);
      await gp.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
      const card = await historyCard(gp);
      await expect(card.getByText("Free stores run summaries only")).toBeVisible();
      const link = card.getByRole("link", { name: LINK_NAME });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", "/settings#beta-access");
      await expect(link).toHaveAttribute("target", "_blank");

      // Live: the click opens /settings#beta-access in a new tab and the original tab keeps the sheet open.
      const popupPromise = gp.waitForEvent("popup");
      await link.click();
      const popup = await popupPromise;
      await popup.waitForLoadState("domcontentloaded");
      expect(new URL(popup.url()).pathname + new URL(popup.url()).hash).toBe(
        "/settings#beta-access",
      );
      await popup.close();
      await expect(gp.getByRole("dialog")).toBeVisible();
      await expect(card.getByRole("link", { name: LINK_NAME })).toBeVisible();

      await grantee.context.close();
    });
  }
}
