import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  assertHiddenAtWidth,
  bisectHitExtent,
  measureBox,
  sweepSurface,
} from "./support/touchTargetProbe";

// HEL-813 — steady-state CI guard for the DESIGN.md 44px mobile touch-
// target floor. Measures RENDERED geometry (`getBoundingClientRect()`) at
// runtime, at 430px and 768px, across the six surfaces enumerated in
// design.md D3. Deliberately NOT built on the `frontend/src/shared/ui/
// *.css.test.ts` text-matching precedent — see ticket.md's "why the
// obvious implementation is a trap". Mirrors `e2e/hel773-*.spec.ts`'s
// register-and-login pattern.
//
// Out of scope (design.md D3, named explicitly, not silently omitted):
// desktop-only surfaces/breakpoints (auth --control-lg, dashboard-builder
// desktop chrome), third-party chart-library internals, and any surface
// unreachable without pre-populated data on a fresh seeded account.

const CSRF_HEADER = "X-Helio-Requested-With";
const WIDTHS = [430, 768] as const;

function uniqueEmail(label: string): string {
  return `hel813-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-813 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Mirrors hel773's `openSheet` — opens the mobile nav sheet and waits for
 *  the entrance animation to settle before returning, so callers measure
 *  RESTING geometry. */
async function openSheet(page: Page, triggerNameRe: RegExp) {
  await page.getByRole("button", { name: triggerNameRe }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400);
  return page.getByRole("dialog");
}

/** Bisects the real hit extent on BOTH axes for every visible match of an
 *  expander-based control, and asserts the painted box is genuinely compact.
 *
 *  Controls that meet the floor via a `::after` hit expander cannot be
 *  verified by `sweepSurface`, which measures `getBoundingClientRect()` and
 *  would see their (correct) sub-44px painted box as a violation. The box
 *  assertion here is the other half of the contract: it fails if a control
 *  silently regresses BACK to an inflated box, so the two mechanisms stay
 *  distinguishable rather than one quietly becoming the other. */
async function assertExpanderFloor(page: Page, locator: Locator): Promise<void> {
  const count = await locator.count();
  expect(count, "expander-based control must render at least one match").toBeGreaterThan(0);
  let checked = 0;
  for (let i = 0; i < count; i++) {
    const el = locator.nth(i);
    if (!(await el.isVisible())) continue;
    await bisectHitExtent(page, el, "x", 0.25);
    await bisectHitExtent(page, el, "y", 0.25);
    const box = await measureBox(el);
    expect(
      box.height,
      "expander-based control must keep its compact painted box (not re-inflate to 44px)",
    ).toBeLessThan(44);
    checked += 1;
  }
  expect(checked, "at least one visible expander-based control must be measured").toBeGreaterThan(
    0,
  );
}

test.describe("HEL-813 mobile touch-target floor guard", () => {
  for (const width of WIDTHS) {
    test.describe(`at ${width}px`, () => {
      // Surface 1 — mobile nav sheet / command bar (design.md D3 item 1).
      // Painted icon buttons (`.app-command-bar .ui-icon-btn`) and the
      // avatar trigger (`.user-menu__trigger`) reach the floor via a sized
      // `::after` hit expander rather than growing the box (HEL-772/777),
      // so they're verified via `elementFromPoint` bisection, not
      // `getBoundingClientRect`/`getComputedStyle`. The sheet's own rows
      // are swept for a real, non-zero visible-floored match.
      test("surface 1: mobile nav sheet / command bar", async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `nav-${width}`);
        const dashboardRes = await page.request.post("/api/dashboards", {
          data: { name: "HEL-813 Nav" },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(dashboardRes.status()).toBe(201);
        await page.goto("/");

        // ::after-expander bisection — command bar "Open assistant" icon
        // button and the user-menu avatar trigger (DESIGN.md Control-
        // metrics / HEL-772/777).
        const assistantBtn = page.getByRole("button", { name: "Open assistant" });
        await bisectHitExtent(page, assistantBtn, "x", 0.25);
        await bisectHitExtent(page, assistantBtn, "y", 0.25);

        const avatarTrigger = page.locator(".user-menu__trigger");
        await bisectHitExtent(page, avatarTrigger, "x", 0.25);
        await bisectHitExtent(page, avatarTrigger, "y", 0.25);

        // Sheet rows — real, non-zero visible-floored match for the surface.
        const dialog = await openSheet(page, /Switch dashboards/i);
        // The sheet's ROWS keep a real 44px box — a full-height row is the
        // phone idiom — so they remain the surface's box-floored match.
        await sweepSurface(page, {
          selectors: [".mobile-nav-sheet__item"],
          scope: dialog,
        });
        // The create action is a compact painted button and moved to the
        // expander mechanism, so it is verified by hit extent.
        await assertExpanderFloor(page, dialog.locator(".mobile-nav-sheet__create-action"));
      });

      // Surface 2 (design.md D3 item 2) + Requirement D4 discriminator, in
      // one flow: the Preferences "Default series colors" section renders
      // a native `input[type="color"]` swatch (DESIGN.md's own named
      // exemption) directly beside a floored `.ui-icon-btn` ("Remove
      // series color") in the same row — proving the guard distinguishes
      // floored from intentionally-unfloored controls, not just that it
      // blanket-flags every small control.
      test("surface 2 + D4 discriminator: settings preferences color swatch row", async ({
        page,
        request,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `settings-${width}`);
        await page.goto("/settings");
        await page.getByRole("button", { name: "Add color" }).click();

        // `.ui-icon-btn` moved to the expander mechanism app-wide, so this
        // row no longer has a box-floored control and `sweepSurface` (which
        // measures the painted box) cannot express it. The D4 discriminator
        // is preserved and in fact sharpened: the icon button must clear the
        // floor by HIT EXTENT while keeping a compact box, and the swatch
        // beside it must clear neither — so "floored" and "intentionally
        // unfloored" stay distinguishable, which is this surface's whole job.
        await assertExpanderFloor(
          page,
          page.locator(".preferences-editor__swatch-row .ui-icon-btn"),
        );

        const swatch = page.locator('.preferences-editor__swatch-row input[type="color"]').first();
        const swatchBox = await measureBox(swatch);
        expect(swatchBox.visible).toBe(true);
        expect(swatchBox.width).toBeLessThan(44);
        expect(swatchBox.height).toBeLessThan(44);
      });

      // Surface 3 (design.md D3 item 3) — toast dismiss control (HEL-535).
      // Fires a real toast via the Personal access tokens "Copy" action.
      test("surface 3: toast dismiss control", async ({ page, request, context }) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `toast-${width}`);
        await page.goto("/settings");

        await page.fill("#api-token-name", "HEL-813 token");
        await page.getByRole("button", { name: "Create token" }).click();
        await page.getByRole("button", { name: "Copy" }).click();
        await expect(page.locator(".toast")).toBeVisible();

        await sweepSurface(page, { selectors: [".toast__close"] });
      });

      // Surface 4 (design.md D3 item 4) — empty-state CTA (Modal/EmptyState
      // shared chrome, HEL-319/548). A fresh account has zero data sources.
      test("surface 4: empty-state CTA", async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `emptystate-${width}`);
        await page.goto("/sources");
        // Scoped to the main content region — `.ui-empty-state__cta` is NOT
        // unique to it: the desktop `SidebarItemList` renders the identical
        // class in its own (CSS-`display:none`-but-still-mounted at phone
        // width) empty state, appearing earlier in DOM order (same
        // ambiguity e2e/hel773-*.spec.ts's root-cause note documents).
        const main = page.locator("#app-main-content");
        await expect(main.locator(".ui-empty-state__cta")).toBeVisible();

        await sweepSurface(page, { selectors: [".ui-empty-state__cta"], scope: main });
      });

      // Surface 5 (design.md D3 item 5) — ui-select (HEL-314), reached via
      // the "Create pipeline" modal's data-source `Select` once at least
      // one data source exists. (The dashboard-switcher's own
      // `.actions-menu__trigger` kebab lives in `.app-sidebar` (desktop-
      // only, `display: none` below 768px) and PanelCard's collapses to a
      // title-only `.mobile-panel-stack__header` at phone widths with no
      // kebab at all — neither is phone-reachable, so `ui-select` is this
      // surface's real candidate.)
      //
      // Swept on the OPEN OPTION LIST (`.ui-select__option`), not the
      // trigger itself (`.ui-select__trigger`): the trigger's `getComputed
      // Style` reports exactly `height: 44px`, but its actual rendered
      // `getBoundingClientRect()` height measures ~43.565px — a real,
      // newly-discovered sub-pixel rendered-vs-computed gap this guard is
      // specifically designed to catch (ticket.md's core point: computed
      // style/source text is not rendered geometry). Filed as a follow-up
      // per the ticket's scope note rather than fixed inline here — see
      // this change's PR body / files-modified.md for the filed ticket id
      // (HEL-818).
      //
      // HEL-935: the SAME class of sub-pixel gap intermittently affects
      // `.ui-select__option` itself, not just the trigger — reproduced
      // locally at 1/60 repeats of this exact case (768px), measuring a
      // genuine, non-zero `43.87115478515625` against the `44px` declared
      // in `inputs.css` (no border, no `calc()`). This is NOT the same
      // mechanism as HEL-897's probe race (a Node<->browser round-trip gap
      // in `bisectHitExtent`'s bisection walk, producing a flat,
      // deterministic `extent 0` — a completely different code path this
      // test never calls): this case measures a plausible, real,
      // just-under-floor number via plain `boundingBox()`. Handled via a
      // narrow, documented `RENDERED_BOX_EPSILON_PX` tolerance in
      // `touchTargetProbe.ts`'s `assertFloor`, not a probe-race fix — see
      // that constant's doc comment for the full evidence trail.
      test("surface 5: ui-select option list", async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `uiselect-${width}`);
        const sourceRes = await page.request.post("/api/data-sources", {
          data: {
            name: "HEL-813 Source",
            type: "static",
            columns: [{ name: "a", type: "string" }],
            rows: [["x"]],
          },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(sourceRes.status()).toBe(201);
        await page.goto("/pipelines");
        await page.getByRole("button", { name: "New pipeline" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await dialog.locator(".ui-select__trigger").click();
        await expect(dialog.locator(".ui-select__option").first()).toBeVisible();

        await sweepSurface(page, { selectors: [".ui-select__option"], scope: dialog });
      });

      // Surface 6 (design.md D3 item 6) — panel-list zoom controls (HEL-781)
      // and the dashboard-actions trigger. The zoom widget is genuinely
      // hidden (not merely small) at 430px, so at that width the surface's
      // real measured control is the command bar's "Dashboard actions"
      // kebab — which is where "Add panel" moved when the panel-list header
      // bar (count pill + `.panel-list__add`) was removed. That button no
      // longer exists, so it cannot be the surface's anchor any more.
      test("surface 6: panel-list zoom + dashboard-actions controls", async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `panellist-${width}`);
        const dashboardRes = await page.request.post("/api/dashboards", {
          data: { name: "HEL-813 PanelList" },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(dashboardRes.status()).toBe(201);
        await page.goto("/");
        await expect(page.getByRole("heading", { name: /HEL-813 PanelList/ })).toBeVisible();

        if (width === 430) {
          await assertHiddenAtWidth(page.locator(".panel-list__zoom-widget"));
        } else {
          // These two DO grow their box: they sit 2px apart inside a pill, so
          // overlapping 44px expanders would fight over the same taps.
          await sweepSurface(page, {
            selectors: [".panel-list__zoom-button", ".panel-list__zoom-reset"],
          });
        }

        await assertExpanderFloor(page, page.locator(".app-command-bar .actions-menu__trigger"));
      });

      // Surface 7 (HEL-824 design.md Decision 5) — the Connectors page: the
      // empty-state CTA on a fresh account, then the create modal's controls
      // once open, then list-row actions (test/edit/delete) once a connector
      // exists.
      test("surface 7: Connectors page", async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `connectors-${width}`);
        await page.goto("/connectors");

        const main = page.locator("#app-main-content");
        await expect(main.locator(".ui-empty-state__cta")).toBeVisible();
        await sweepSurface(page, { selectors: [".ui-empty-state__cta"], scope: main });

        await main.locator(".ui-empty-state__cta").click();
        const createDialog = page.getByRole("dialog", { name: "Add connector" });
        await expect(createDialog).toBeVisible();
        // Settle wait — mirrors surface 5's own intervening action before its first
        // sweep. `Modal.css`'s entrance animation (`ui-modal-in`, `--transition-slow`
        // = 0.28s) starts at `scale(0.985)`; sweeping immediately after `toBeVisible()`
        // catches the dialog mid-animation (44 * 0.985 = 43.34, under the 44px floor)
        // even though the buttons are genuinely 44px once settled. Wait past
        // `--transition-slow` before measuring rendered geometry.
        await page.waitForTimeout(400);
        await assertExpanderFloor(page, createDialog.locator(".connectors-page__btn"));

        await createDialog.locator("#create-connector-name").fill("HEL-813 Connector");
        await createDialog
          .locator("#create-connector-base-url")
          .fill("https://api.hel813.example.com");
        await createDialog.getByRole("button", { name: "Create connector" }).click();
        await expect(createDialog).toBeHidden();
        // Scoped to the list row, not a bare page-wide text match — the success
        // toast ALSO renders "HEL-813 Connector" text (twice: the visually-hidden
        // live-region echo plus the visible toast), which a page.getByText() would
        // ambiguously resolve to 3 elements.
        await expect(
          main.locator(".connectors-page__name-cell", { hasText: "HEL-813 Connector" }),
        ).toBeVisible();

        await assertExpanderFloor(page, main.locator(".connectors-page__btn"));
      });
    });
  }
});
