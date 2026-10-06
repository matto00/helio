import { expect, type Page } from "@playwright/test";

// HEL-1336 — readiness gate for specs that measure or count on `/settings`.
//
// The page's "Audit history" section fetches `GET /api/audit-events` on mount, so its table (and
// every `.sortable-th__btn` in its header) renders a few hundred ms AFTER the "Appearance"
// heading. A measurement taken as soon as the heading is visible can see a partial page.
//
// Waits (web-first expects, default timeout) for the section's table and its first sort button.
// The table and all its header cells commit in one React render, so "first sort button visible"
// implies all are present — no hard-coded column count. Deliberately fails (times out) if the
// section settles to the empty/error branch: an e2e user always has an `auth.register` audit
// event, so a non-table state is a different page shape, not a ready one.
//
// Call it right after `page.goto("/settings")`, before any measurement or interaction.
export async function waitForSettingsAuditTable(page: Page): Promise<void> {
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Audit history" }),
  });
  await expect(section.getByRole("table")).toBeVisible();
  await expect(section.locator("thead .sortable-th__btn").first()).toBeVisible();
}
