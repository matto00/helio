import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { AUTH, THEMES, openPipeline, seedPipeline, sheet } from "./support/hel1582Phone";
import {
  installFrameRecorder,
  readAlertLog,
  realTap,
  stepsOf,
  type AlertLogEntry,
} from "./support/hel1668";

// HEL-1668: phone pipeline detail polish, items 1, 2, 3 and 5, against the running app at 375, 390 and 768 in both
// themes: the `?step=` deep link opens the step sheet, a toast renders above the sheet and is announced through live
// regions connected (and empty) for whole frames first, Escape on the schema panel / a menu inside the sheet closes
// only that popover, and a touch tap leaves no sticky hover fill.

const PHONE_SIZES = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
] as const;

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
}

for (const size of PHONE_SIZES) {
  const at = `${size.width}x${size.height}`;
  test.describe(`HEL-1668 phone sheet polish at ${at}`, () => {
    test.use({ viewport: size });

    test(`item 1: the ?step= deep link opens that step's sheet, closing clears it, an unknown id opens none (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `deeplink-${size.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      const steps = await stepsOf(page, pipelineId);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await page.goto(`/pipelines/${pipelineId}?step=${steps[1].id}&keep=1`);
        await expect(sheet(page)).toBeVisible();
        await expect(sheet(page).getByRole("region", { name: /^Step 2 / })).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`step=${steps[1].id}`));
        await sheet(page).evaluate((el) =>
          Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
        );
        await page.screenshot({ path: evidencePath("HEL-1668", `deeplink-${at}-${theme}.png`) });
        await sheet(page).getByRole("button", { name: "Close" }).click();
        await expect(sheet(page)).toHaveCount(0);
        await expect.poll(() => new URL(page.url()).searchParams.get("step")).toBeNull();
        expect(new URL(page.url()).searchParams.get("keep")).toBe("1");

        await page.goto(`/pipelines/${pipelineId}?step=does-not-exist`);
        await expect(page.locator(".spine-row").first()).toBeVisible();
        await expect(sheet(page)).toHaveCount(0);
        await expect.poll(() => new URL(page.url()).searchParams.get("step")).toBeNull();
      }
    });

    test(`item 1: narrowing a desktop page to the phone width opens no sheet (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `resize-${size.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      const steps = await stepsOf(page, pipelineId);
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/pipelines/${pipelineId}?step=${steps[1].id}`);
      await expect(page.locator(".pipeline-detail-page--spine")).toBeVisible();
      await page.setViewportSize(size);
      await expect(page.locator(".pipeline-detail-page--mobile")).toBeVisible();
      await expect(page.locator(".spine-row").first()).toBeVisible();
      await page.waitForTimeout(500);
      await expect(sheet(page)).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get("step")).toBeNull();
    });

    test(`item 2: a failed step delete's error toast shows above the sheet, is dismissable and was announced after its region sat empty for two frames (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await installFrameRecorder(page);
      await registerAndLogin(page, request, { ...AUTH, label: `toast-${size.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      for (const theme of THEMES) {
        await page.route(/\/api\/pipeline-steps\/[^/]+$/, (route) =>
          route.request().method() === "DELETE"
            ? route.fulfill({ status: 500, json: { message: "Could not delete step" } })
            : route.continue(),
        );
        await openPipeline(page, pipelineId, theme);
        await page.locator(".spine-row__select").nth(2).tap();
        await expect(sheet(page)).toBeVisible();
        await sheet(page).evaluate((el) =>
          Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
        );
        const before = (await readAlertLog(page)).length;
        await sheet(page).getByRole("button", { name: "Remove step" }).tap();
        const toast = page.locator(".toast--error");
        await expect(toast).toBeVisible();
        // The sheet reopened after the failed delete and the toast lives inside it.
        await expect(sheet(page)).toBeVisible();
        expect(await toast.evaluate((el) => el.closest("dialog") !== null)).toBe(true);
        await toast.evaluate((el) =>
          Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
        );
        await sheet(page).evaluate((el) =>
          Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
        );
        // Topmost: the toast's centre hit-tests to the toast, not to the sheet beneath.
        const hit = await toast.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return top === null
            ? "nothing"
            : el.contains(top)
              ? "toast"
              : top.outerHTML.slice(0, 160);
        });
        expect(hit, "the toast is the topmost element at its own centre").toBe("toast");
        // It does not cover the sheet's own interactive controls.
        const overlaps = await toast.evaluate((el) => {
          const t = el.getBoundingClientRect();
          return Array.from(
            el
              .closest("dialog")!
              .querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"),
          )
            .filter((c) => c.closest(".toast-viewport") === null)
            .filter((c) => {
              const r = c.getBoundingClientRect();
              return (
                r.width > 0 &&
                r.height > 0 &&
                r.left < t.right &&
                r.right > t.left &&
                r.top < t.bottom &&
                r.bottom > t.top
              );
            })
            .map((c) => c.getAttribute("aria-label") ?? c.textContent?.trim().slice(0, 30));
        });
        expect(overlaps, "toast overlaps no sheet control").toEqual([]);
        // Announced: an assertive region inside the open dialog holds the message, exposed to AT.
        await expect(page.getByRole("alert")).toContainText(/delete|failed|could not/i);
        const log = (await readAlertLog(page)).slice(before) as AlertLogEntry[];
        const region = log.find((e) => e.kind === "region" && e.inDialog);
        const message = log.filter((e) => e.kind === "message" && e.inDialog);
        expect(region, "a live region was connected inside the dialog").toBeDefined();
        expect(region!.empty).toBe(true);
        expect(
          message,
          "the message was inserted into the in-dialog region exactly once",
        ).toHaveLength(1);
        expect(message[0].blockedAncestor).toBe(false);
        expect(
          message[0].gap!,
          "region connected >= 2 frames before the message",
        ).toBeGreaterThanOrEqual(2);
        await page.screenshot({ path: evidencePath("HEL-1668", `toast-${at}-${theme}.png`) });
        await toast.getByRole("button", { name: "Dismiss notification" }).tap();
        await expect(toast).toHaveCount(0);
        await expect(sheet(page)).toBeVisible();
        await sheet(page).getByRole("button", { name: "Close" }).tap();
        await expect(sheet(page)).toHaveCount(0);
        await page.unroute(/\/api\/pipeline-steps\/[^/]+$/);
      }
    });

    test(`item 3: Escape closes only the schema panel, then only the step menu, then the sheet (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `escape-${size.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        await page.locator(".spine-row__select").nth(2).tap();
        await expect(sheet(page)).toBeVisible();
        const trigger = sheet(page).getByRole("button", { name: /\d+ fields/ });
        await trigger.tap();
        const panel = page.getByRole("dialog", { name: "Output schema" });
        await expect(panel).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
        await expect(sheet(page)).toBeVisible();
        await expect(trigger).toBeFocused();

        const menuTrigger = sheet(page).getByRole("button", { name: /^Step actions for/ });
        await menuTrigger.tap();
        await expect(page.getByRole("menuitem").first()).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menuitem")).toHaveCount(0);
        await expect(sheet(page)).toBeVisible();
        await expect(menuTrigger).toBeFocused();

        await page.keyboard.press("Escape");
        await expect(sheet(page)).toHaveCount(0);
      }
    });

    test(`item 5: a touch tap leaves no sticky hover fill on the step row (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `hover-${size.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
        const fills = () =>
          page
            .locator(".spine-row")
            .nth(1)
            .evaluate((row) => ({
              row: getComputedStyle(row).backgroundColor,
              select: getComputedStyle(row.querySelector(".spine-row__select")!).backgroundColor,
            }));
        const rest = await fills();
        await realTap(page, page.locator(".spine-row__select").nth(1));
        await expect(sheet(page)).toBeVisible();
        await sheet(page).getByRole("button", { name: "Close" }).tap();
        await expect(sheet(page)).toHaveCount(0);
        await page.waitForTimeout(400);
        expect(await fills()).toEqual(rest);
        await page.screenshot({ path: evidencePath("HEL-1668", `hover-${at}-${theme}.png`) });
      }
    });
  });
}
