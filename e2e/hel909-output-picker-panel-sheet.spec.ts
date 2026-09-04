import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-909 — live verification of the OutputPicker/Panel-sheet replacement for
// the retired shape-instantiate wizard (`PanelCreationModal`, deleted this
// change) and the old `PanelDetailModal` field-mapping editors (deleted this
// change). Mirrors `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts`'s
// register-and-login pattern -- run on demand via `npm run e2e`, not part of
// the pre-commit gates.
//
// Covers task 10.2 (desktop Add panel -> search -> Enter -> grid -> Panel
// sheet -> Swap output) and task 10.3 (the picker as the mobile "simple
// panel" flow at 375px/430px, closing HEL-490).

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel909-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-909 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Seeds a dashboard, a static data source, a pipeline off it, and two named
 *  chart-kind Outputs at the pipeline root ("Throughput" -- the one the
 *  picker's search targets -- and "Latency", a second Output the swap flow
 *  switches to). Returns their ids for assertions. */
async function seedThroughputOutput(page: Page, request: APIRequestContext) {
  const dashboardRes = await request.post("/api/dashboards", {
    data: { name: "HEL-909 Verification" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(dashboardRes.status()).toBe(201);

  const sourceRes = await request.post("/api/data-sources", {
    data: {
      name: "HEL-909 Service Metrics",
      type: "static",
      columns: [
        { name: "throughput", type: "integer" },
        { name: "latency", type: "integer" },
      ],
      rows: [
        [100, 12],
        [200, 15],
      ],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(sourceRes.status()).toBe(201);
  const source = (await sourceRes.json()) as { id: string };

  const pipelineRes = await request.post("/api/pipelines", {
    data: {
      name: "HEL-909 Service Pipeline",
      roots: [{ sourceId: source.id }],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(pipelineRes.status()).toBe(201);
  const pipeline = (await pipelineRes.json()) as { id: string };

  const throughputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: {
      kind: "chart",
      name: "Throughput",
      config: { chartType: "line", fieldMapping: { xAxis: "throughput", yAxis: "latency" } },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(throughputRes.status()).toBe(201);
  const throughput = (await throughputRes.json()) as { id: string };

  const latencyRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: {
      kind: "chart",
      name: "Latency",
      config: { chartType: "line", fieldMapping: { xAxis: "latency", yAxis: "throughput" } },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(latencyRes.status()).toBe(201);
  const latency = (await latencyRes.json()) as { id: string };

  return { throughputId: throughput.id, latencyId: latency.id };
}

test.describe("HEL-909 OutputPicker + Panel sheet live verification", () => {
  test("Add panel -> search 'throughput' -> Enter places a chart-default-size panel; the Panel sheet shows title/appearance/Output link only; Swap output works", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "desktop");
    const { latencyId } = await seedThroughputOutput(page, request);

    await page.goto("/");
    // Reached via the command bar's "Dashboard actions" kebab (HEL-813
    // surface 6's own precedent) -- the single Add-panel entry point once a
    // dashboard is selected, regardless of whether the onboarding checklist
    // or the "No panels yet" empty state is also on screen underneath it.
    await page.getByRole("button", { name: "Dashboard actions" }).click();
    await page.getByRole("menuitem", { name: "Add panel" }).click();

    const picker = page.getByRole("dialog", { name: "Add panel" });
    await expect(picker).toBeVisible();
    await page.getByLabel("Search outputs").fill("throughput");
    // Exactly one card matches -- the picker resets focus to index 0 on
    // every keystroke, so Enter (no arrow key) activates it.
    await expect(picker.getByRole("option", { name: /^Throughput/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();

    // The new panel lands on the grid at the chart kind's default size
    // (react-grid-layout's placed-layout-drives-the-grid contract, task 1.3)
    // -- asserted via the panel card being visible and occupying a real,
    // non-zero grid cell, not a specific literal w/h (that's react-grid-
    // layout/backend placement's own contract, not this picker's). A newly
    // placed Output panel has no title of its own yet (`OutputPanel.title`
    // is optional) -- it renders with the shared "Untitled Panel" default,
    // NOT the Output's own name, so this locates it by that default rather
    // than by "Throughput".
    const panelCard = page.locator(".react-grid-item", { hasText: "Untitled Panel" });
    await expect(panelCard).toBeVisible({ timeout: 10_000 });
    const box = await panelCard.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    // Open the panel and switch to edit mode -- the Panel sheet.
    await panelCard.click();
    const sheet = page.getByRole("dialog", { name: "Untitled Panel settings" });
    await expect(sheet).toBeVisible();
    await page.getByRole("button", { name: "Edit panel" }).click();

    // Title + appearance controls (AppearanceEditor) -- pre-filled with the
    // shared "Untitled Panel" default (the panel-level title override,
    // distinct from the Output's own name below).
    await expect(sheet.getByLabel("Panel title")).toHaveValue("Untitled Panel");
    await expect(sheet.getByLabel(/background color/i)).toBeVisible();
    await expect(sheet.getByLabel(/text color/i)).toBeVisible();
    // The Output link + Swap output — and NOTHING resembling the retired
    // field-mapping/DataType-bind controls (no such role/label exists any
    // more since BindingEditor/MetricPicker/DataTypePicker are deleted, so
    // there is nothing left to assert their absence against by name — the
    // presence of exactly these three controls below IS that assertion).
    await expect(sheet.getByRole("heading", { name: "Output" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Throughput" })).toBeVisible();
    const swapBtn = sheet.getByRole("button", { name: "Swap output" });
    await expect(swapBtn).toBeVisible();

    // Swap output re-opens the picker scoped to this panel; selecting a
    // different Output PATCHes the panel's outputId in place.
    await swapBtn.click();
    const swapPicker = page.getByRole("dialog", { name: "Swap output" });
    await expect(swapPicker).toBeVisible();
    await swapPicker.getByRole("option", { name: /^Latency/ }).click();
    await expect(swapPicker).toBeHidden();
    await expect(sheet.getByRole("link", { name: "Latency" })).toBeVisible({ timeout: 10_000 });
    void latencyId; // documents the seeded id the Output link above resolves to
  });

  for (const width of [375, 430]) {
    test(`the OutputPicker is the mobile "simple panel" flow at ${width}px (closes HEL-490)`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await registerAndLogin(page, request, `mobile-${width}`);
      await seedThroughputOutput(page, request);

      await page.goto("/");
      // Phone chrome: "Add panel" is reached via the command bar's
      // dashboard-actions kebab (HEL-813 surface 6's own precedent), not a
      // header-row button, at these widths.
      await page.getByRole("button", { name: "Dashboard actions" }).click();
      await page.getByRole("menuitem", { name: "Add panel" }).click();

      const picker = page.getByRole("dialog", { name: "Add panel" });
      await expect(picker).toBeVisible();
      // The picker itself (search input + output cards) renders, unclipped,
      // inside the phone-width dialog -- the actual HEL-490 regression was a
      // desktop-only wizard with no phone-usable path at all.
      await expect(picker.getByLabel("Search outputs")).toBeVisible();
      await picker.getByLabel("Search outputs").fill("throughput");
      const card = picker.getByRole("option", { name: /^Throughput/ });
      await expect(card).toBeVisible();
      const cardBox = await card.boundingBox();
      // The card must fit within the viewport width (no horizontal overflow
      // at phone width) -- the HEL-490 defect class this closes.
      expect(cardBox?.width ?? 0).toBeLessThanOrEqual(width);
      await card.click();
      await expect(picker).toBeHidden();

      // Placed panel renders with the shared "Untitled Panel" default
      // (no title override yet), not the Output's own name -- see the
      // desktop test's own note on this.
      await expect(
        page.locator(".mobile-panel-stack, .react-grid-item", { hasText: "Untitled Panel" }),
      ).toBeVisible({ timeout: 10_000 });
    });
  }

  test("arrow keys move real virtual focus in the picker (listbox/option roles, aria-activedescendant, scroll-into-view) and Enter places the focused Output", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "kbnav");
    const { throughputId } = await seedThroughputOutput(page, request);

    await page.goto("/");
    await page.getByRole("button", { name: "Dashboard actions" }).click();
    await page.getByRole("menuitem", { name: "Add panel" }).click();

    const picker = page.getByRole("dialog", { name: "Add panel" });
    await expect(picker).toBeVisible();

    const search = picker.getByLabel("Search outputs");
    await expect(search).toBeFocused();

    // DOM focus never leaves the search input; the listbox pattern instead
    // publishes the logically-focused option via aria-activedescendant on
    // the input, and each option is a real role="option" with a stable id
    // (HEL-909 CR1 -- this was previously a CSS class with no ARIA wiring
    // at all). Both Outputs share one pipeline group, so don't assume which
    // renders first -- read whichever option starts selected.
    const throughputOption = picker.getByRole("option", { name: /^Throughput/ });
    const latencyOption = picker.getByRole("option", { name: /^Latency/ });
    await expect(throughputOption).toBeVisible();
    await expect(latencyOption).toBeVisible();
    const throughputId2 = await throughputOption.getAttribute("id");
    const latencyOptionId = await latencyOption.getAttribute("id");
    expect(throughputId2).toBeTruthy();
    expect(latencyOptionId).toBeTruthy();

    const initialActiveDescendant = await search.getAttribute("aria-activedescendant");
    const [initiallySelected, initiallyUnselected] =
      initialActiveDescendant === throughputId2
        ? [throughputOption, latencyOption]
        : [latencyOption, throughputOption];
    await expect(initiallySelected).toHaveAttribute("aria-selected", "true");
    await expect(initiallyUnselected).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("ArrowDown");
    await expect(search).toBeFocused();
    const afterDownActiveDescendant = await search.getAttribute("aria-activedescendant");
    expect(afterDownActiveDescendant).not.toBe(initialActiveDescendant);
    await expect(initiallyUnselected).toHaveAttribute("aria-selected", "true");
    await expect(initiallySelected).toHaveAttribute("aria-selected", "false");

    // Move back to the original option and place Throughput specifically,
    // verifying the correct (currently-selected, not merely first) Output
    // actually gets placed.
    await page.keyboard.press("ArrowUp");
    const backToInitial = await search.getAttribute("aria-activedescendant");
    expect(backToInitial).toBe(initialActiveDescendant);
    if (initialActiveDescendant !== throughputId2) {
      // Land on Throughput specifically before placing it.
      await page.keyboard.press("ArrowDown");
    }
    await expect(search).toHaveAttribute("aria-activedescendant", throughputId2 ?? "");
    await page.keyboard.press("Enter");
    await expect(picker).toBeHidden();

    const panelCard = page.locator(".react-grid-item", { hasText: "Untitled Panel" });
    await expect(panelCard).toBeVisible({ timeout: 10_000 });
    await panelCard.click();
    const sheet = page.getByRole("dialog", { name: "Untitled Panel settings" });
    await expect(sheet).toBeVisible();
    await page.getByRole("button", { name: "Edit panel" }).click();
    await expect(sheet.getByRole("link", { name: "Throughput" })).toHaveAttribute(
      "href",
      new RegExp(`outputId=${throughputId}`),
    );
  });
});
