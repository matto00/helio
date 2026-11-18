import { expect, test, type Locator, type Page } from "@playwright/test";
import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { seedPipeline } from "./support/hel1582Phone";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1759 -- keyboard focus in the two shared portalled popovers. (a) A failed save in the dashboard appearance editor
// keeps the editor open with the picked preset and leaves real focus on Save (Save used to be `disabled` while saving,
// which dropped focus to <body>, so the next focus move closed the editor and discarded the pick). (b) Shift+Tab from
// the editor's first preset, and (c) Shift+Tab from the actions menu's first item, close the popover and return focus
// to its trigger instead of leaving it on the page body. Every key press after login/navigation is a real keyboard key.
// The throwaway users are recorded by registerUser and deleted by exact id in the run's global teardown.

const AUTH = { prefix: "hel1759", displayName: "HEL-1759" } as const;

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 800 },
] as const;

const SAVE_LABEL = "Save dashboard style";

/** The accessible name and tag of the focused element, and whether it is inside the editor form. */
function focusProbe(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? null,
      label: el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? null,
      inForm: el?.closest("form.popover__panel") != null,
    };
  });
}

const PHONE_EDITOR_REASON =
  "the appearance editor trigger is rendered but hidden at 768 and 390, so there is no phone editor to drive";

/** Evidence for the skip above: at phone width the appearance editor trigger is rendered but hidden (0 visible). */
async function expectNoEditorOnPhone(page: Page, name: string) {
  const res = await page.request.post("/api/dashboards", {
    data: { name },
    headers: { [CSRF_HEADER]: "1" },
  });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/dashboards/${id}`);
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 20_000 });
  await settleTransitions(page);
  await expect(
    page.getByRole("button", { name: "Customize dashboard appearance" }).locator("visible=true"),
  ).toHaveCount(0);
}

async function openDashboardWithEditor(page: Page, name: string): Promise<Locator> {
  const res = await page.request.post("/api/dashboards", {
    data: { name },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/dashboards/${id}`);
  const trigger = page
    .getByRole("button", { name: "Customize dashboard appearance" })
    .locator("visible=true");
  await expect(trigger).toHaveCount(1, { timeout: 20_000 });
  return trigger;
}

/** Opens the editor with Enter on its (programmatically focused) trigger; waits for focus to be inside the form. */
async function keyboardOpenEditor(page: Page, trigger: Locator) {
  await trigger.focus();
  await page.keyboard.press("Enter");
  const form = page.locator("form.popover__panel");
  await expect(form).toBeVisible();
  await expect.poll(async () => (await focusProbe(page)).inForm).toBe(true);
  return form;
}

for (const theme of ["light", "dark"] as const) {
  test(`phone ${theme}: the appearance editor trigger is hidden, so the editor cases run on desktop only`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.setViewportSize({ width: 390, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: `hidden-${theme}` });
    await expectNoEditorOnPhone(page, `HEL-1759 hidden ${theme}`);
  });

  for (const vp of VIEWPORTS) {
    test.describe(`HEL-1759 ${vp.name} ${theme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
        await page.setViewportSize({ width: vp.width, height: vp.height });
      });

      test("appearance editor: a failed keyboard save keeps it open, the pick intact and focus on Save", async ({
        page,
        request,
      }) => {
        test.skip(vp.name === "phone", PHONE_EDITOR_REASON);
        test.setTimeout(120_000);
        await registerAndLogin(page, request, {
          ...AUTH,
          label: `save-${vp.name}-${theme}`,
        });
        const trigger = await openDashboardWithEditor(page, `HEL-1759 save ${vp.name} ${theme}`);
        const form = await keyboardOpenEditor(page, trigger);
        await page.route("**/api/dashboards/*", async (route) => {
          if (route.request().method() !== "PATCH") return route.continue();
          await new Promise((r) => setTimeout(r, 400));
          return route.fulfill({ status: 500, body: "{}" });
        });

        // Pick the preset after "Default" with Tab + Space, then Tab on to Save.
        await page.keyboard.press("Tab");
        await page.keyboard.press("Space");
        const picked = await focusProbe(page);
        expect(picked.inForm).toBe(true);
        const pickedPreset = form.getByRole("button", { name: picked.label ?? "", exact: true });
        await expect(pickedPreset).toHaveAttribute("aria-pressed", "true");
        for (let i = 0; i < 40; i += 1) {
          if ((await focusProbe(page)).label === SAVE_LABEL) break;
          await page.keyboard.press("Tab");
        }
        expect((await focusProbe(page)).label).toBe(SAVE_LABEL);
        await expect(form).toBeVisible();

        await page.keyboard.press("Enter");
        // While the save is in flight focus must not leave Save.
        await expect(form.getByRole("button", { name: "Saving..." })).toBeVisible();
        expect((await focusProbe(page)).tag).toBe("BUTTON");
        expect((await focusProbe(page)).inForm).toBe(true);
        await expect(form.locator(".inline-error")).toContainText(
          "Failed to save dashboard appearance.",
        );

        // Failed: editor still open, pick intact, focus still on Save, not <body>.
        await expect(form).toBeVisible();
        await expect(pickedPreset).toHaveAttribute("aria-pressed", "true");
        const afterFail = await focusProbe(page);
        expect(afterFail.tag).toBe("BUTTON");
        expect(afterFail.inForm).toBe(true);
        expect(afterFail.label).toBe(SAVE_LABEL);

        // The next keyboard focus move stays inside the open editor and the pick survives.
        await page.keyboard.press("Shift+Tab");
        await expect(form).toBeVisible();
        expect((await focusProbe(page)).inForm).toBe(true);
        await expect(pickedPreset).toHaveAttribute("aria-pressed", "true");
      });

      test("appearance editor: Shift+Tab from the first preset closes it and focuses its trigger", async ({
        page,
        request,
      }) => {
        test.skip(vp.name === "phone", PHONE_EDITOR_REASON);
        test.setTimeout(120_000);
        await registerAndLogin(page, request, {
          ...AUTH,
          label: `back-${vp.name}-${theme}`,
        });
        const trigger = await openDashboardWithEditor(page, `HEL-1759 back ${vp.name} ${theme}`);
        const form = await keyboardOpenEditor(page, trigger);
        const first = await focusProbe(page);
        expect(first.label).toBe("Default");
        await page.keyboard.press("Shift+Tab");
        await expect(form).toHaveCount(0);
        await expect(trigger).toBeFocused();
      });

      test("actions menu: Shift+Tab from the first item closes it and focuses its trigger", async ({
        page,
        request,
      }) => {
        test.setTimeout(120_000);
        await registerAndLogin(page, request, {
          ...AUTH,
          label: `menu-${vp.name}-${theme}`,
          waitForShell: vp.name === "desktop",
        });
        if (vp.name === "phone") {
          // On a phone the dashboard rail is not rendered; the shared menu lives in the step sheet (a modal <dialog>).
          const pipelineId = await seedPipeline(page);
          await page.goto(`/pipelines/${pipelineId}`);
          await expect(page.locator(".spine-row__select").first()).toBeVisible();
          await page.locator(".spine-row__select").first().click();
          const sheet = page.locator("dialog[open]");
          await expect(sheet).toBeVisible();
          await settleTransitions(page);
          const sheetTrigger = sheet.getByRole("button", { name: /^Step actions for/ });
          await sheetTrigger.focus();
          await page.keyboard.press("Enter");
          const sheetMenu = page.getByRole("menu");
          await expect(sheetMenu).toBeVisible();
          await expect(
            sheetMenu.locator('[role="menuitem"]:not([disabled])').first(),
          ).toBeFocused();
          await page.keyboard.press("Shift+Tab");
          await expect(sheetMenu).toHaveCount(0);
          await expect(sheetTrigger).toBeFocused();
          return;
        }
        const name = `HEL-1759 menu ${vp.name} ${theme}`;
        const res = await page.request.post("/api/dashboards", {
          data: { name },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(res.status()).toBe(201);
        await page.goto("/dashboards");
        const row = page.locator(".dashboard-list__item-row", { hasText: name });
        await expect(row).toHaveCount(1, { timeout: 20_000 });
        const trigger = row.getByRole("button", { name: / actions$/ });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const menu = page.getByRole("menu");
        await expect(menu).toBeVisible();
        await expect(menu.getByRole("menuitem").first()).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
      });
    });
  }
}
