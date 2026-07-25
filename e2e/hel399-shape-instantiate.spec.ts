import { expect, test } from "@playwright/test";

// HEL-399 — live verification (task 4.5 / ticket orchestrator pre-brief
// point 6): exercises the real panel-creation "start from a shape" picker
// path against running dev servers (mirrors e2e/auth-cookie-migration.spec.ts's
// pattern — run on demand via `npm run e2e`, not part of the pre-commit
// gates). Covers the HEL-336 defect guard (an invalid required shape param
// never silently swallows the resulting 422 — it must be visibly shown) and
// a full happy-path single-row → metric instantiate-and-bind against the
// real backend chain (expand → create → step → run → panel creation).

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel399-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-399 shape-instantiate live verification", () => {
  test("empty required param surfaces the 422 inline; happy path binds a real panel", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("shape");
    const password = "correcthorsebattery1";

    await request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-399 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    // Prerequisites: a dashboard (auto-selected as most-recent) and a static
    // data source with a numeric "amount" column for the aggregate measure.
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-399 Verification" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-399 Sales",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20], [30]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);

    await page.goto("/");
    await page.getByRole("button", { name: "Add panel" }).click();

    await page.getByRole("button", { name: "Metric" }).click();
    await page.getByRole("button", { name: "Start blank" }).click();

    // Shape card appears on the datatype-select step, from the live catalog.
    await expect(page.getByText("Single row")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Single row").click();

    await expect(page.getByLabel("Pipeline name")).toBeVisible();

    // ── Failure path: submit with an invalid "Mode" value. ──
    // (An empty required field is blocked client-side — the submit button
    // stays disabled per the spec's gating, confirmed here before filling
    // it — so the real-backend 422 case exercises an *invalid* value, which
    // client-side validation cannot catch and only the shape's own
    // server-side `expand` validation rejects.)
    await page.fill("#shape-instantiate-name", "HEL-399 Sales Total");
    await page.getByRole("combobox", { name: "Data source" }).click();
    await page.getByRole("option", { name: "HEL-399 Sales" }).click();
    await page.fill("#shape-instantiate-output-type", "Hel399SalesTotal");
    await expect(page.getByRole("button", { name: "Create and bind" })).toBeDisabled();

    await page.fill("#shape-instantiate-param-mode", "not-a-real-mode");
    await expect(page.getByRole("button", { name: "Create and bind" })).toBeEnabled();

    const [expandResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/pipeline-shapes/single-row/expand")),
      page.getByRole("button", { name: "Create and bind" }).click(),
    ]);
    expect(expandResponse.status()).toBe(422);

    // The HEL-336 defect guard: the 422's message is visibly shown, not
    // silently swallowed, and the modal stays on shape-instantiate.
    await expect(page.getByText(/unknown 'mode' value/i)).toBeVisible();
    await expect(page.getByLabel("Pipeline name")).toBeVisible();

    // ── Happy path: valid params, full chain, real bound panel. ──
    await page.fill("#shape-instantiate-param-mode", "aggregate");
    await page.fill(
      "#shape-instantiate-param-measures",
      '[{"fn":"sum","field":"amount","alias":"total"}]',
    );

    const [runResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/run") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Create and bind" }).click(),
    ]);
    expect(runResponse.status()).toBe(200);
    const runBody = (await runResponse.json()) as { rowCount: number };
    expect(runBody.rowCount).toBe(1);

    // Only a successful run advances to name-entry.
    await expect(page.getByLabel("Panel title")).toBeVisible({ timeout: 10_000 });
    await page.fill("#panel-create-title", "Sales Total");

    const [createPanelResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/panels") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Create panel" }).click(),
    ]);
    expect(createPanelResponse.status()).toBe(201);
    const panelBody = (await createPanelResponse.json()) as {
      config: { dataTypeId?: string; fieldMapping?: unknown };
    };
    expect(panelBody.config.dataTypeId).toBeTruthy();
    // fieldMapping stays unset (empty) — matches the existing
    // DataType-select path's precedent (never auto-populated).
    expect(Object.keys((panelBody.config.fieldMapping as object) ?? {})).toHaveLength(0);

    // The real panel is now on the dashboard.
    await expect(page.getByText("Sales Total")).toBeVisible({ timeout: 10_000 });
  });
});
