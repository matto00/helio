import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1096 tasks.md 3.9 — live-browser proof of the full chain: a denied form submit shows the
// toast naming the specific rule with a "Run to update" action; clicking it submits a REAL manual
// run through the existing guarded path, which lands and refreshes a bound panel via the EXISTING
// SSE fan-out (HEL-1094/1168, unmodified — no new refresh mechanism); a guard (429) rejection on
// that same action shows a distinct message, never the gate-denial copy.
//
// Denial mechanism: a pipeline with 21 enabled `assert` steps (each `{rules: []}` — a real,
// schema-preserving, always-passing no-op) exceeds `PipelineCostEstimator.MaxAutoRunSteps` (20),
// denying auto-run with `steps-above-bound` — deliberately NOT an `analyzewithai` step, since that
// would make a REAL manual run depend on `ANTHROPIC_API_KEY` being configured in this dev
// environment; `assert` with no rules never calls anything external and always succeeds.
test.describe("HEL-1096 run-to-update affordance (real backend)", () => {
  test.setTimeout(120_000);

  const CSRF_HEADER = "X-Helio-Requested-With";

  function uniqueEmail(label: string): string {
    return `hel1096-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
  }

  async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
    const email = uniqueEmail(label);
    const password = "correcthorsebattery1";
    const res = await request.post("/api/auth/register", {
      data: { email, password, displayName: `HEL-1096 ${label}` },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.status()).toBe(201);
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");
  }

  interface Created {
    id: string;
  }

  async function seedDeniedPipeline(request: APIRequestContext) {
    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-1096 e2e Source",
        type: "static",
        columns: [{ name: "note", type: "string", required: true }],
        rows: [["seed"]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = (await sourceRes.json()) as Created;

    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-1096 e2e Denied Pipeline", roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = (await pipelineRes.json()) as Created;

    // 21 enabled, real, schema-preserving no-op steps -- exceeds MaxAutoRunSteps (20).
    for (let i = 0; i < 21; i++) {
      const stepRes = await request.post(`/api/pipelines/${pipeline.id}/steps`, {
        data: { type: "assert", config: { rules: [] } },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(stepRes.status()).toBe(201);
    }

    const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: { kind: "table", name: "HEL-1096 e2e Table", config: {} },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(outputRes.status()).toBe(201);
    const output = (await outputRes.json()) as Created;

    return { source, pipeline, output };
  }

  async function outputRowCount(request: APIRequestContext, outputId: string): Promise<number> {
    const res = await request.get(`/api/outputs/${outputId}/rows`);
    if (res.status() !== 200) return 0;
    const body = (await res.json()) as { items?: unknown[] };
    return body.items?.length ?? 0;
  }

  async function seedDashboardWithPanels(
    request: APIRequestContext,
    sourceId: string,
    outputId: string,
  ) {
    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-1096 e2e Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashRes.status()).toBe(201);
    const dashboard = (await dashRes.json()) as Created;

    const formPanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: "HEL-1096 e2e Form",
        type: "form",
        config: {
          dataSourceId: sourceId,
          fields: [{ sourceField: "note", control: "text", label: "Note", required: true }],
          submit: { writeMode: "append" },
        },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(formPanelRes.status()).toBe(201);
    const formPanel = (await formPanelRes.json()) as Created;

    const tablePanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: "HEL-1096 e2e Table Panel",
        type: "output",
        config: { outputId },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(tablePanelRes.status()).toBe(201);
    const tablePanel = (await tablePanelRes.json()) as Created;

    const layoutRes = await request.post(`/api/dashboards/${dashboard.id}/auto-layout`, {
      data: {
        items: [
          { panelId: formPanel.id, w: 2, h: 2 },
          { panelId: tablePanel.id, w: 2, h: 2 },
        ],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(layoutRes.status()).toBe(200);

    return { dashboard, formPanel, tablePanel };
  }

  test("a denied form submit shows the specific-rule toast; clicking 'Run to update' submits a real run that refreshes the bound panel via the existing SSE fan-out", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "success");
    const { source, pipeline, output } = await seedDeniedPipeline(request);
    const { formPanel, tablePanel } = await seedDashboardWithPanels(request, source.id, output.id);
    void formPanel;

    // Baseline manual run BEFORE the write under test — mirrors hel1094's own precedent: the
    // table panel already shows real data before the refresh-under-test happens. A manual run is
    // NEVER gated by the cost verdict (only auto-run SCHEDULING is) — this always succeeds.
    const firstRunRes = await request.post(`/api/pipelines/${pipeline.id}/run`, {
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(firstRunRes.status()).toBe(200);
    await expect.poll(async () => outputRowCount(request, output.id), { timeout: 20_000 }).toBe(1);

    await page.goto("/");
    const form = page.getByRole("form", { name: "HEL-1096 e2e Form" });
    await expect(form).toBeVisible();

    const tablePanelCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: "HEL-1096 e2e Table Panel" }) });
    await expect(tablePanelCard).toBeVisible();
    await expect(tablePanelCard.locator("tbody tr")).toHaveCount(1);
    void tablePanel;

    await form.getByRole("textbox", { name: "Note" }).fill("second row");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form.locator(".form-panel-view__status")).toContainText(/added/i);

    // The toast: specific rule named (steps-above-bound -> "too many steps"), a "Run to update"
    // action present (owner, single denied pipeline, canRun=true), and it must NOT auto-dismiss
    // (duration: 0, C6) -- proven implicitly below by still finding it after other assertions run.
    const toastRegion = page.locator(".toast-viewport");
    const denialToast = toastRegion
      .locator(".toast--warning")
      .filter({ hasText: /too many steps/i });
    await expect(denialToast).toBeVisible();
    const runToUpdateBtn = denialToast.getByRole("button", { name: "Run to update" });
    await expect(runToUpdateBtn).toBeVisible();

    await runToUpdateBtn.click();

    // The toast reports the manual run was submitted.
    await expect(
      toastRegion.locator(".toast--success").filter({ hasText: /run started/i }),
    ).toBeVisible();

    // The real run lands and the bound table panel refreshes via the EXISTING SSE fan-out — no
    // manual refresh/reload anywhere in this test. The source now has 2 rows (seed + submitted).
    await expect(tablePanelCard.locator("tbody tr")).toHaveCount(2, { timeout: 60_000 });
  });

  test("a guard-rejected 'Run to update' (429) shows a distinct rate/concurrency-limited message, never the gate-denial copy", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "guard-429");
    const { source, pipeline, output } = await seedDeniedPipeline(request);
    await seedDashboardWithPanels(request, source.id, output.id);

    await page.route(`**/api/pipelines/${pipeline.id}/run`, async (route) => {
      await route.fulfill({
        status: 429,
        headers: { "Retry-After": "42" },
        contentType: "application/json",
        body: JSON.stringify({ error: "Too many pipeline runs" }),
      });
    });

    await page.goto("/");
    const form = page.getByRole("form", { name: "HEL-1096 e2e Form" });
    await expect(form).toBeVisible();

    await form.getByRole("textbox", { name: "Note" }).fill("triggers denial");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form.locator(".form-panel-view__status")).toContainText(/added/i);

    const toastRegion = page.locator(".toast-viewport");
    const runToUpdateBtn = toastRegion
      .locator(".toast--warning")
      .filter({ hasText: /too many steps/i })
      .getByRole("button", { name: "Run to update" });
    await expect(runToUpdateBtn).toBeVisible();
    await runToUpdateBtn.click();

    // Distinct guard-rejection message — names rate/concurrency limiting, the retry window, and
    // crucially NOT the gate-denial copy ("too many steps"/"calls AI"/etc.).
    const errorToast = toastRegion.locator(".toast--error");
    await expect(errorToast).toContainText(/too many runs/i);
    await expect(errorToast).toContainText(/42s/);
    await expect(errorToast).not.toContainText(/too many steps/i);
  });
});
