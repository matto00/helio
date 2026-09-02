import { expect, test } from "@playwright/test";

// HEL-716 — live verification (skeptic-final-3.md).
//
// Regression guard for a severe bug found by the final-gate skeptic (round 3):
// `Modal.css`'s `.ui-modal__inner` used to size itself independently against
// a hardcoded `max-height: 90vh`, regardless of the actual <dialog> box's own
// height. `PanelDetailModal.css`'s `.panel-detail-modal { height: min(680px,
// 90vh); overflow: hidden; }` gives the dialog a narrower fixed height at any
// viewport taller than ~756px (most real desktop/laptop screens) — but
// `.ui-modal__inner` still grew to its own 90vh, taller than the dialog's real
// box. Since the dialog clips overflow, the footer (Cancel/Save) and the
// discard-confirmation banner were completely invisible *and unreachable*
// (confirmed via `document.elementFromPoint` — a real click at the Save
// button's location hit the dialog backdrop instead) for any ordinary panel
// edit form, at any viewport ≥~756px tall. Fixed by making `.ui-modal__inner`
// always `height: 100%` of its actual parent box instead of an independently
// capped `90vh`.
//
// The default/short viewport used by most manual and automated passes hid
// this defect entirely (only reproduces above ~756px viewport height) — this
// spec pins a tall (900px) viewport specifically so it can't regress silently
// again. Mirrors e2e/hel909-output-picker-panel-sheet.spec.ts's pattern — run
// on demand via `npm run e2e`, not part of the pre-commit gates.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel716-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.use({ viewport: { width: 1440, height: 900 } });

test.describe("HEL-716 PanelDetailModal tall-viewport footer visibility", () => {
  test("Save button and the discard-confirm banner are visible and clickable in edit mode at a 900px-tall viewport", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("tallviewport");
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

    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-716 Tall Viewport Verification" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);
    const dashboard = (await dashboardRes.json()) as { id: string };

    // An ordinary Metric panel — no chart/table config needed to trigger the
    // bug; the skeptic's finding was that a plain edit form was enough.
    const panelRes = await page.request.post("/api/panels", {
      data: { dashboardId: dashboard.id, title: "Total value", type: "metric" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(panelRes.status()).toBe(201);

    await page.goto("/");
    await page.getByText("Total value").click();

    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Edit panel" }).click();
    await expect(dialog).toHaveClass(/panel-detail-modal/);

    // The inner flex wrapper must never exceed the dialog's own (possibly
    // narrower-than-90vh) box — this is the exact mechanism of the bug.
    const heights = await page.evaluate(() => {
      const dlg = document.querySelector("dialog.panel-detail-modal")!;
      const inner = dlg.querySelector(".ui-modal__inner")!;
      return {
        dialogHeight: dlg.getBoundingClientRect().height,
        innerHeight: inner.getBoundingClientRect().height,
      };
    });
    expect(heights.innerHeight).toBeLessThanOrEqual(heights.dialogHeight + 1);

    // The footer is visible with no scrolling, and a real click at its
    // on-screen location hits the button itself, not the dialog backdrop.
    const saveButton = page.getByRole("button", { name: "Save panel settings" });
    await expect(saveButton).toBeVisible();
    const saveBox = await saveButton.boundingBox();
    expect(saveBox).not.toBeNull();
    const saveHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
      x: saveBox!.x + saveBox!.width / 2,
      y: saveBox!.y + saveBox!.height / 2,
    });
    expect(saveHit).not.toBe("DIALOG");

    // Dirty the form, trigger the discard-confirm banner, and confirm it too
    // is visible and clickable (not clipped past the dialog's real height).
    await page.getByLabel("Panel title").fill("Total value (edited)");
    await page.keyboard.press("Escape");
    const banner = page.getByText("You have unsaved changes. Discard them?");
    await expect(banner).toBeVisible();
    const bannerBox = await banner.boundingBox();
    expect(bannerBox).not.toBeNull();
    const bannerHit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, {
      x: bannerBox!.x + bannerBox!.width / 2,
      y: bannerBox!.y + bannerBox!.height / 2,
    });
    expect(bannerHit).not.toBe("DIALOG");

    // A real click on the visible Save button actually submits the form
    // (returns to view mode), not swallowed as a backdrop click.
    await page.getByRole("button", { name: "Keep editing" }).click();
    await saveButton.click();
    await expect(page.getByRole("button", { name: "Edit panel" })).toBeVisible({ timeout: 5000 });
  });
});
