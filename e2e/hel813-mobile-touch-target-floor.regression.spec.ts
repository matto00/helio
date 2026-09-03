import * as fs from "node:fs/promises";
import * as path from "node:path";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  assertFloor,
  measureBox,
  DEFAULT_MIN_PX,
  RENDERED_BOX_EPSILON_PX,
} from "./support/touchTargetProbe";

const FLOOR = DEFAULT_MIN_PX - RENDERED_BOX_EPSILON_PX;

// HEL-813 — one-shot demonstrated-RED regression harness (design.md D1).
// NOT part of the CI guard (playwright.config.ts's `testIgnore`) and
// additionally self-gated by `HEL813_REGRESSION` (belt-and-suspenders, so
// it stays inert even if invoked with an explicit path) — see e2e/README.md
// for how/why to re-run this on demand.
//
// Temporarily patches REAL component source into each of the two known-bad
// shapes this ticket exists to catch, re-measures with the SAME shared
// helper the steady-state guard uses, and asserts red — proving the guard's
// *sensitivity* to the mutation, not just that something broke. Every
// mutation is self-reverting (try/finally), and each case captures a full
// PASS (baseline) -> FAIL (mutated) -> PASS (reverted) sequence, per
// design.md's "green-before/red-after pairing" (skeptic CR7).

test.skip(!process.env.HEL813_REGRESSION, "opt-in only - see e2e/README.md");

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel813reg-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-813 Regression ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Writes `content` to `filePath` and gives Vite's dev-server file watcher
 *  time to pick up the change and push an HMR update before the caller
 *  reloads the page. */
async function writeAndSettle(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, "utf8");
  await new Promise((resolve) => setTimeout(resolve, 700));
}

async function reloadAndSettle(page: Page): Promise<void> {
  await page.reload();
  await page.waitForLoadState("networkidle");
}

const TOAST_CSS = path.resolve(__dirname, "../frontend/src/shared/ui/toast.css");
// HEL-951 — Case B's original anchor, `.panel-list__add`, no longer exists
// (removed when the panel-list header bar was retired; "Add panel" moved to
// the command bar's `.actions-menu__trigger`, an expander-mechanism control
// P1 excludes as a candidate). See design.md D5/D6 and
// openspec/changes/wire-orphaned-e2e-specs/caseb-search-and-mutation-proof.md
// for the full four-precondition search: `.mobile-nav-sheet__item`
// (MobileNavSheet.css) is the replacement — a full-width sheet row whose
// mobile-only `min-height: 44px` is declared on its own (not comma-shared)
// rule, with no width floor (its width is driven entirely by the sheet's
// own width, measured 404px at 430px).
const NAV_SHEET_CSS = path.resolve(__dirname, "../frontend/src/shared/chrome/MobileNavSheet.css");

// HEL-951 — anchored on the RULE, not on prose: HEL-851's comment sweep
// deleted the `/* Close button */` comment this marker used to key on,
// silently breaking this harness (the marker never triggered a "source
// drifted" error — it simply stopped matching, and the whole test skipped
// straight to a false "not found" throw). A decorative comment can be
// deleted by any future sweep; the base rule itself is the only thing this
// harness actually depends on. The leading newline + zero indentation is
// what disambiguates the base rule from the mobile media block's own
// (two-space-indented) `.toast__close {` copy — count uniqueness is
// asserted at runtime below rather than assumed, so a FUTURE drift (e.g. a
// second unindented `.toast__close {` appearing anywhere in the file)
// fails loudly instead of silently mutating the wrong rule.
const TOAST_BASE_RULE_MARKER = "\n.toast__close {";

function assertToastBaseRuleMarkerUnique(original: string): void {
  const matches = original.split(TOAST_BASE_RULE_MARKER).length - 1;
  if (matches !== 1) {
    throw new Error(
      `regression harness: expected exactly 1 unindented ".toast__close {" base rule in ` +
        `toast.css, found ${matches} — source drifted from the expected shape`,
    );
  }
}

const TOAST_MEDIA_BLOCK = `@media (max-width: 768px) {
  .toast__close {
    /* skeptic-final-1.md CR3 — 44px is DESIGN.md:130's blessed mobile
       tap-target literal; the margin isn't covered by that carve-out (the
       base rule's -2px/-4px are within §3's <=4px optical-tweak allowance,
       these are 3x that), so it's expressed as -1 * --space-3 (12px) rather
       than a bare -12px literal. */
    width: 44px;
    height: 44px;
    margin: calc(var(--space-3) * -1) calc(var(--space-3) * -1) 0 0;
  }
}`;

/** Case A (HEL-535's actual bug shape): moves `.toast__close`'s mobile
 *  `@media` floor block to ABOVE its base rule. Equal specificity (0,1,0)
 *  on both sides means the cascade resolves by source order — a media
 *  block placed before the base rule loses to it regardless of whether the
 *  query matches, so the floor becomes inert even though the string
 *  `min-height`-equivalent (`width`/`height: 44px`) is still present in the
 *  file, unmoved and unedited otherwise. */
function reorderToastMediaAboveBaseRule(original: string): string {
  // HEL-951 — assert uniqueness of the RULE anchor at runtime, every call,
  // so a future comment sweep (or any other drift) that introduces a
  // second unindented `.toast__close {` fails loudly instead of silently
  // mutating whichever one `indexOf` happens to find first.
  assertToastBaseRuleMarkerUnique(original);
  const mediaIndex = original.indexOf(TOAST_MEDIA_BLOCK);
  if (mediaIndex === -1) {
    throw new Error("regression harness: toast.css media block marker not found — source drifted");
  }
  const baseIndex = original.indexOf(TOAST_BASE_RULE_MARKER);
  if (baseIndex === -1) {
    throw new Error("regression harness: toast.css base-rule marker not found — source drifted");
  }
  if (baseIndex > mediaIndex) {
    throw new Error(
      "regression harness: base rule already precedes the media block — source drifted from the expected HEL-535-fixed shape",
    );
  }

  const withoutMedia =
    original.slice(0, mediaIndex) + original.slice(mediaIndex + TOAST_MEDIA_BLOCK.length);
  // Re-find the base-rule marker in the trimmed string (its index shifts
  // once the media block is removed from earlier in the file).
  const reInsertAt = withoutMedia.indexOf(TOAST_BASE_RULE_MARKER);
  return (
    withoutMedia.slice(0, reInsertAt) + TOAST_MEDIA_BLOCK + "\n\n" + withoutMedia.slice(reInsertAt)
  );
}

const NAV_SHEET_ITEM_MOBILE_RULE = `  .mobile-nav-sheet__item {
    min-height: 44px;
  }`;

const NAV_SHEET_ITEM_MOBILE_RULE_WIDTH_MUTATED = `  .mobile-nav-sheet__item {
    min-height: 44px;
    /* HEL-951 regression harness: temporary fixed width below the floor —
       reproduces HEL-781's "height-only floor on a fixed-width control"
       failure mode. Self-reverting; never committed. */
    width: 20px;
  }`;

/** Case B: a height-only floor on a control that ALSO declares a fixed
 *  width below 44px — `.mobile-nav-sheet__item` currently only carries
 *  `min-height: 44px` at mobile widths (no width floor; its width is
 *  driven entirely by the sheet's own width), so adding a fixed sub-44px
 *  `width` reproduces HEL-781's wrong-axis failure mode without touching
 *  the height declaration at all. */
function addFixedWidthBelowFloor(original: string): string {
  if (!original.includes(NAV_SHEET_ITEM_MOBILE_RULE)) {
    throw new Error(
      "regression harness: MobileNavSheet.css .mobile-nav-sheet__item mobile rule not found — source drifted",
    );
  }
  return original.replace(NAV_SHEET_ITEM_MOBILE_RULE, NAV_SHEET_ITEM_MOBILE_RULE_WIDTH_MUTATED);
}

test.describe("HEL-813 demonstrated-RED regression harness", () => {
  test("Case A — HEL-535 above-base-rule @media inert floor goes red, then clean on revert", async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(60_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const original = await fs.readFile(TOAST_CSS, "utf8");
    let mutated = false;

    try {
      await page.setViewportSize({ width: 430, height: 900 });
      await registerAndLogin(page, request, "caseA");
      await page.goto("/settings");
      await page.fill("#api-token-name", "HEL-813 Regression Token");
      await page.getByRole("button", { name: "Create token" }).click();
      await page.getByRole("button", { name: "Copy" }).click();
      const toastClose = page.locator(".toast__close");

      // 1. Baseline PASS — current (fixed) source.
      await expect(page.locator(".toast")).toBeVisible();
      await assertFloor(toastClose);
      const baselineBox = await measureBox(toastClose);
      console.log(`[hel813-regression][Case A][baseline PASS] ${JSON.stringify(baselineBox)}`);

      // 2. Mutate: move the media block above the base rule (HEL-535 shape).
      await writeAndSettle(TOAST_CSS, reorderToastMediaAboveBaseRule(original));
      mutated = true;
      await reloadAndSettle(page);
      await page.fill("#api-token-name", "HEL-813 Regression Token 2");
      await page.getByRole("button", { name: "Create token" }).click();
      await page.getByRole("button", { name: "Copy" }).click();
      await expect(page.locator(".toast")).toBeVisible();

      // 3. Confirm RED — the SAME assertion the steady-state guard uses now
      // fails, because the inert cascade leaves the close button at its
      // unconditional 20x20 desktop size.
      let redError: unknown = null;
      try {
        await assertFloor(page.locator(".toast__close"));
      } catch (err) {
        redError = err;
      }
      const mutatedBox = await measureBox(page.locator(".toast__close"));
      console.log(
        `[hel813-regression][Case A][mutated FAIL] box=${JSON.stringify(mutatedBox)} threw=${redError !== null}`,
      );
      expect(
        redError,
        "assertFloor must fail against the reintroduced HEL-535 shape",
      ).not.toBeNull();
      expect(mutatedBox.height).toBeLessThan(44);
      expect(mutatedBox.width).toBeLessThan(44);

      await writeAndSettle(TOAST_CSS, original);
      mutated = false;
      await reloadAndSettle(page);
      await page.fill("#api-token-name", "HEL-813 Regression Token 3");
      await page.getByRole("button", { name: "Create token" }).click();
      await page.getByRole("button", { name: "Copy" }).click();
      await expect(page.locator(".toast")).toBeVisible();

      await assertFloor(page.locator(".toast__close"));
      const revertedBox = await measureBox(page.locator(".toast__close"));
      console.log(`[hel813-regression][Case A][reverted PASS] ${JSON.stringify(revertedBox)}`);
    } finally {
      if (mutated) {
        await fs.writeFile(TOAST_CSS, original, "utf8");
      }
    }
  });

  test("Case B — height-only floor on a fixed-width control goes red, then clean on revert", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const original = await fs.readFile(NAV_SHEET_CSS, "utf8");
    let mutated = false;

    try {
      await page.setViewportSize({ width: 430, height: 900 });
      await registerAndLogin(page, request, "caseB");
      const dashboardRes = await page.request.post("/api/dashboards", {
        data: { name: "HEL-813 Regression Nav" },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(dashboardRes.status()).toBe(201);
      await page.goto("/");
      await page.getByRole("button", { name: /Switch dashboards/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(400);
      const navItem = dialog.locator(".mobile-nav-sheet__item").first();

      await assertFloor(navItem);
      const baselineBox = await measureBox(navItem);
      console.log(`[hel813-regression][Case B][baseline PASS] ${JSON.stringify(baselineBox)}`);

      // 2. Mutate: add a fixed sub-44px width alongside the existing
      // (unedited) min-height: 44px floor.
      await writeAndSettle(NAV_SHEET_CSS, addFixedWidthBelowFloor(original));
      mutated = true;
      await reloadAndSettle(page);
      await page.getByRole("button", { name: /Switch dashboards/i }).click();
      const dialogAfterMutation = page.getByRole("dialog");
      await expect(dialogAfterMutation).toBeVisible();
      await page.waitForTimeout(400);
      const navItemAfterMutation = dialogAfterMutation.locator(".mobile-nav-sheet__item").first();

      // 3. Confirm RED on the width axis specifically (height stays clear,
      // per the EPSILON-adjusted floor — never a re-typed bare 44, since a
      // legitimate sub-pixel measurement like 43.6 must not read as red on
      // the axis this case is supposed to leave clear — design.md D5).
      let redError: unknown = null;
      try {
        await assertFloor(navItemAfterMutation);
      } catch (err) {
        redError = err;
      }
      const mutatedBox = await measureBox(navItemAfterMutation);
      console.log(
        `[hel813-regression][Case B][mutated FAIL] box=${JSON.stringify(mutatedBox)} threw=${redError !== null}`,
      );
      expect(redError, "assertFloor must fail on the width axis").not.toBeNull();
      expect(mutatedBox.width).toBeLessThan(FLOOR);
      expect(mutatedBox.height).toBeGreaterThanOrEqual(FLOOR);

      await writeAndSettle(NAV_SHEET_CSS, original);
      mutated = false;
      await reloadAndSettle(page);
      await page.getByRole("button", { name: /Switch dashboards/i }).click();
      const dialogAfterRevert = page.getByRole("dialog");
      await expect(dialogAfterRevert).toBeVisible();
      await page.waitForTimeout(400);
      const navItemAfterRevert = dialogAfterRevert.locator(".mobile-nav-sheet__item").first();

      await assertFloor(navItemAfterRevert);
      const revertedBox = await measureBox(navItemAfterRevert);
      console.log(`[hel813-regression][Case B][reverted PASS] ${JSON.stringify(revertedBox)}`);
    } finally {
      if (mutated) {
        await fs.writeFile(NAV_SHEET_CSS, original, "utf8");
      }
    }
  });
});
