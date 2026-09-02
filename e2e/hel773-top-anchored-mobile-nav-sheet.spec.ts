import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-773 — live verification (design.md Risks/Trade-offs; tasks.md 6.1-6.7).
//
// jsdom implements no real layout, `clip-path` compositing, or media-query
// evaluation, so the anchor-position, stacking, tap-target, and reduced-
// motion claims below can't be observed from a DOM-rendering Jest test —
// mirrors `e2e/hel909-output-picker-panel-sheet.spec.ts`'s pattern (run on
// demand via `npm run e2e`, not part of the pre-commit gates). Per the
// session brief: launched via this repo's own `@playwright/test` runner
// (its own browser process), never the shared MCP Playwright session.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel773-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-773 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Opens the sheet and, unless `settleMs` is 0, waits for the entrance
 *  animation (--transition-slow, ~0.28s) to finish before returning — every
 *  test that measures RESTING geometry needs this; the one test that
 *  deliberately samples mid-entrance (task 6.4/D3) passes `settleMs: 0` for
 *  its first sample. */
async function openSheet(page: Page, triggerNameRe: RegExp, settleMs = 400) {
  const trigger = page.getByRole("button", { name: triggerNameRe });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return trigger;
}

test.describe("HEL-773 top-anchored mobile nav sheet — live verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 900 });
  });

  // Task 6.2 / AC2 — the sheet's top edge tracks the claimed safe-area
  // inset at every supported notch/dynamic-island size, and the probe is
  // proven able to detect a mismatch (the three measured tops differ).
  test("sheet top tracks --app-safe-top at 0/47/59px, forced on document.documentElement only", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "safearea");
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Safe Area" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);
    await page.goto("/");

    await openSheet(page, /Switch dashboards/i);

    const tops: number[] = [];
    for (const insetPx of [0, 47, 59]) {
      await page.evaluate((px) => {
        document.documentElement.style.setProperty("--app-safe-top", `${px}px`);
      }, insetPx);

      const { sheetTop, barBottom, statusBarRegionOccluded } = await page.evaluate(() => {
        const panel = document.querySelector(".mobile-nav-sheet__panel");
        const bar = document.querySelector(".app-command-bar");
        if (!panel || !bar) throw new Error("sheet or command bar not found");
        const sheetRect = panel.getBoundingClientRect();
        const barRect = bar.getBoundingClientRect();
        // AC2 — no sheet row is ever occluded by the status-bar region
        // (everything above the bar's own bottom edge).
        const firstRow = document.querySelector(".mobile-nav-sheet__item, .ui-empty-state");
        const rowRect = firstRow?.getBoundingClientRect();
        return {
          sheetTop: sheetRect.top,
          barBottom: barRect.bottom,
          statusBarRegionOccluded: rowRect ? rowRect.top < barRect.bottom : false,
        };
      });

      expect(sheetTop).toBeCloseTo(barBottom, 0);
      expect(statusBarRegionOccluded).toBe(false);
      tops.push(sheetTop);
    }

    // The probe must be capable of failing: three distinct forced insets
    // produce three distinct measured tops, so a no-op forced value
    // couldn't silently pass this assertion.
    expect(new Set(tops).size).toBe(3);
  });

  // Task 6.3 / spec "Sheet rows meet the 44px touch-target minimum" —
  // computed-style measurement, never read off the CSS source, at both
  // mobile breakpoints (430 and 768).
  test("every row, the header create action, the empty-branch CTA, and the drag strip compute to >=44px at 430 and 768", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "44px");
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Tap Target A" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);
    const secondDashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Tap Target B" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(secondDashboardRes.status()).toBe(201);

    for (const width of [430, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await openSheet(page, /Switch dashboards/i);

      const measurements = await page.evaluate(() => {
        function height(el: Element | null): number | null {
          if (!el) return null;
          return parseFloat(getComputedStyle(el).height);
        }
        const row = document.querySelector(".mobile-nav-sheet__item");
        const dragStrip = document.querySelector(".mobile-nav-sheet__drag-strip");
        return { row: height(row), dragStrip: height(dragStrip) };
      });

      expect(measurements.row).not.toBeNull();
      expect(measurements.row!).toBeGreaterThanOrEqual(44);
      expect(measurements.dragStrip).not.toBeNull();
      expect(measurements.dragStrip!).toBeGreaterThanOrEqual(44);

      // Header create action — dashboards always has one. It reaches the
      // floor via a `::after` hit expander now (DESIGN.md §3), so its
      // PAINTED height is deliberately `--control-sm` and a computed-height
      // assertion would be measuring the wrong box. The hit region is what
      // matters and what is asserted here, by walking outward from the
      // control's centre with `elementFromPoint` — the same technique
      // `e2e/support/touchTargetProbe.ts`'s `bisectHitExtent` uses.
      const createActionHit = await page.evaluate(() => {
        const el = document.querySelector(".mobile-nav-sheet__create-action");
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const step = 0.25;
        const walk = (direction: 1 | -1): number => {
          let distance = 0;
          for (;;) {
            const next = distance + step;
            const at = document.elementFromPoint(cx, cy + direction * next);
            if (!at || !(el === at || el.contains(at))) break;
            distance = next;
          }
          return distance;
        };
        return { hitHeight: walk(1) + walk(-1), paintedHeight: rect.height };
      });
      expect(createActionHit).not.toBeNull();
      // Epsilon-adjusted, per DESIGN.md: a correctly abutting hit region
      // legitimately bisects to just under 44px at a 0.25px sampling step.
      expect(createActionHit!.hitHeight).toBeGreaterThanOrEqual(44 - 0.25);
      // The other half of the contract — it must NOT have re-inflated its box.
      expect(createActionHit!.paintedHeight).toBeLessThan(44);

      // Empty-branch CTA — force it by navigating to a section that's empty
      // and has a create action (sources, freshly registered = no sources).
      // Root-cause note (systematic-debugging): `.ui-empty-state__cta` is
      // NOT unique to the sheet — the desktop `SidebarItemList` renders the
      // identical class in its own (CSS-`display:none`-but-still-mounted at
      // phone width) empty state, appearing earlier in DOM order. An
      // unscoped `document.querySelector` silently measured THAT one
      // instead (28px, `--control-sm`, no layout ever runs for a
      // `display:none` subtree so its `min-height` clamp never applies) —
      // scoping to `[role="dialog"]` is the fix, not a change to
      // `MobileNavSheet`/`EmptyState`, which already computed 44px
      // correctly once measured on the right element.
      await page.getByRole("button", { name: "Close" }).click();
      await page.goto("/sources");
      await openSheet(page, /Switch data sources/i);
      const ctaHeight = await page.evaluate(() => {
        const el = document.querySelector('[role="dialog"] .ui-empty-state__cta');
        return el ? parseFloat(getComputedStyle(el).height) : null;
      });
      expect(ctaHeight).not.toBeNull();
      expect(ctaHeight!).toBeGreaterThanOrEqual(44);
    }
  });

  // skeptic-final-1.md CR1 — the header create action's glyph must render at
  // the same ~1em size the rest of the app uses for this identical lucide
  // icon (the empty-branch CTA, the desktop sidebar/main EmptyState CTAs —
  // all backed by the same HEL-548 hooks), not the icon's literal
  // `width="24" height="24"` SVG attributes. Measured via
  // `getBoundingClientRect` on the rendered <svg> itself, scoped to the
  // sheet's own dialog, in both themes — never read off the CSS.
  test("the header create action's icon renders at ~1em, not the lucide SVG's intrinsic 24px, in both themes", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "iconsize");
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Icon Size" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((t) => localStorage.setItem("helio-theme", t), theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await openSheet(page, /Switch dashboards/i);

      const size = await page.evaluate(() => {
        const button = document.querySelector('[role="dialog"] .mobile-nav-sheet__create-action');
        const svg = button?.querySelector("svg");
        const rect = svg?.getBoundingClientRect();
        return { width: rect?.width ?? null, height: rect?.height ?? null };
      });

      expect(size.width).not.toBeNull();
      // ~1em of the button's 14px (--text-sm) label — comfortably under the
      // 24px the un-neutralised lucide SVG would render at, with slack for
      // sub-pixel font metrics.
      expect(size.width!).toBeLessThan(16);
      expect(size.width!).toBeGreaterThan(8);
      expect(size.height).toBe(size.width);
    }
  });

  // Task 6.4 / design.md D3 — element-at-point (not getBoundingClientRect,
  // which ignores clip-path) proves the command bar is never dimmed or
  // covered, at both the opening frame and the settled frame.
  test("the command bar is never overlapped or dimmed by the sheet or its scrim, at any frame", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "stacking");
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Stacking" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);
    await page.goto("/");

    const trigger = page.getByRole("button", { name: /Switch dashboards/i });
    await trigger.click();

    // Sample immediately (mid-entrance, while the panel is animating in)
    // and again once settled — the clip-path defect this locks against
    // (a naive rect check reading the panel as "above the seam" mid-
    // entrance even when the CSS is correct) is specifically an early-frame
    // risk.
    for (const waitMs of [0, 400]) {
      if (waitMs > 0) await page.waitForTimeout(waitMs);
      const result = await page.evaluate(() => {
        const bar = document.querySelector(".app-command-bar");
        if (!bar) throw new Error("command bar not found");
        const rect = bar.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const elAtCentre = document.elementFromPoint(cx, cy);
        return {
          barContainsCentreEl: elAtCentre !== null && bar.contains(elAtCentre),
        };
      });
      expect(result.barContainsCentreEl).toBe(true);
    }

    // The trigger itself stays hit-testable (design.md D2) — element-at-
    // point at the trigger's own centre resolves to the trigger or a
    // descendant of it, not the backdrop/panel painted above it.
    const triggerHitTestable = await page.evaluate(() => {
      const trigger = document.querySelector(".app-command-bar__mobile-title");
      if (!trigger) throw new Error("trigger not found");
      const rect = trigger.getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return el !== null && trigger.contains(el);
    });
    expect(triggerHitTestable).toBe(true);
  });

  // Task 6.5 / design.md D5 — the sheet's height must clear the floating
  // bottom-nav capsule.
  test("the drag strip's bottom edge sits above the floating bottom nav's top edge at 430px", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "clearance");
    for (let i = 0; i < 8; i++) {
      const res = await page.request.post("/api/dashboards", {
        data: { name: `HEL-773 Clearance ${i}` },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.status()).toBe(201);
    }
    await page.goto("/");
    await openSheet(page, /Switch dashboards/i);

    const { dragStripBottom, bottomNavTop } = await page.evaluate(() => {
      const dragStrip = document.querySelector(".mobile-nav-sheet__drag-strip");
      const bottomNav = document.querySelector(".bottom-nav");
      if (!dragStrip || !bottomNav) throw new Error("drag strip or bottom nav not found");
      return {
        dragStripBottom: dragStrip.getBoundingClientRect().bottom,
        bottomNavTop: bottomNav.getBoundingClientRect().top,
      };
    });

    expect(dragStripBottom).toBeLessThanOrEqual(bottomNavTop);
  });

  // Task 6.6 / design.md D12 — reduced motion genuinely disables the
  // entrance (computed animation-name: none), for the element that
  // actually carries it under D3 (the panel), red-first per task 5.10:
  // asserting this on an element that never animates (e.g. the list) would
  // be vacuous, so the panel/wrapper/backdrop are checked explicitly.
  test("prefers-reduced-motion: reduce disables the entrance on the panel, wrapper, and backdrop", async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await registerAndLogin(page, request, "reducedmotion");
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Reduced Motion" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);
    await page.goto("/");
    await openSheet(page, /Switch dashboards/i);

    const animationNames = await page.evaluate(() => {
      function animationName(selector: string): string | null {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).animationName : null;
      }
      return {
        panel: animationName(".mobile-nav-sheet__panel"),
        clip: animationName(".mobile-nav-sheet__clip"),
        backdrop: animationName(".mobile-nav-sheet__backdrop"),
      };
    });

    expect(animationNames.panel).toBe("none");
    expect(animationNames.clip).toBe("none");
    expect(animationNames.backdrop).toBe("none");
  });

  // Evaluation-1.md CR1 (cycle 2) — the sheet must be reopenable on the
  // first tap after ANY create action fires from it, on both the
  // pending-capable hook (dashboards) and a flag-flip hook (sources). The
  // evaluator's cycle-1 measurement showed a ~14ms open-then-close flash on
  // the first reopen after either. Asserted on the real app (not a mock),
  // reproducing their exact repro shape: fire the create action, dismiss
  // whatever it opened, then tap the trigger and confirm the dialog is
  // actually visible and STAYS visible — no second tap needed.
  test("the sheet reopens on the first tap after a create action fires from it (dashboards and sources)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "reopen");
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-773 Reopen" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);

    // Dashboards: async, pending-capable create. Scoped to the sheet's own
    // dialog (see the sources section below for why).
    await page.goto("/");
    const dashboardsDialog = page.getByRole("dialog", { name: "Dashboards" });
    await openSheet(page, /Switch dashboards/i);
    await dashboardsDialog.getByRole("button", { name: "New dashboard" }).click();
    // The create dismisses the sheet on success (design.md D9).
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 5000 });

    const dashboardsTrigger = page.getByRole("button", { name: /Switch dashboards/i });
    await dashboardsTrigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Give any spurious auto-close a full beat to happen, then confirm the
    // dialog is STILL there — this is what a ~14ms flash-then-close would
    // fail on a naive `toBeVisible()` immediately-after-click check.
    await page.waitForTimeout(300);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(dashboardsTrigger).toHaveAttribute("aria-expanded", "true");

    // Close it (backdrop tap) before moving to the next section.
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Sources: a pure flag-flip create (dismisses on fire, opens a modal).
    // Scoped to the sheet's OWN dialog — the desktop `SidebarItemList`
    // renders an identically-labelled "Add source" button too (mounted,
    // CSS-`display:none` at phone width but not hidden from Playwright's
    // accessibility tree), same class of ambiguity the e2e 44px probe hit
    // in cycle 1 (see files-modified.md's root-cause note).
    await page.goto("/sources");
    const sheetDialog = page.getByRole("dialog", { name: "Data Sources" });
    await openSheet(page, /Switch data sources/i);
    await sheetDialog.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByRole("dialog", { name: "Add data source" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Add data source" })).toHaveCount(0);

    const sourcesTrigger = page.getByRole("button", { name: /Switch data sources/i });
    await sourcesTrigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(sourcesTrigger).toHaveAttribute("aria-expanded", "true");
  });

  // Task 6.7 / AC1/AC6 — direction change on a create-action section
  // (dashboards), at 430 and 375, in both themes.
  //
  // HEL-909: the former second half of this test used `/metrics` as its
  // "no create action" comparison section. `/metrics` was retired outright
  // (nav collapse), and every remaining pickable section (dashboards,
  // sources, pipelines, chat) now has its own create action (chat's
  // "New chat" was added by a later HEL-909 cycle closing HEL-789's
  // surviving half) -- `/connectors` is a real destination but is
  // deliberately `pickerId: "other"` (not a pickable list section, see
  // `sections.ts`), so it never renders a "Switch X" phone title control at
  // all and can't stand in as a like-for-like replacement. There is no
  // longer a real "no create action" picker section to compare against, so
  // that half of this test is dropped rather than pointed at a section that
  // doesn't behave the way the test's own name claims.
  for (const width of [430, 375]) {
    for (const theme of ["dark", "light"] as const) {
      test(`direction change reads as anchored on a create-action section at ${width}px, ${theme} theme`, async ({
        page,
        request,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await registerAndLogin(page, request, `matrix-${width}-${theme}`);
        await page.evaluate((t) => localStorage.setItem("helio-theme", t), theme);
        const dashboardRes = await page.request.post("/api/dashboards", {
          data: { name: "HEL-773 Matrix" },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(dashboardRes.status()).toBe(201);

        await page.goto("/");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const dashboardsTrigger = await openSheet(page, /Switch dashboards/i);
        const dashboardsGeometry = await page.evaluate(() => {
          const panel = document.querySelector(".mobile-nav-sheet__panel");
          const bar = document.querySelector(".app-command-bar");
          if (!panel || !bar) throw new Error("not found");
          return {
            sheetTop: panel.getBoundingClientRect().top,
            barBottom: bar.getBoundingClientRect().bottom,
          };
        });
        expect(dashboardsGeometry.sheetTop).toBeCloseTo(dashboardsGeometry.barBottom, 0);
        await expect(page.getByRole("button", { name: /New dashboard/ })).toBeVisible();
        await dashboardsTrigger.click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
      });
    }
  }
});
