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

// HEL-1837 (owner ruling: read all, owner writes). Real backend, real grants, plain emails.
//  - The owner keeps the interactive chip and the schedule menu items.
//  - An editor and a viewer see the schedule as a read-only chip (not a button), no "Add schedule", no schedule menu item.
//  - The server agrees: grantee GET is 200, grantee PUT and DELETE are 404 and the schedule is unchanged.
//  - A grantee of a pipeline with no schedule sees no chip at all.

const CSRF = { "X-Helio-Requested-With": "1" };
const BODY = { kind: "interval", expression: "15m", timezone: "UTC", enabled: true };

test.describe("HEL-1837 grantee schedule chip (live)", () => {
  for (const [label, viewport] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ] as const) {
    test(`owner writes, editor and viewer read-only on ${label}`, async ({
      page,
      request,
      browser,
      baseURL,
    }) => {
      test.setTimeout(300_000);
      await registerAndLogin(page, request, {
        prefix: "hel1837",
        label: `owner-${label}`,
        displayName: "HEL-1837",
      });
      const editor = await collaborator(browser, baseURL, `editor-${label}`);
      const viewer = await collaborator(browser, baseURL, `viewer-${label}`);
      const pipelineId = await seedSharedPipeline(page, editor, viewer);
      const url = `/api/pipelines/${pipelineId}/schedule`;

      // Before any schedule exists: a grantee sees no chip and no "Add schedule".
      for (const who of [editor, viewer]) {
        await openPipeline(who.page, pipelineId, "light", viewport);
        await expect(who.page.getByRole("button", { name: "Add schedule" })).toHaveCount(0);
        await expect(who.page.locator(".spine-header__chip")).toHaveCount(0);
      }

      const put = await page.request.put(url, { data: BODY, headers: CSRF });
      expect(put.status()).toBeLessThan(300);

      // The server: read all, owner writes.
      for (const who of [editor, viewer]) {
        expect((await who.context.request.get(url)).status()).toBe(200);
        const refused = await who.context.request.put(url, {
          data: { ...BODY, expression: "5m" },
          headers: CSRF,
        });
        expect(refused.status()).toBe(404);
        expect((await who.context.request.delete(url, { headers: CSRF })).status()).toBe(404);
      }
      const after = await (await page.request.get(url)).json();
      expect(after.expression).toBe("15m");

      // The client: a read-only chip for each grantee, in both themes.
      for (const [who, name] of [
        [editor, "editor"],
        [viewer, "viewer"],
      ] as const) {
        for (const theme of ["light", "dark"] as const) {
          const p = who.page;
          await openPipeline(p, pipelineId, theme, viewport);
          const chip = p.locator(".spine-header__chip", { hasText: "Every 15m" });
          await expect(chip).toBeVisible();
          expect(await chip.evaluate((el) => el.tagName.toLowerCase())).toBe("span");
          // It reads as state, not an action: default cursor, no hover wash, no tap-target overlay.
          const before = await chip.evaluate((el) => {
            const cs = getComputedStyle(el);
            return {
              cursor: cs.cursor,
              bg: cs.backgroundColor,
              overlay: getComputedStyle(el, "::after").content,
            };
          });
          expect(before.cursor).toBe("default");
          expect(before.overlay === "none" || before.overlay === "normal").toBe(true);
          await chip.hover();
          const hovered = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
          expect(hovered).toBe(before.bg);
          await expect(p.getByRole("button", { name: /schedule/i })).toHaveCount(0);
          const menu = p.getByRole("button", { name: "Pipeline actions" });
          if ((await menu.count()) > 0) {
            await menu.click();
            await expect(p.getByRole("menuitem", { name: /schedule/i })).toHaveCount(0);
            await p.keyboard.press("Escape");
          }
          await p.screenshot({
            path: evidencePath("HEL-1837", `${name}-${label}-${theme}-chip.png`),
          });
        }
      }

      // The owner is unchanged: the chip is a button that opens the dialog, and the menu offers the schedule items.
      await openPipeline(page, pipelineId, "light", viewport);
      await page.getByRole("button", { name: "Edit schedule" }).click();
      await expect(page.getByRole("dialog", { name: "Pipeline schedule" })).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Pipeline actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Edit schedule" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Pause schedule" })).toBeVisible();

      await editor.context.close();
      await viewer.context.close();
    });
  }
});
