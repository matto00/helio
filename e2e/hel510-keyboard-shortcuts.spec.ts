import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-510 — real-browser proof for the keyboard-shortcut help overlay and its guards
// (design.md Risks: "jsdom-vacuous keyboard/focus assertions" is the central hazard for this
// ticket; every claim below is measured against a real running dev server, never asserted from
// jsdom). Follows the shape of e2e/hel1003-actions-menu-keyboard-reach.spec.ts.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel510-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-510 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  // HEL-1030 — every test in this file presses a global keyboard shortcut ("?"/Cmd+K) as its
  // very first interaction with the authenticated shell. The listener those shortcuts dispatch
  // through (`useShortcut`'s window `keydown` registration) attaches lazily in a passive effect
  // that commits strictly after the shell's first render — a real, if narrow, race that exists
  // for ANY global-shortcut trigger fired immediately post-navigation (confirmed present, at a
  // comparable or higher rate, on `0638f749` — the commit before this ticket's shortcut registry
  // shipped — via a throwaway Cmd+K probe run at the same worker count; this file's tests merely
  // draw against that same pre-existing race far more often because five of its eight tests all
  // share this exact precondition). Waiting on a real, always-present post-mount element (rather
  // than a bare timeout) is a precondition wait, not a retry/timeout loosening: it holds until
  // the shell — and therefore every `useShortcut` consumer mounted alongside it — has actually
  // committed, which is the one thing every failure observed under load had in common.
  await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible();
}

function helpOverlayDialog(page: Page) {
  return page.locator(".help-overlay");
}

test.describe("HEL-510 keyboard-shortcut help overlay", () => {
  // (a) `?` opens the overlay from an authenticated route.
  test("? opens the help overlay from an authenticated route", async ({ page, request }) => {
    await registerAndLogin(page, request, "open");
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("?");

    await expect(helpOverlayDialog(page)).toHaveAttribute("open");
    await expect(helpOverlayDialog(page)).toContainText("Keyboard shortcuts");
  });

  // skeptic-final-1.md CR1 — `.help-overlay__rows` is a `<ul>`; an unstyled `<ul>` inherits the
  // user-agent defaults `padding-inline-start: 40px` and `margin: 16px 0`, which a source-text CSS
  // scan (`KeyCap.css.test.ts`'s pattern) cannot catch, because nothing was WRITTEN — the spacing
  // was inherited. jsdom can't resolve UA defaults either, so this is a real-browser computed-style
  // assertion, the only honest way to guard it.
  test("? overlay's row list has no inherited UA list spacing (list-style/margin/padding reset)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "listreset");
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("?");
    const rowsList = page.locator(".help-overlay__rows").first();
    await expect(rowsList).toBeVisible();
    // HEL-1030 — `Modal.css`'s `.ui-modal[open]` plays a `--transition-slow` (280ms) entrance
    // animation on `transform`. `toBeVisible()` above is satisfied as soon as the dialog is in
    // the DOM and not display:none, well before that animation settles — so the geometry read
    // below could otherwise land mid-animation and see a transiently shifted `x`. Wait for the
    // dialog's own running animations to finish (not a blind timeout) before measuring.
    await helpOverlayDialog(page).evaluate(
      (el) => Promise.all(el.getAnimations().map((a) => a.finished)) as Promise<unknown>,
    );

    const computed = await rowsList.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        paddingLeft: cs.paddingLeft,
        marginTop: cs.marginTop,
        marginBottom: cs.marginBottom,
        listStyleType: cs.listStyleType,
      };
    });

    expect(computed.paddingLeft).toBe("0px");
    expect(computed.marginTop).toBe("0px");
    expect(computed.marginBottom).toBe("0px");
    expect(computed.listStyleType).toBe("none");

    // Discriminating geometry assertion (the exact symptom the skeptic measured): a ROW (the
    // `<li>` child) must not sit to the right of its own group eyebrow. Measuring the `<ul>`
    // itself here would NOT discriminate: the `<ul>`'s own border box doesn't move when its own
    // inline-start padding grows (only its content shifts), so that would stay green on the
    // broken CSS — the child `<li>` is what actually gets pushed right by inherited padding.
    const groupLabel = page.locator(".help-overlay__group-label").first();
    const firstRow = page.locator(".help-overlay__row").first();
    const rowBox = await firstRow.boundingBox();
    const labelBox = await groupLabel.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(Math.abs(rowBox!.x - labelBox!.x)).toBeLessThan(2);
  });

  // (b) Esc closes it; (c) focus returns to the previously-focused element.
  test("Esc closes the overlay and restores focus to the previously-focused element", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "escfocus");

    const trigger = page.getByRole("button", { name: "Add dashboard" });
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("?");
    await expect(helpOverlayDialog(page)).toHaveAttribute("open");

    await page.keyboard.press("Escape");
    await expect(helpOverlayDialog(page)).not.toHaveAttribute("open");
    await expect(trigger).toBeFocused();
  });

  // (d) Tab/Shift+Tab stay inside the overlay.
  test("Tab/Shift+Tab stay inside the overlay", async ({ page, request }) => {
    await registerAndLogin(page, request, "trap");
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("?");
    await expect(helpOverlayDialog(page)).toHaveAttribute("open");

    const focusableInDialog = await helpOverlayDialog(page).evaluate(
      (dialog) =>
        Array.from(
          dialog.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).length,
    );
    expect(focusableInDialog).toBeGreaterThan(0);

    // Tab repeatedly; focus must never leave the dialog.
    for (let i = 0; i < focusableInDialog + 2; i += 1) {
      await page.keyboard.press("Tab");
      const stillInside = await helpOverlayDialog(page).evaluate((dialog) =>
        dialog.contains(document.activeElement),
      );
      expect(stillInside).toBe(true);
    }

    // Shift+Tab repeatedly; focus must still never leave the dialog (the test's name promises
    // both directions are actually exercised, not just Tab).
    for (let i = 0; i < focusableInDialog + 2; i += 1) {
      await page.keyboard.press("Shift+Tab");
      const stillInside = await helpOverlayDialog(page).evaluate((dialog) =>
        dialog.contains(document.activeElement),
      );
      expect(stillInside).toBe(true);
    }
  });

  // (e) `?` does nothing while focus is in a text input.
  test("? does nothing while focus is in a text input", async ({ page, request }) => {
    await registerAndLogin(page, request, "typing");

    const searchInput = page.getByLabel("Filter dashboards by name");
    await searchInput.click();
    await searchInput.type("?");

    await expect(helpOverlayDialog(page)).not.toHaveAttribute("open");
    await expect(searchInput).toHaveValue("?");
  });

  // (f) `?` does nothing while another modal is open.
  test("? does nothing while the command palette is already open", async ({ page, request }) => {
    await registerAndLogin(page, request, "guard");
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    const isMac = process.platform === "darwin";
    await page.keyboard.press(isMac ? "Meta+K" : "Control+K");
    await expect(page.locator(".command-palette")).toHaveAttribute("open");

    await page.keyboard.type("?");

    await expect(page.locator(".command-palette")).toHaveAttribute("open");
    // Discriminating assertion: the help overlay dialog is never opened.
    const helpOpenCount = await page.locator(".help-overlay[open]").count();
    expect(helpOpenCount).toBe(0);
  });

  // (g) Cmd/Ctrl+K still opens the palette while the palette is already open.
  test("Cmd/Ctrl+K still opens the palette while the palette is already open", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "paletteguard");
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    const isMac = process.platform === "darwin";
    const combo = isMac ? "Meta+K" : "Control+K";

    await page.keyboard.press(combo);
    await expect(page.locator(".command-palette")).toHaveAttribute("open");

    const searchInput = page.getByLabel("Search commands");
    await searchInput.fill("Alpha-query-should-still-work");

    await page.keyboard.press(combo);

    await expect(page.locator(".command-palette")).toHaveAttribute("open");
    await expect(searchInput).toHaveValue("Alpha-query-should-still-work");
  });
});
