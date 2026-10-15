import { expect, type Locator, type Page } from "@playwright/test";

// HEL-1579: locators for the desktop pipeline page's step spine, shared by the e2e specs that drive the
// pipeline editor. A spine row is `.spine-row`; its title is `.spine-row__title`; per-row actions live in a
// quiet "Step actions for <label>" menu; the selected step's editor is the "Step <n> <label>" region.

export function spineRows(page: Page): Locator {
  return page.locator(".spine-row");
}

export function spineTitles(page: Page): Locator {
  return page.locator(".spine-row__title");
}

/** The nth spine row (document order: trunk rows with their branch lanes nested under the parent row). */
export function spineRow(page: Page, index: number): Locator {
  return spineRows(page).nth(index);
}

/** Selects the nth row and waits for it to be the current one. */
export async function selectRow(page: Page, index: number): Promise<void> {
  const row = spineRow(page, index);
  await row.locator(".spine-row__select").click();
  await expect(row.locator(".spine-row__select")).toHaveAttribute("aria-current", "true");
}

/** Opens the nth row's quiet menu and returns the menu item locator by accessible name. */
export async function rowMenuItem(
  page: Page,
  index: number,
  name: string | RegExp,
): Promise<Locator> {
  const row = spineRow(page, index);
  await row.hover();
  await row.getByRole("button", { name: /^Step actions for / }).click();
  return page.getByRole("menuitem", { name });
}

export async function clickRowMenuItem(
  page: Page,
  index: number,
  name: string | RegExp,
): Promise<void> {
  const item = await rowMenuItem(page, index, name);
  await item.click();
}

/** The focused editor's quiet text action (Disable/Enable, Duplicate, Remove) for the selected step. */
export function editorAction(page: Page, name: string): Locator {
  return page.locator(".step-focused").getByRole("button", { name });
}

/**
 * Makes the pipeline page's Outputs visible: the phone's "Outputs (N)" tab is clicked; on desktop the spine's
 * OUTPUTS section is already on screen (there are no tabs), so it only waits for it.
 */
export async function showOutputs(page: Page): Promise<void> {
  const tab = page.getByRole("tab", { name: /^Outputs/ });
  const section = page.getByRole("region", { name: "Outputs" });
  await expect(tab.or(section)).toBeVisible();
  if (await tab.isVisible()) await tab.click();
}

/**
 * Opens one Output's History view. On the phone the Outputs tab's card has a direct "History for <name>"
 * button; on desktop the spine's OUTPUTS card keeps it in its quiet "Output actions for <name>" menu.
 */
export async function openOutputHistory(page: Page, outputName: string): Promise<void> {
  const direct = page.getByRole("button", { name: `History for ${outputName}` });
  const menuTrigger = page.getByRole("button", { name: `Output actions for ${outputName}` });
  await expect(direct.or(menuTrigger)).toBeVisible();
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await menuTrigger.click();
  await page.getByRole("menuitem", { name: `History for ${outputName}` }).click();
}
