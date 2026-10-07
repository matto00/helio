import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { isolateLivePage } from "./support/isolateLivePage";
import { registerAndLogin } from "./support/auth";

// HEL-1189 tasks.md 4.5 — live verification of the "Controls" section
// (`OutputControlsEditor`): an author adds a date-range control to an Output
// panel in two clicks, auto-bound to its date/timestamp column. Mirrors
// `hel909-output-picker-panel-sheet.spec.ts`'s register-and-seed pattern --
// run on demand via `npm run e2e`, not part of the pre-commit gates.

const CSRF_HEADER = "X-Helio-Requested-With";

const AUTH = {
  prefix: "hel1189",
  displayName: "HEL-1189",
  domain: "example.com",
  isolate: true,
} as const;

/** Seeds a dashboard, a static source with a timestamp column, a pipeline off
 *  it, and a `table`-kind Output at the pipeline root ("Orders") whose
 *  declared schema exposes `created_at` (timestamp) — the column the
 *  date-range control auto-binds to. */
async function seedOrdersOutput(page: Page, request: APIRequestContext) {
  const dashboardRes = await request.post("/api/dashboards", {
    data: { name: "HEL-1189 Verification" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(dashboardRes.status()).toBe(201);

  const sourceRes = await request.post("/api/data-sources", {
    data: {
      name: "HEL-1189 Orders",
      type: "static",
      columns: [
        { name: "created_at", type: "timestamp" },
        { name: "amount", type: "integer" },
      ],
      rows: [
        ["2026-01-01T00:00:00Z", 10],
        ["2026-01-02T00:00:00Z", 20],
      ],
    },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(sourceRes.status()).toBe(201);
  const source = (await sourceRes.json()) as { id: string };

  const pipelineRes = await request.post("/api/pipelines", {
    data: { name: "HEL-1189 Orders Pipeline", roots: [{ sourceId: source.id }] },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(pipelineRes.status()).toBe(201);
  const pipeline = (await pipelineRes.json()) as { id: string };

  const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
    data: { kind: "table", name: "Orders" },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(outputRes.status()).toBe(201);
  const output = (await outputRes.json()) as { id: string };

  // A freshly-created Output's `schema` is empty until the pipeline has run at least once
  // (`node_snapshots` is what `schema`/`/filter-capabilities` are actually derived from) — the
  // Controls section has nothing to offer without this.
  const runRes = await request.post(`/api/pipelines/${pipeline.id}/run`, {
    data: {},
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(runRes.status()).toBe(200);

  return { outputId: output.id };
}

async function placeOrdersPanel(page: Page) {
  await page.getByRole("button", { name: "Dashboard actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add panel" }).click();
  const picker = page.getByRole("dialog", { name: "Add panel" });
  await expect(picker).toBeVisible();
  await page.getByLabel("Search outputs").fill("orders");
  await expect(picker.getByRole("option", { name: /^Orders/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();

  const panelCard = page.locator(".react-grid-item", { hasText: "Orders" });
  await expect(panelCard).toBeVisible({ timeout: 10_000 });
  await panelCard.click();
  const sheet = page.getByRole("dialog", { name: "Orders settings" });
  await expect(sheet).toBeVisible();
  await page.getByRole("button", { name: "Edit panel" }).click();
  return sheet;
}

test.describe("HEL-1189 output panel controls — live verification", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`adds a date-range control in two clicks, auto-bound to the date column (${theme} theme)`, async ({
      page,
      request,
    }) => {
      // The app defaults to dark; force light theme via the SAME localStorage key
      // `ThemeProvider` itself persists to (`theme.ts`'s `ThemeStorageKey`), set before the app's
      // own script runs, so the Controls section is actually measured in light theme too (C4) —
      // not just asserted to exist regardless of theme.
      if (theme === "light") {
        await page.addInitScript(() => window.localStorage.setItem("helio-theme", "light"));
      }

      await registerAndLogin(page, request, { ...AUTH, label: `${theme}` });
      await seedOrdersOutput(page, request);

      await page.goto("/");
      const sheet = await placeOrdersPanel(page);

      await expect(sheet.getByRole("heading", { name: "Controls" })).toBeVisible();
      const addControl = sheet.getByRole("combobox", { name: "Add control" });
      await expect(addControl).toBeVisible({ timeout: 10_000 });

      // Click 1 — open the kind picker.
      await addControl.click();
      // Click 2 — choose "Date range".
      await page.getByRole("option", { name: "Date range" }).click();

      const row = sheet.getByRole("group", { name: /Date range control:/ });
      await expect(row).toBeVisible();
      await expect(row.getByRole("combobox", { name: /Column for/ })).toHaveText("created_at");

      // Persist and re-open to prove the control round-trips through the server.
      await sheet.getByRole("button", { name: "Save panel settings" }).click();
      await expect(sheet.getByRole("button", { name: "Edit panel" })).toBeVisible();
      await page.getByRole("button", { name: "Edit panel" }).click();
      await expect(sheet.getByRole("group", { name: /Date range control:/ })).toBeVisible();
    });
  }
});
