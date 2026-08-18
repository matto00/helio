import { expect, test } from "@playwright/test";

// HEL-716 — live verification (design.md Risks/Trade-offs; tasks.md 4.5).
//
// PanelCreationModal's manual Tab-wrap focus trap was deleted as part of
// migrating onto the shared `Modal` primitive, but NOT because native
// <dialog> + showModal() containment is sufficient on its own — it isn't
// (probe-confirmed false on two Chromium versions, tasks.md 1.6): native
// containment prevents Tab from escaping the dialog to outside content, but
// does not wrap focus back to the first/last element inside it. The trap
// logic was relocated and generalized into the shared `Modal.tsx` instead,
// so every `Modal` consumer gets correct wrap-around — that shared mechanism
// now has its own jsdom coverage too, in `Modal.test.tsx`'s
// `"Tab/Shift+Tab focus trap"` describe block (cycle 2 CR3; jsdom stubs
// showModal() as a no-op, but the trap itself is plain JS `keydown` handling,
// fully testable there). This file's role is a real-`<dialog>`, real-browser
// end-to-end check of that same shared mechanism as exercised through the
// migrated `PanelCreationModal` specifically (mirrors
// e2e/hel399-shape-instantiate.spec.ts's pattern — run on demand via
// `npm run e2e`, not part of the pre-commit gates).

const CSRF_HEADER = "X-Helio-Requested-With";

// Matches the manual trap's old FOCUSABLE_SELECTORS constant (deleted from
// PanelCreationModal.tsx) — the generic "what counts as Tab-focusable" query.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function uniqueEmail(label: string): string {
  return `hel716-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-716 PanelCreationModal focus-trap live verification", () => {
  test("Tab from the last focusable element wraps to the first, and Shift+Tab from the first wraps to the last", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("focustrap");
    const password = "correcthorsebattery1";

    await request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-716 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    // A dashboard must exist (and be selected) for "Add panel" to open the
    // creation modal.
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-716 Verification" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);

    await page.goto("/");
    await page.getByRole("button", { name: "Add panel" }).click();

    const dialog = page.getByRole("dialog", { name: "Create panel" });
    await expect(dialog).toBeVisible();
    // Sanity: this is the migrated Modal-based creation modal (size="lg"),
    // not some other dialog.
    await expect(dialog).toHaveClass(/ui-modal--lg/);

    const focusable = dialog.locator(FOCUSABLE_SELECTOR);
    const count = await focusable.count();
    expect(count).toBeGreaterThan(1);

    // Tab from the last focusable element wraps to the first.
    await focusable.last().focus();
    await page.keyboard.press("Tab");
    const isFirstFocused = await focusable.first().evaluate((el) => el === document.activeElement);
    expect(isFirstFocused).toBe(true);

    // Shift+Tab from the first focusable element wraps to the last.
    await focusable.first().focus();
    await page.keyboard.press("Shift+Tab");
    const isLastFocused = await focusable.last().evaluate((el) => el === document.activeElement);
    expect(isLastFocused).toBe(true);
  });
});
