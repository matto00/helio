import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// HEL-572 — live-browser verification of the click→selection→inspect
// interaction: tasks.md 4.3 (Inspect nested inside Fullscreen; Escape closes
// only the topmost native dialog) and 5.2 (keyboard-only ActionsMenu
// "Inspect" entry opens the view with focus landing inside it). Unit/
// component coverage for the click→column mapping, row filtering, and
// Redux clearing lives in chartClickSelection.test.ts / panelsSlice.test.ts
// / PanelInspectView.test.tsx / PanelCard.inspect.test.tsx / ChartPanel.
// click.test.tsx — this spec is deliberately narrow to what only a real
// browser (real ECharts canvas hit-testing, real native <dialog> stacking)
// can prove.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel572-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-572 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Seeds a dashboard with one PIE-kind chart panel (region/revenue, two
 *  categories) — a pie is used deliberately (not bar/line) because its
 *  slices fill most of the rendered canvas from the center outward, which
 *  is what makes a REAL canvas click reliable without knowing ECharts'
 *  exact bar-geometry pixel layout ahead of time (see the click helper
 *  below). Returns the panel's title (the stable handle every locator in
 *  this file keys off of) for assertions. */
async function seedChartPanel(
  page: Page,
  request: APIRequestContext,
  panelTitle: string,
  /** HEL-1178 regression probe (tasks.md 6.5) — `false` leaves the panel's
   *  `appearance.chart` entirely unset (the actual bug scenario: click
   *  wiring/cursor must not live in the appearance-conditional half of the
   *  option or it silently never engages). Defaults `true` for the other
   *  tests in this file, which need a reliably-clickable pie geometry. */
  setPieAppearance = true,
) {
  const dashboardRes = await request.post("/api/dashboards", {
    data: { name: `HEL-572 ${panelTitle}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(dashboardRes.status()).toBe(201);
  const dashboard = (await dashboardRes.json()) as { id: string };

  const sourceRes = await request.post("/api/data-sources", {
    data: {
      name: `HEL-572 ${panelTitle} Source`,
      type: "static",
      columns: [
        { name: "region", type: "string", required: true },
        { name: "revenue", type: "integer", required: true },
      ],
      rows: [
        ["East", 100],
        ["West", 150],
      ],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(sourceRes.status()).toBe(201);
  const source = (await sourceRes.json()) as { id: string };

  const pipelineRes = await request.post("/api/pipelines", {
    data: { name: `HEL-572 ${panelTitle} Pipeline`, roots: [{ sourceId: source.id }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(pipelineRes.status()).toBe(201);
  const pipeline = (await pipelineRes.json()) as { id: string };

  const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: {
      kind: "chart",
      name: `HEL-572 ${panelTitle} Output`,
      config: { chartType: "pie", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(outputRes.status()).toBe(201);
  const output = (await outputRes.json()) as { id: string };

  const runRes = await request.post(`/api/pipelines/${pipeline.id}/run`, {
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(runRes.status()).toBe(200);
  let rowCount = 0;
  for (let attempt = 0; attempt < 40 && rowCount === 0; attempt++) {
    const rowsRes = await request.get(`/api/outputs/${output.id}/rows`);
    if (rowsRes.status() === 200) {
      const body = (await rowsRes.json()) as { items?: unknown[] };
      rowCount = body.items?.length ?? 0;
    }
    if (rowCount === 0) await new Promise((r) => setTimeout(r, 250));
  }
  expect(rowCount, "the manual run must materialize the chart Output's rows").toBe(2);

  const panelRes = await request.post("/api/panels", {
    data: {
      dashboardId: dashboard.id,
      title: panelTitle,
      type: "output",
      config: { outputId: output.id },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(panelRes.status()).toBe(201);
  const panel = (await panelRes.json()) as { id: string };

  // Root-cause note (systematic-debugging.md probe): the Output's OWN
  // `config.chartType` (set above) is NEVER read for rendering — only the
  // PANEL's `appearance.chart.chartType` is (`ChartPanel.tsx`, defaulting
  // to "line" when unset). Every pre-HEL-572 e2e spec creating a chart
  // panel leaves `appearance.chart` unset and gets the default line
  // render, which this spec's own first red run (clicking blank canvas
  // space above a line chart, landing outside any series element, which
  // correctly did NOT stop propagation and correctly fell through to
  // Customize) made newly load-bearing to get right — a pie chart's slices
  // fill most of the canvas from the center outward, which is what makes a
  // blind coordinate click reliable at all.
  if (setPieAppearance) {
    const patchRes = await request.patch(`/api/panels/${panel.id}`, {
      data: {
        appearance: {
          background: "transparent",
          color: "inherit",
          transparency: 0,
          chart: {
            seriesColors: [],
            legend: { show: true, position: "top" },
            tooltip: { enabled: true },
            axisLabels: { x: { show: true }, y: { show: true } },
            chartType: "pie",
          },
        },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(patchRes.status()).toBe(200);
  }

  // A larger-than-default box so the pie renders with a comfortable radius
  // — see the click helper's own comment for why size matters here.
  const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
    data: { items: [{ panelId: panel.id, w: 5, h: 5 }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(layoutRes.status()).toBe(200);
}

/** Clicks a point inside the rendered pie's filled area, straight up from
 *  its own bounding box's center by 20% of the box's smaller dimension —
 *  comfortably inside ECharts' default ~75%-radius pie for any panel this
 *  spec sizes (5x5 grid units), without depending on knowing its exact
 *  rendered geometry (the center point itself sits on every slice's
 *  boundary at r=0 and is not a safe target).
 *
 *  Takes an explicit `container` (the grid card OR the fullscreen overlay)
 *  rather than a heading-based union locator — `PanelFullscreenOverlay` is
 *  rendered as a DOM CHILD of the grid `.panel-grid-card` article (not a
 *  portal), so a loosely-scoped locator can resolve to the wrong one of the
 *  two live chart canvases (the grid's own, visually behind the fullscreen
 *  overlay but still a real element with its own page coordinates) — this
 *  was probe-confirmed as the root cause of this spec's first red run
 *  (clicking the grid card's canvas coordinates while Fullscreen was open
 *  landed on the grid card's own `<article onClick>` instead, opening
 *  Customize/`PanelDetailModal`, not Inspect). */
async function clickPieChart(container: Locator, page: Page) {
  const canvas = container.locator(".chart-panel__canvas canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("chart canvas has no bounding box");
  const offset = Math.min(box.width, box.height) * 0.2;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - offset);
}

test.describe("HEL-572 chart click drilldown (real backend, real browser)", () => {
  test.setTimeout(120_000);

  test("keyboard-only: ActionsMenu Inspect opens the view with focus inside it (tasks.md 5.2)", async ({
    page,
    request,
  }) => {
    const title = "Keyboard Inspect Panel";
    await registerAndLogin(page, request, "keyboard");
    await seedChartPanel(page, request, title);
    await page.goto("/");

    const card = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: title }) });
    await expect(card).toBeVisible();
    await expect(card.locator(".chart-panel__canvas canvas")).toBeVisible();

    const trigger = card.getByRole("button", { name: `${title} panel actions` });
    await trigger.focus();
    await page.keyboard.press("Enter");

    const inspectItem = page.getByRole("menuitem", { name: "Inspect" });
    await expect(inspectItem).toBeVisible();
    await inspectItem.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: `Inspect ${title}` });
    await expect(dialog).toBeVisible();
    // spec.md "Keyboard user opens Inspect via the actions menu" — the view
    // opens showing an empty state, since no chart element was clicked in
    // this keyboard-only flow.
    await expect(dialog.getByText("Nothing selected")).toBeVisible();

    // design.md D5 / tasks.md 5.2 — focus lands inside the opened dialog
    // (Modal's existing native showModal() focus behavior, no new focus
    // logic this ticket added).
    const focusInsideDialog = await page.evaluate(() => {
      const active = document.activeElement;
      const dlg = document.querySelector('dialog[aria-label^="Inspect "]');
      return !!dlg && !!active && dlg.contains(active);
    });
    expect(focusInsideDialog).toBe(true);
  });

  test("clicking inside Fullscreen opens Inspect nested on top; Escape closes only Inspect (tasks.md 4.3)", async ({
    page,
    request,
  }) => {
    const title = "Fullscreen Stacking Panel";
    await registerAndLogin(page, request, "stacking");
    await seedChartPanel(page, request, title);
    await page.goto("/");

    const card = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: title }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `Fullscreen ${title}` }).click();

    const fullscreenDialog = page.getByRole("dialog", { name: `${title} fullscreen` });
    await expect(fullscreenDialog).toBeVisible();

    await clickPieChart(fullscreenDialog, page);

    const inspectDialog = page.getByRole("dialog", { name: `Inspect ${title}` });
    await expect(inspectDialog).toBeVisible();
    await expect(inspectDialog.getByText(/^Showing rows for region: /)).toBeVisible();

    // Both dialogs are real native <dialog>s — exactly two open at once.
    await expect(page.locator("dialog[open]")).toHaveCount(2);

    await page.keyboard.press("Escape");

    // Escape closed only the topmost (Inspect); Fullscreen is still open.
    await expect(inspectDialog).toBeHidden();
    await expect(fullscreenDialog).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(1);
  });

  // design.md D6 / tasks.md 6.5 — the HEL-1178 hazard: click wiring/cursor
  // must not live in the appearance-conditional half of the option or it
  // silently doesn't engage for a chart panel with no stored
  // `appearance.chart`. `ChartPanel.click.test.tsx` already covers the
  // cursor option itself directly (no rendering/coordinate-guessing
  // needed for that); this live check covers the part only a real render
  // proves: the ActionsMenu "Inspect" entry (gated on `chartInspectConfig`,
  // which is driven by the Output's `kind`, NOT by `appearance.chart`) still
  // appears and opens correctly.
  test("ActionsMenu Inspect entry still works with NO stored appearance.chart (tasks.md 6.5, HEL-1178)", async ({
    page,
    request,
  }) => {
    const title = "No Appearance Panel";
    await registerAndLogin(page, request, "noappearance");
    await seedChartPanel(page, request, title, /* setPieAppearance */ false);
    await page.goto("/");

    const card = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: title }) });
    await expect(card).toBeVisible();
    await expect(card.locator(".chart-panel__canvas canvas")).toBeVisible();

    await card.getByRole("button", { name: `${title} panel actions` }).click();
    const inspectItem = page.getByRole("menuitem", { name: "Inspect" });
    await expect(inspectItem).toBeVisible();
    await inspectItem.click();

    const dialog = page.getByRole("dialog", { name: `Inspect ${title}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Nothing selected")).toBeVisible();
  });
});
