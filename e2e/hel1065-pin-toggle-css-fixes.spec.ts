import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { forceFocusVisible } from "./support/forceFocusVisible";
import { readIndicatorSnapshot } from "./support/focusPresenceProbe";
import { measureBox } from "./support/touchTargetProbe";

// HEL-1065 (design.md D5) — rendered-geometry proof that HEL-465's two
// documented-but-inert pin-toggle CSS fixes actually have an effect, on the
// e2e/hel813-mobile-touch-target-floor.spec.ts / e2e/hel910-pipeline-to
// -dashboard-flow.spec.ts precedent. `DataGrid.test.tsx`'s three "STATIC
// SOURCE" Jest tests can only assert CSS declaration text — this spec
// measures `getBoundingClientRect()`/computed style on the RUNNING app, the
// only thing that can actually fail when the effect is absent (both fixes
// stayed green through five HEL-465 final-gate rounds while inert).
//
// Seeding uses the hel910 register-then-API-seed pattern (a fresh account
// owns zero Outputs) rather than a seeded `pinnedColumns` fixture — columns
// are pinned via the real pin-toggle UI control, so this spec also
// incidentally covers "pin via the actual control", not just the resulting
// CSS state.

const CSRF_HEADER = "X-Helio-Requested-With";
// A long, single-token header label so it genuinely truncates at any
// reasonable panel width, regardless of viewport/breakpoint. Precondition
// 3.2 (`scrollWidth > clientWidth`) is asserted explicitly below rather than
// assumed from this string's length alone.
// Deliberately starts with "a" — `DataGrid.deriveColumns` orders columns via
// a natural/numeric collator, not insertion order, so a label chosen only
// for length would NOT necessarily land first among "a".."e" in the
// rendered header row.
const LONG_COLUMN_LABEL = "aSupercalifragilisticexpialidociousmetricvalue";

function uniqueEmail(label: string): string {
  return `hel1065-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1065 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Seeds source -> pipeline -> table Output -> panel-on-dashboard via the
 *  API (hel910 pattern), with 5 string columns (the first genuinely
 *  truncating) and one data row, so a table panel with real, pin-toggle-
 *  bearing headers renders on `/` with no UI-driven setup needed. */
async function seedPinnableTablePanel(
  page: Page,
  label: string,
): Promise<{ dashboardName: string }> {
  const dashboardName = `HEL-1065 ${label} Dashboard`;
  const dashRes = await page.request.post("/api/dashboards", {
    data: { name: dashboardName },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(dashRes.status()).toBe(201);
  const dashboard = (await dashRes.json()) as { id: string };

  const columns = [
    { name: LONG_COLUMN_LABEL, type: "string" },
    { name: "b", type: "string" },
    { name: "c", type: "string" },
    { name: "d", type: "string" },
    { name: "e", type: "string" },
  ];
  const sourceRes = await page.request.post("/api/data-sources", {
    data: {
      name: `HEL-1065 ${label} Source`,
      type: "static",
      columns,
      rows: [["one", "two", "three", "four", "five"]],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(sourceRes.status()).toBe(201);
  const source = (await sourceRes.json()) as { id: string };

  const pipelineRes = await page.request.post("/api/pipelines", {
    data: { name: `HEL-1065 ${label} Pipeline`, roots: [{ sourceId: source.id }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(pipelineRes.status()).toBe(201);
  const pipeline = (await pipelineRes.json()) as { id: string };

  const outputRes = await page.request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: { kind: "table", name: `HEL-1065 ${label} Output`, config: {} },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(outputRes.status()).toBe(201);
  const output = (await outputRes.json()) as { id: string };

  // A fresh pipeline has no materialized run yet ("Not run yet" panel state)
  // — submit a real run and poll the Output's rows until they land, so the
  // panel below actually renders `DataGrid`'s full variant (pin toggle and
  // all) instead of the not-run-yet empty state.
  const runRes = await page.request.post(`/api/pipelines/${pipeline.id}/run`, {
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(runRes.status()).toBe(200);
  let rowsReady = false;
  for (let attempt = 0; attempt < 20 && !rowsReady; attempt++) {
    const rowsRes = await page.request.get(`/api/outputs/${output.id}/rows`);
    if (rowsRes.status() === 200) {
      const body = (await rowsRes.json()) as { items?: unknown[] };
      if ((body.items?.length ?? 0) > 0) {
        rowsReady = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(rowsReady, "the pipeline run must materialize rows for the Output before proceeding").toBe(
    true,
  );

  const panelRes = await page.request.post("/api/panels", {
    data: {
      dashboardId: dashboard.id,
      type: "output",
      config: { outputId: output.id },
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(panelRes.status()).toBe(201);

  // The panel was seeded via the API after the caller's initial `/`
  // navigation (registerAndLogin) already fetched an empty panel list —
  // reload so the grid actually reflects it.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: new RegExp(dashboardName) })).toBeVisible();
  await expect(page.locator(".react-grid-item")).toHaveCount(1);

  return { dashboardName };
}

/** Pins the leading 3 columns via the real pin-toggle control — clicking the
 *  3rd column's toggle pins every ordered column ahead of it too (design.md
 *  D5 "pin >=3 leading columns via the pin-toggle UI control itself"). */
async function pinLeadingColumns(page: Page): Promise<void> {
  const thirdColumnToggle = page.getByRole("button", { name: /^Pin (through column|column) c$/ });
  await expect(thirdColumnToggle).toBeVisible();
  await thirdColumnToggle.click();
  // Confirm the pin actually landed before measuring anything downstream —
  // scoped to the header row, since `.ui-data-grid__pinned-cell` also
  // renders on the matching body/filter-row cells for the same columns.
  await expect(page.locator("thead th.ui-data-grid__pinned-cell")).toHaveCount(3);
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((t) => localStorage.setItem("helio-theme", t), theme);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

interface Overlap {
  labelRect: { left: number; right: number; top: number; bottom: number };
  iconRect: { left: number; right: number; top: number; bottom: number };
  overlaps: boolean;
  scrollWidth: number;
  clientWidth: number;
}

/** Measures the rendered overlap between the truncating header's label span
 *  and its pin-toggle icon. Scoped to the `<th>` carrying the long label. */
async function measureLabelIconOverlap(page: Page): Promise<Overlap> {
  return page.evaluate((longLabel) => {
    const ths = Array.from(document.querySelectorAll("th.ui-data-grid__th--pin-reserve"));
    const th = ths.find((el) => (el.textContent ?? "").includes(longLabel));
    if (!th) throw new Error("could not find the long-label header cell");
    const label = th.querySelector(".sortable-th__label");
    const icon = th.querySelector(".ui-data-grid__pin-toggle-btn");
    if (!label || !icon) throw new Error("label or pin-toggle icon not found in header cell");
    const l = label.getBoundingClientRect();
    const i = icon.getBoundingClientRect();
    const overlaps = l.right > i.left && l.left < i.right && l.bottom > i.top && l.top < i.bottom;
    return {
      labelRect: { left: l.left, right: l.right, top: l.top, bottom: l.bottom },
      iconRect: { left: i.left, right: i.right, top: i.top, bottom: i.bottom },
      overlaps,
      scrollWidth: (th as HTMLElement).scrollWidth,
      clientWidth: (th as HTMLElement).clientWidth,
    };
  }, LONG_COLUMN_LABEL);
}

test.describe("HEL-1065 pin-toggle CSS fixes (rendered geometry)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`issue 1: header label ellipsizes before the pin icon, no overlap, with columns pinned (${theme})`, async ({
      page,
      request,
    }) => {
      await registerAndLogin(page, request, `overlap-${theme}`);
      await seedPinnableTablePanel(page, `overlap-${theme}`);
      await setTheme(page, theme);
      await pinLeadingColumns(page);

      const result = await measureLabelIconOverlap(page);
      // 3.2's explicit precondition — a fixture that stopped truncating
      // would otherwise make the overlap assertion below silently vacuous.
      expect(
        result.scrollWidth,
        "the long-label header must actually be truncating (scrollWidth > clientWidth)",
      ).toBeGreaterThan(result.clientWidth);
      expect(
        result.overlaps,
        `label rect ${JSON.stringify(result.labelRect)} vs icon rect ${JSON.stringify(result.iconRect)}`,
      ).toBe(false);
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`issue 2: pin-toggle button + focus ring stay fully inside the header cell at <=430px (${theme})`, async ({
      page,
      request,
      context,
    }) => {
      await registerAndLogin(page, request, `coarse-${theme}`);
      await seedPinnableTablePanel(page, `coarse-${theme}`);
      await setTheme(page, theme);
      await pinLeadingColumns(page);

      // The DataGrid media query is `(max-width: 430px), (pointer: coarse)`
      // — an OR, so a real <=430px viewport alone engages it without needing
      // separate touch/pointer emulation.
      await page.setViewportSize({ width: 400, height: 900 });
      // The resize triggers a re-layout of DataGrid's column widths
      // (ResizeObserver-driven); settle before measuring so `measureBox`
      // doesn't race a brief re-render right after `toBeVisible()` passes.
      await page.waitForTimeout(300);

      const pinButton = page.locator(".ui-data-grid__pin-toggle-btn").first();
      await expect(pinButton).toBeVisible();

      const buttonBox = await measureBox(pinButton);
      expect(buttonBox.visible).toBe(true);
      expect(buttonBox.width).toBeGreaterThanOrEqual(44);
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);

      const th = page.locator("th.ui-data-grid__th--pin-reserve").filter({ has: pinButton });
      const thBox = await th.first().boundingBox();
      expect(thBox).not.toBeNull();

      const buttonRect = await pinButton.evaluate((el) => el.getBoundingClientRect());
      expect(buttonRect.top).toBeGreaterThanOrEqual(thBox!.y);
      expect(buttonRect.bottom).toBeLessThanOrEqual(thBox!.y + thBox!.height);

      const client = await context.newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");
      const restore = await forceFocusVisible(client, pinButton);
      try {
        const snapshot = await readIndicatorSnapshot(pinButton);
        const ringLeft =
          snapshot.rect.left - snapshot.raw.outlineWidth - snapshot.raw.outlineOffset;
        const ringTop = snapshot.rect.top - snapshot.raw.outlineWidth - snapshot.raw.outlineOffset;
        const ringRight =
          snapshot.rect.right + snapshot.raw.outlineWidth + snapshot.raw.outlineOffset;
        const ringBottom =
          snapshot.rect.bottom + snapshot.raw.outlineWidth + snapshot.raw.outlineOffset;

        expect(ringTop, "focus ring top must be inside the <th>").toBeGreaterThanOrEqual(thBox!.y);
        expect(ringBottom, "focus ring bottom must be inside the <th>").toBeLessThanOrEqual(
          thBox!.y + thBox!.height,
        );
        expect(ringLeft, "focus ring left must be inside the <th>").toBeGreaterThanOrEqual(
          thBox!.x,
        );
        expect(ringRight, "focus ring right must be inside the <th>").toBeLessThanOrEqual(
          thBox!.x + thBox!.width,
        );
      } finally {
        await restore();
      }
    });
  }

  test("desktop/fine-pointer control: header row height is unaffected outside the coarse-pointer/<=430px media query", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "desktop-control");
    await seedPinnableTablePanel(page, "desktop-control");
    await page.setViewportSize({ width: 1280, height: 900 });

    const headerRow = page.locator(".ui-data-grid__header-row").first();
    await expect(headerRow).toBeVisible();
    const rowBox = await headerRow.boundingBox();
    expect(rowBox).not.toBeNull();
    // The row's own density padding/font-size, well under the 48px
    // coarse-pointer floor this ticket adds — confirms the fix is scoped to
    // its media query and does not leak onto the desktop surface.
    expect(rowBox!.height).toBeLessThan(48);
  });
});
