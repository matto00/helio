import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

// HEL-588 — live-browser verification of dashboard-scoped cross-filtering,
// specifically the Table-kind narrowing defect evaluation-1.md CR1/CR2
// found and required a live re-check for: a Table-kind sibling panel's
// truncation disclosure narrowed correctly while its ACTUALLY-RENDERED grid
// (driven by `paginationRows`, a code path this suite's mocked unit tests
// never exercised) did not. This spec seeds real data via the app's own
// APIs (mirroring hel572-chart-click-drilldown.spec.ts's established
// pattern) and drives the interaction through a real browser/canvas click,
// so it proves what a mocked `usePanelData` test structurally cannot.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel588-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-588 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

interface SeededDashboard {
  chartPanelTitle: string;
  tablePanelTitle: string;
  unrelatedPanelTitle: string;
}

/** Seeds one dashboard with three Output panels sharing a data source
 *  (region/revenue, 2 regions x 2 rows each): a pie CHART panel (clickable,
 *  mirrors hel572's own established click-reliability rationale for pie
 *  over bar/line), a TABLE panel bound to the SAME `region` column via
 *  `columnOrder` (the panel kind evaluation-1.md found broken live), and a
 *  Collection panel whose field mapping does NOT reference `region` (the
 *  "one that doesn't share the column" control). */
async function seedDashboard(page: Page, request: APIRequestContext): Promise<SeededDashboard> {
  const dashboardRes = await request.post("/api/dashboards", {
    data: { name: "HEL-588 cross-filter" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(dashboardRes.status()).toBe(201);
  const dashboard = (await dashboardRes.json()) as { id: string };

  const sourceRes = await request.post("/api/data-sources", {
    data: {
      name: "HEL-588 Source",
      type: "static",
      columns: [
        { name: "region", type: "string", required: true },
        { name: "revenue", type: "integer", required: true },
      ],
      rows: [
        ["East", 100],
        ["East", 120],
        ["West", 150],
        ["West", 90],
      ],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(sourceRes.status()).toBe(201);
  const source = (await sourceRes.json()) as { id: string };

  const pipelineRes = await request.post("/api/pipelines", {
    data: { name: "HEL-588 Pipeline", roots: [{ sourceId: source.id }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(pipelineRes.status()).toBe(201);
  const pipeline = (await pipelineRes.json()) as { id: string };

  const chartOutputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: {
      kind: "chart",
      name: "HEL-588 Chart Output",
      config: { chartType: "pie", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(chartOutputRes.status()).toBe(201);
  const chartOutput = (await chartOutputRes.json()) as { id: string };

  const tableOutputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: {
      kind: "table",
      name: "HEL-588 Table Output",
      config: { fieldMapping: {}, columnOrder: ["region", "revenue"] },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(tableOutputRes.status()).toBe(201);
  const tableOutput = (await tableOutputRes.json()) as { id: string };

  const collectionOutputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: {
      kind: "collection",
      name: "HEL-588 Collection Output",
      // Deliberately maps only `revenue` — never `region` — so this panel is
      // the "field mapping doesn't reference the filter's dimension" control.
      config: { fieldMapping: { value: "revenue" }, layout: "list" },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(collectionOutputRes.status()).toBe(201);
  const collectionOutput = (await collectionOutputRes.json()) as { id: string };

  const runRes = await request.post(`/api/pipelines/${pipeline.id}/run`, {
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(runRes.status()).toBe(200);

  for (const outputId of [chartOutput.id, tableOutput.id, collectionOutput.id]) {
    let rowCount = 0;
    for (let attempt = 0; attempt < 40 && rowCount === 0; attempt++) {
      const rowsRes = await request.get(`/api/outputs/${outputId}/rows`);
      if (rowsRes.status() === 200) {
        const body = (await rowsRes.json()) as { items?: unknown[] };
        rowCount = body.items?.length ?? 0;
      }
      if (rowCount === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(rowCount, `output ${outputId} must materialize rows`).toBe(4);
  }

  const chartPanelTitle = "HEL-588 Chart Panel";
  const tablePanelTitle = "HEL-588 Table Panel";
  const unrelatedPanelTitle = "HEL-588 Unrelated Panel";

  const chartPanelRes = await request.post("/api/panels", {
    data: {
      dashboardId: dashboard.id,
      title: chartPanelTitle,
      type: "output",
      config: { outputId: chartOutput.id },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(chartPanelRes.status()).toBe(201);
  const chartPanel = (await chartPanelRes.json()) as { id: string };

  // pie appearance — same rationale/geometry as hel572's own helper: a pie's
  // slices fill most of the canvas from the center outward, which is what
  // makes a blind coordinate click reliable.
  const chartPatchRes = await request.patch(`/api/panels/${chartPanel.id}`, {
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
  expect(chartPatchRes.status()).toBe(200);

  const tablePanelRes = await request.post("/api/panels", {
    data: {
      dashboardId: dashboard.id,
      title: tablePanelTitle,
      type: "output",
      config: { outputId: tableOutput.id },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(tablePanelRes.status()).toBe(201);
  const tablePanel = (await tablePanelRes.json()) as { id: string };

  const unrelatedPanelRes = await request.post("/api/panels", {
    data: {
      dashboardId: dashboard.id,
      title: unrelatedPanelTitle,
      type: "output",
      config: { outputId: collectionOutput.id },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(unrelatedPanelRes.status()).toBe(201);
  const unrelatedPanel = (await unrelatedPanelRes.json()) as { id: string };

  const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
    data: {
      items: [
        { panelId: chartPanel.id, w: 5, h: 5 },
        { panelId: tablePanel.id, w: 5, h: 5 },
        { panelId: unrelatedPanel.id, w: 5, h: 5 },
      ],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(layoutRes.status()).toBe(200);

  return { chartPanelTitle, tablePanelTitle, unrelatedPanelTitle };
}

/** Same click-reliability rationale as hel572-chart-click-drilldown.spec.ts's
 *  own `clickPieChart` helper — a point 20% of the smaller box dimension
 *  above the canvas center, comfortably inside ECharts' default pie radius. */
async function clickPieChart(container: Locator, page: Page) {
  const canvas = container.locator(".chart-panel__canvas canvas").first();
  await expect(canvas).toBeVisible();
  // ECharts' default pie entrance animation (~1000ms, slices grow from the
  // center outward) means the canvas element can be visible in the DOM well
  // before the pie has actually grown into the region a fixed pixel offset
  // targets — probe-confirmed root cause of this spec's own first red run on
  // the "CR3" test (clicked immediately after `page.goto`, with no other
  // awaited assertion giving the animation time to settle; the CR1/CR2 test
  // passed first try only because several prior `expect(...).toBeVisible()`
  // checks incidentally consumed enough wall-clock time). hel572-chart-
  // click-drilldown.spec.ts's own passing helper has this same latent
  // assumption; making it explicit here rather than relying on incidental
  // timing.
  await page.waitForTimeout(1200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("chart canvas has no bounding box");
  const offset = Math.min(box.width, box.height) * 0.2;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - offset);
}

test.describe("HEL-588 cross-filter panels (real backend, real browser)", () => {
  test.setTimeout(120_000);

  test("filtering by a chart selection narrows a Table-kind sibling panel's ACTUAL rendered rows (evaluation-1.md CR1/CR2)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "table-narrow");
    const { chartPanelTitle, tablePanelTitle, unrelatedPanelTitle } = await seedDashboard(
      page,
      request,
    );
    await page.goto("/");

    const chartCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: chartPanelTitle }) });
    const tableCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: tablePanelTitle }) });
    const unrelatedCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: unrelatedPanelTitle }) });
    await expect(chartCard).toBeVisible();
    await expect(tableCard).toBeVisible();
    await expect(unrelatedCard).toBeVisible();

    // Before any filter: the table shows all 4 rows (2 East, 2 West).
    await expect(tableCard.getByRole("table")).toBeVisible();
    await expect(tableCard.getByRole("cell", { name: "East", exact: true })).toHaveCount(2);
    await expect(tableCard.getByRole("cell", { name: "West", exact: true })).toHaveCount(2);

    await clickPieChart(chartCard, page);
    const inspectDialog = page.getByRole("dialog", { name: `Inspect ${chartPanelTitle}` });
    await expect(inspectDialog).toBeVisible();
    await expect(inspectDialog.getByText(/^Showing rows for region: /)).toBeVisible();

    const filterButton = inspectDialog.getByRole("button", {
      name: /^Filter dashboard by region = /,
    });
    await expect(filterButton).toBeVisible();
    // Whichever region the pixel-scan click happened to land a slice on —
    // read it back from the button's own label so this assertion works
    // regardless of which of the two slices got hit.
    const filterButtonText = (await filterButton.textContent()) ?? "";
    const matchedRegion = filterButtonText.includes("East") ? "East" : "West";
    const otherRegion = matchedRegion === "East" ? "West" : "East";
    await filterButton.click();

    await expect(inspectDialog).toBeHidden();

    const indicator = page.getByRole("status").filter({ hasText: "Filtered by region" });
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText(`Filtered by region = ${matchedRegion}`);

    // THE regression this spec exists to prove: the Table panel's ACTUAL
    // rendered grid narrows to exactly the 2 matching-region rows — not just
    // its truncation disclosure (evaluation-1.md Phase 3's exact defect).
    await expect(tableCard.getByRole("cell", { name: matchedRegion, exact: true })).toHaveCount(2);
    await expect(tableCard.getByRole("cell", { name: otherRegion, exact: true })).toHaveCount(0);

    // The unrelated Collection panel (fieldMapping never references `region`)
    // is unaffected throughout.
    await expect(unrelatedCard.getByText("100", { exact: true })).toBeVisible();
    await expect(unrelatedCard.getByText("150", { exact: true })).toBeVisible();

    await page.screenshot({
      path: ".concertino/runs/HEL-588/evidence/table-narrowed-after-filter.png",
    });

    // Clear-all restores every panel to unfiltered.
    await indicator.getByRole("button", { name: "Clear cross-filter" }).click();
    await expect(indicator).toBeHidden();
    await expect(tableCard.getByRole("cell", { name: "East", exact: true })).toHaveCount(2);
    await expect(tableCard.getByRole("cell", { name: "West", exact: true })).toHaveCount(2);

    await page.screenshot({
      path: ".concertino/runs/HEL-588/evidence/after-clear-filter-cr2.png",
    });
  });

  // evaluation-1.md CR3 — the breakpoint sweep + light/dark toggle-without-
  // navigating the prior evaluation ran out of time to reach.
  test("CrossFilterIndicator renders correctly across breakpoints and both themes (evaluation-1.md CR3)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "cr3-sweep");
    const { chartPanelTitle, tablePanelTitle } = await seedDashboard(page, request);
    // Deliberately at the DEFAULT test viewport for the click itself (matches
    // the CR1/CR2 spec above, whose pie-slice click is proven reliable there)
    // — the breakpoint sweep below only needs to resize AFTER the filter is
    // already active, since it's checking the INDICATOR's layout, not the
    // click geometry.
    await page.goto("/");

    const chartCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: chartPanelTitle }) });
    await clickPieChart(chartCard, page);
    const inspectDialog = page.getByRole("dialog", { name: `Inspect ${chartPanelTitle}` });
    await expect(inspectDialog).toBeVisible();
    await inspectDialog.getByRole("button", { name: /^Filter dashboard by region = / }).click();

    const indicator = page.getByRole("status").filter({ hasText: "Filtered by region" });
    await expect(indicator).toBeVisible();

    // Breakpoint sweep: DESIGN.md §4's canonical set (1440/1100/768/430).
    // The indicator must stay visible, legible, and non-overlapping with the
    // panel grid at every width — asserted via bounding-box containment
    // (never fully off-screen / zero-size) rather than a pixel diff.
    for (const width of [1440, 1100, 768, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(indicator).toBeVisible();
      const box = await indicator.boundingBox();
      expect(box, `indicator must have a real bounding box at width=${width}`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: `.concertino/runs/HEL-588/evidence/cr3-breakpoint-${width}-dark.png`,
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });

    // Light/dark toggle WITHOUT navigating away (DESIGN.md's visual-cohesion
    // gate) — via the app's own command-palette toggle, the same real
    // affordance a user would use, not a direct DOM attribute write (see
    // hel516-screenshots.spec.ts's identical rationale).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect
      .poll(
        async () => {
          await page.keyboard.press("Control+k");
          return page.locator(".command-palette[open]").count();
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    await page.fill('input[aria-label="Search commands"]', "light theme");
    await page.getByRole("option", { name: "Switch to light theme" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    // Toggling theme must not have navigated away or torn down the filter.
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText("Filtered by region");

    const tableCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: tablePanelTitle }) });
    await expect(tableCard.getByRole("table")).toBeVisible();

    await page.screenshot({
      path: ".concertino/runs/HEL-588/evidence/cr3-light-theme.png",
    });
  });

  // tasks.md 7.1 — a sibling with > 200 rows, exercising the D7 truncation
  // disclosure ALONGSIDE the actual grid narrowing (evaluation-1.md Phase 3's
  // exact scenario: a Table panel's disclosure correctly said "50 of 200
  // loaded rows match" while its grid stayed unfiltered — this test proves
  // the two now agree).
  test("a cross-filtered Table panel's truncation disclosure matches its actually-rendered rows when > 200 rows are loaded", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "truncation");

    const dashboardRes = await request.post("/api/dashboards", {
      data: { name: "HEL-588 truncation" },
      headers: { [CSRF_HEADER]: "1" },
    });
    const dashboard = (await dashboardRes.json()) as { id: string };

    // 150 East rows followed by 60 West rows (210 total) — usePanelData's
    // page-0 fetch (200 rows) loads all 150 East rows plus the first 50 of
    // the 60 West rows, leaving `hasMore: true` (10 West rows unloaded).
    const rows: [string, number][] = [];
    for (let i = 0; i < 150; i++) rows.push(["East", 100 + i]);
    for (let i = 0; i < 60; i++) rows.push(["West", 500 + i]);

    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-588 Truncation Source",
        type: "static",
        columns: [
          { name: "region", type: "string", required: true },
          { name: "revenue", type: "integer", required: true },
        ],
        rows,
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const source = (await sourceRes.json()) as { id: string };
    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-588 Truncation Pipeline", roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    const pipeline = (await pipelineRes.json()) as { id: string };

    const chartOutputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: {
        kind: "chart",
        name: "HEL-588 Truncation Chart",
        config: { chartType: "pie", fieldMapping: { xAxis: "region", yAxis: "revenue" } },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const chartOutput = (await chartOutputRes.json()) as { id: string };
    const tableOutputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: {
        kind: "table",
        name: "HEL-588 Truncation Table",
        config: { fieldMapping: {}, columnOrder: ["region", "revenue"] },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const tableOutput = (await tableOutputRes.json()) as { id: string };

    await request.post(`/api/pipelines/${pipeline.id}/run`, { headers: { [CSRF_HEADER]: "1" } });
    for (const outputId of [chartOutput.id, tableOutput.id]) {
      let rowCount = 0;
      for (let attempt = 0; attempt < 40 && rowCount === 0; attempt++) {
        const rowsRes = await request.get(`/api/outputs/${outputId}/rows`);
        if (rowsRes.status() === 200) {
          const body = (await rowsRes.json()) as { items?: unknown[] };
          rowCount = body.items?.length ?? 0;
        }
        if (rowCount === 0) await new Promise((r) => setTimeout(r, 250));
      }
      expect(rowCount, `output ${outputId} must materialize rows`).toBeGreaterThan(0);
    }

    const chartPanelTitle = "HEL-588 Truncation Chart Panel";
    const tablePanelTitle = "HEL-588 Truncation Table Panel";
    const chartPanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: chartPanelTitle,
        type: "output",
        config: { outputId: chartOutput.id },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const chartPanel = (await chartPanelRes.json()) as { id: string };
    await request.patch(`/api/panels/${chartPanel.id}`, {
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
    const tablePanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: tablePanelTitle,
        type: "output",
        config: { outputId: tableOutput.id },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const tablePanel = (await tablePanelRes.json()) as { id: string };
    await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
      data: {
        items: [
          { panelId: chartPanel.id, w: 5, h: 5 },
          { panelId: tablePanel.id, w: 5, h: 5 },
        ],
      },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/");

    const chartCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: chartPanelTitle }) });
    const tableCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: tablePanelTitle }) });
    await expect(chartCard).toBeVisible();
    await expect(tableCard).toBeVisible();

    await clickPieChart(chartCard, page);
    const inspectDialog = page.getByRole("dialog", { name: `Inspect ${chartPanelTitle}` });
    await expect(inspectDialog).toBeVisible();
    const filterButton = inspectDialog.getByRole("button", {
      name: /^Filter dashboard by region = /,
    });
    const filterButtonText = (await filterButton.textContent()) ?? "";
    // Only "East" is reliably reachable by a pixel-scan click here (150
    // rows dominate the pie); assert the click landed on it rather than
    // guessing — if it didn't, this test's own setup assumption is wrong,
    // not the feature under test.
    expect(filterButtonText).toContain("East");
    await filterButton.click();

    // The grid's own rendered row count and the disclosure's stated
    // `matchCount` must agree: 150 East rows are ALL within the loaded
    // 200-row page (rows 0-149), so the grid shows all 150 and the
    // disclosure reads "150 of 200 loaded rows match."
    await expect(tableCard.getByRole("cell", { name: "East", exact: true })).toHaveCount(150);
    await expect(tableCard.getByRole("cell", { name: "West", exact: true })).toHaveCount(0);
    await expect(tableCard).toContainText("150 of 200 loaded rows match.");

    await page.screenshot({
      path: ".concertino/runs/HEL-588/evidence/truncation-disclosure-matches-grid.png",
    });

    // skeptic-final-1.md CR1/CR3 — the Fullscreen overlay's disclosure for
    // the SAME panel/filter state must agree with the grid card's: "150 of
    // 200 loaded rows match.", never "150 of 150" (the bug: `PanelCard` was
    // passing the ALREADY cross-filtered rows into `PanelFullscreenOverlay`,
    // corrupting the denominator down to the post-filter match count).
    await tableCard.getByRole("button", { name: `Fullscreen ${tablePanelTitle}` }).click();
    const fullscreenDialog = page.getByRole("dialog", { name: `${tablePanelTitle} fullscreen` });
    await expect(fullscreenDialog).toBeVisible();
    await expect(fullscreenDialog.getByRole("cell", { name: "East", exact: true })).toHaveCount(
      150,
    );
    await expect(fullscreenDialog.getByRole("cell", { name: "West", exact: true })).toHaveCount(0);
    await expect(fullscreenDialog).toContainText("150 of 200 loaded rows match.");
    await expect(fullscreenDialog).not.toContainText("150 of 150 loaded rows match.");

    await page.screenshot({
      path: ".concertino/runs/HEL-588/evidence/fullscreen-truncation-disclosure-matches-grid.png",
    });
  });

  // evaluation-3.md CR1/CR2/CR3 — grid-context and Fullscreen-nested Inspect
  // must show the SAME row content for the identical click selection while a
  // cross-filter is active. Uses a DIMENSION-MISMATCH panel (plotted by
  // "region", filterable by "quarter" via an unrelated fieldMapping slot) —
  // evaluation-3.md's own repro rationale: a same-dimension panel (like the
  // CR1/CR2 test above) masks this exact bug, since the cross-filter's own
  // narrowing and the click-selection's narrowing would coincide either way.
  test("grid and Fullscreen Inspect agree on row content for a dimension-mismatch panel under an active cross-filter (evaluation-3.md CR1-CR3)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "dim-mismatch");

    const dashboardRes = await request.post("/api/dashboards", {
      data: { name: "HEL-588 dimension mismatch" },
      headers: { [CSRF_HEADER]: "1" },
    });
    const dashboard = (await dashboardRes.json()) as { id: string };

    // Panel A's own source: quarter-only, 2 rows — a clean 2-slice pie so a
    // pixel-scan click reliably lands on ONE of exactly two quarters (read
    // back from the resulting Inspect text, never assumed).
    const quarterSourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-588 Quarter Source",
        type: "static",
        columns: [
          { name: "quarter", type: "string", required: true },
          { name: "revenue", type: "integer", required: true },
        ],
        rows: [
          ["Q1", 1000],
          ["Q2", 2000],
        ],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const quarterSource = (await quarterSourceRes.json()) as { id: string };
    const quarterPipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-588 Quarter Pipeline", roots: [{ sourceId: quarterSource.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    const quarterPipeline = (await quarterPipelineRes.json()) as { id: string };
    const quarterOutputRes = await request.post(`/api/pipelines/${quarterPipeline.id}/outputs`, {
      data: {
        kind: "chart",
        name: "HEL-588 Quarter Output",
        config: { chartType: "pie", fieldMapping: { xAxis: "quarter", yAxis: "revenue" } },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const quarterOutput = (await quarterOutputRes.json()) as { id: string };
    await request.post(`/api/pipelines/${quarterPipeline.id}/run`, {
      headers: { [CSRF_HEADER]: "1" },
    });

    // Panel B's own source: region x quarter (2x2 = 4 rows, one per
    // combination), plotted by "region" but ALSO filterable by "quarter" via
    // the "annotation" fieldMapping slot — the dimension mismatch.
    const regionQuarterRows: [string, number, string][] = [
      ["East", 100, "Q1"],
      ["West", 105, "Q1"],
      ["East", 200, "Q2"],
      ["West", 205, "Q2"],
    ];
    const regionSourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-588 Region Source",
        type: "static",
        columns: [
          { name: "region", type: "string", required: true },
          { name: "revenue", type: "integer", required: true },
          { name: "quarter", type: "string", required: true },
        ],
        rows: regionQuarterRows,
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const regionSource = (await regionSourceRes.json()) as { id: string };
    const regionPipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-588 Region Pipeline", roots: [{ sourceId: regionSource.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    const regionPipeline = (await regionPipelineRes.json()) as { id: string };
    const regionOutputRes = await request.post(`/api/pipelines/${regionPipeline.id}/outputs`, {
      data: {
        kind: "chart",
        name: "HEL-588 Region Output",
        config: {
          chartType: "pie",
          fieldMapping: { xAxis: "region", yAxis: "revenue", annotation: "quarter" },
        },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const regionOutput = (await regionOutputRes.json()) as { id: string };
    await request.post(`/api/pipelines/${regionPipeline.id}/run`, {
      headers: { [CSRF_HEADER]: "1" },
    });

    for (const outputId of [quarterOutput.id, regionOutput.id]) {
      let rowCount = 0;
      for (let attempt = 0; attempt < 40 && rowCount === 0; attempt++) {
        const rowsRes = await request.get(`/api/outputs/${outputId}/rows`);
        if (rowsRes.status() === 200) {
          const body = (await rowsRes.json()) as { items?: unknown[] };
          rowCount = body.items?.length ?? 0;
        }
        if (rowCount === 0) await new Promise((r) => setTimeout(r, 250));
      }
      expect(rowCount, `output ${outputId} must materialize rows`).toBeGreaterThan(0);
    }

    const quarterPanelTitle = "HEL-588 Quarter Panel";
    const regionPanelTitle = "HEL-588 Region Panel";
    const quarterPanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: quarterPanelTitle,
        type: "output",
        config: { outputId: quarterOutput.id },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const quarterPanel = (await quarterPanelRes.json()) as { id: string };
    const regionPanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: regionPanelTitle,
        type: "output",
        config: { outputId: regionOutput.id },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    const regionPanel = (await regionPanelRes.json()) as { id: string };

    // hel572-chart-click-drilldown.spec.ts's own root-cause note (repeated
    // here after re-discovering it live): the OUTPUT's own `config.chartType`
    // is NEVER read for rendering — only the PANEL's `appearance.chart
    // .chartType` is. Both panels need this PATCH or they render as the
    // default line chart, which `clickPieChart`'s pixel-scan cannot reliably
    // hit (probe-confirmed: omitting this made the first run of this test
    // click blank canvas space and fall through to the Customize dialog).
    const pieAppearance = {
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
    };
    await request.patch(`/api/panels/${quarterPanel.id}`, {
      data: { appearance: pieAppearance },
      headers: { [CSRF_HEADER]: "1" },
    });
    await request.patch(`/api/panels/${regionPanel.id}`, {
      data: { appearance: pieAppearance },
      headers: { [CSRF_HEADER]: "1" },
    });

    await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
      data: {
        items: [
          { panelId: quarterPanel.id, w: 5, h: 5 },
          { panelId: regionPanel.id, w: 5, h: 5 },
        ],
      },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/");

    // Step 1 — click Panel A's pie, open Inspect, set the cross-filter from
    // WHICHEVER quarter the pixel-scan actually landed on (never assumed).
    const quarterCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: quarterPanelTitle }) });
    await clickPieChart(quarterCard, page);
    const quarterInspect = page.getByRole("dialog", { name: `Inspect ${quarterPanelTitle}` });
    await expect(quarterInspect).toBeVisible();
    const quarterFilterButton = quarterInspect.getByRole("button", {
      name: /^Filter dashboard by quarter = /,
    });
    const quarterFilterText = (await quarterFilterButton.textContent()) ?? "";
    const activeQuarter = quarterFilterText.includes("Q1") ? "Q1" : "Q2";
    await quarterFilterButton.click();
    await expect(quarterInspect).toBeHidden();

    const indicator = page.getByRole("status").filter({ hasText: "Filtered by quarter" });
    await expect(indicator).toContainText(`Filtered by quarter = ${activeQuarter}`);

    // Step 2 — click Panel B's (dimension-mismatch) pie, open its
    // grid-context Inspect, and record which region got clicked plus the
    // exact row content shown.
    const regionCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: regionPanelTitle }) });
    await clickPieChart(regionCard, page);
    const gridInspect = page.getByRole("dialog", { name: `Inspect ${regionPanelTitle}` });
    await expect(gridInspect).toBeVisible();
    await expect(gridInspect.getByText(/^Showing rows for region: /)).toBeVisible();
    const gridInspectText =
      (await gridInspect.getByText(/^Showing rows for region: /).textContent()) ?? "";
    const clickedRegion = gridInspectText.includes("East") ? "East" : "West";

    // Correct behavior: with the active cross-filter narrowing Panel B to
    // ONE quarter, clicking one region shows EXACTLY 1 row (that
    // region+quarter's own revenue) — never both quarters' rows for that
    // region.
    const gridTable = gridInspect.getByRole("table");
    await expect(gridTable).toHaveAttribute("aria-rowcount", "2"); // 1 header + 1 data row
    const expectedRevenue = regionQuarterRows.find(
      ([region, , quarter]) => region === clickedRegion && quarter === activeQuarter,
    )?.[1];
    await expect(gridInspect).toContainText(String(expectedRevenue));

    // Dismiss via Escape (selection survives, per spec.md) — a real browser's
    // native <dialog> backdrop otherwise intercepts every subsequent click
    // (unlike the jsdom unit test's own trivial showModal()/close() stub,
    // which enforces no such backdrop).
    await page.keyboard.press("Escape");
    await expect(gridInspect).toBeHidden();

    // Step 3 — open Panel B's Fullscreen, click its OWN chart for the SAME
    // clicked region (read back to confirm, since the fullscreen pie's own
    // rendered geometry differs from the grid card's and a fixed pixel
    // offset can land on a different slice there).
    await regionCard.getByRole("button", { name: `Fullscreen ${regionPanelTitle}` }).click();
    const fullscreenDialog = page.getByRole("dialog", { name: `${regionPanelTitle} fullscreen` });
    await expect(fullscreenDialog).toBeVisible();
    await clickPieChart(fullscreenDialog, page);
    const fullscreenInspect = fullscreenDialog.getByRole("dialog", {
      name: `Inspect ${regionPanelTitle}`,
    });
    await expect(fullscreenInspect).toBeVisible();
    await expect(fullscreenInspect.getByText(/^Showing rows for region: /)).toBeVisible();
    const fullscreenInspectText =
      (await fullscreenInspect.getByText(/^Showing rows for region: /).textContent()) ?? "";
    const fullscreenClickedRegion = fullscreenInspectText.includes("East") ? "East" : "West";

    // THE regression this test guards: Fullscreen's nested Inspect must show
    // EXACTLY 1 row for whichever region it clicked — never both quarters'
    // rows for that region (the bug: a shared, un-filtered rawRows/headers
    // prop feeding both PanelContent and the nested Inspect).
    const fullscreenTable = fullscreenInspect.getByRole("table");
    await expect(fullscreenTable).toHaveAttribute("aria-rowcount", "2");
    const fullscreenExpectedRevenue = regionQuarterRows.find(
      ([region, , quarter]) => region === fullscreenClickedRegion && quarter === activeQuarter,
    )?.[1];
    await expect(fullscreenInspect).toContainText(String(fullscreenExpectedRevenue));

    await page.screenshot({
      path: ".concertino/runs/HEL-588/evidence/fullscreen-inspect-dimension-mismatch-fixed.png",
    });
  });
});
