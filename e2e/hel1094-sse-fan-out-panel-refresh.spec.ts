import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1094 tasks 3.3/3.4 — live-browser proof of the FULL write -> debounce -> scheduler tick ->
// run -> SSE `succeeded` -> panel refetch chain, driven end-to-end with NO manual refresh and NO
// page reload, plus a computed-ARIA measurement of the sr-only status region (design.md D5,
// Standing Constraint C4).
//
// Tick-interval config used: this spec runs against the REAL dev backend with its DEFAULT
// `SCHEDULER_TICK_INTERVAL_SECONDS` (30s) and `DATASET_WRITE_DEBOUNCE_SECONDS` (5s) — NEITHER is
// overridden. A shorter test-accelerated tick was deliberately not used: this worktree's backend
// is a single shared dev-server instance also reused by later Evaluation/Skeptic gate runs
// (`scripts/concertino/start-servers.sh` is idempotent and reuses an already-healthy server on
// the same port) — restarting it with a non-default `SCHEDULER_TICK_INTERVAL_SECONDS` for this
// one spec would silently leak that override into every later gate that reuses the same server,
// which is exactly the class of hazard `MISTAKES.md`/CON-165 warn about. Waiting out the real
// default interval instead costs this spec real wall-clock time (up to ~35s debounce+tick, per
// `DATASET_WRITE_DEBOUNCE_SECONDS`'s own doc comment in `CLAUDE.md`, plus run + SSE delivery
// time) but exercises the production-configured timing exactly, with no shared-state risk.
test.describe("HEL-1094 SSE fan-out panel refresh (real backend, default tick interval)", () => {
  test.setTimeout(180_000);

  const CSRF_HEADER = "X-Helio-Requested-With";

  function uniqueEmail(label: string): string {
    return `hel1094-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
  }

  async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
    const email = uniqueEmail(label);
    const password = "correcthorsebattery1";
    const res = await request.post("/api/auth/register", {
      data: { email, password, displayName: `HEL-1094 ${label}` },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(res.status()).toBe(201);
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");
  }

  test("a form panel submit's downstream auto-run visibly refreshes a bound table panel, with a computed a11y announcement, and survives a second run", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "fanout");

    // ── Seed: dataset (source) -> pipeline (root = source, no steps) -> table Output -> two
    // panels on one dashboard (a form panel writing to the source, a table panel reading the
    // Output) -- mirrors the hel910/hel1065/hel1087 API-seeding precedent. A "table" kind Output
    // (not "chart") -- see hel910-pipeline-to-dashboard-flow.spec.ts's own comment: every chart
    // Output requires 3 non-trivial required selects, irrelevant to what THIS spec measures (the
    // fan-out refresh mechanism, which is Output-kind-agnostic); a table's rows are also the
    // simplest way to assert "the panel's visible content changed". ──
    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-1094 Fan-out Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashRes.status()).toBe(201);
    const dashboard = (await dashRes.json()) as { id: string };

    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-1094 Fan-out Source",
        type: "static",
        columns: [{ name: "amount", type: "integer", required: true }],
        rows: [[10]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = (await sourceRes.json()) as { id: string };

    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-1094 Fan-out Pipeline", roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = (await pipelineRes.json()) as { id: string };

    const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: { kind: "table", name: "HEL-1094 Fan-out Table", config: {} },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(outputRes.status()).toBe(201);
    const output = (await outputRes.json()) as { id: string };

    // Manual first run so the table panel already shows real data BEFORE the fan-out-triggered
    // refresh under test -- the AC scenario is "a chart panel ALREADY showing data" refreshing,
    // not a first-ever materialization.
    const firstRunRes = await request.post(`/api/pipelines/${pipeline.id}/run`, {
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(firstRunRes.status()).toBe(200);
    let initialRowCount = 0;
    for (let attempt = 0; attempt < 40 && initialRowCount === 0; attempt++) {
      const rowsRes = await request.get(`/api/outputs/${output.id}/rows`);
      if (rowsRes.status() === 200) {
        const body = (await rowsRes.json()) as { items?: unknown[] };
        initialRowCount = body.items?.length ?? 0;
      }
      if (initialRowCount === 0) await new Promise((r) => setTimeout(r, 250));
    }
    expect(initialRowCount, "the manual first run must materialize the Output's initial row").toBe(
      1,
    );

    const formPanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: "HEL-1094 Fan-out Form",
        type: "form",
        config: {
          dataSourceId: source.id,
          fields: [{ sourceField: "amount", control: "number", label: "Amount", required: true }],
          submit: { writeMode: "append" },
        },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(formPanelRes.status()).toBe(201);
    const formPanel = (await formPanelRes.json()) as { id: string };

    const tablePanelRes = await request.post("/api/panels", {
      data: {
        dashboardId: dashboard.id,
        title: "HEL-1094 Fan-out Table Panel",
        type: "output",
        config: { outputId: output.id },
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(tablePanelRes.status()).toBe(201);
    const tablePanel = (await tablePanelRes.json()) as { id: string };

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

    await page.goto("/");

    const form = page.getByRole("form", { name: "HEL-1094 Fan-out Form" });
    await expect(form).toBeVisible();

    const tablePanelCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: "HEL-1094 Fan-out Table Panel" }) });
    await expect(tablePanelCard).toBeVisible();
    await expect(tablePanelCard.locator("tbody tr")).toHaveCount(1);

    // Scoped to the table panel's own card -- `ToastViewport` also portals its own
    // `role="status"`/`role="alert"` regions to `document.body`, which a bare
    // `page.getByRole("status")` would ambiguously match alongside this panel's region.
    const statusRegion = tablePanelCard.getByRole("status");
    await expect(statusRegion).toHaveCount(1);
    // Before any fan-out-triggered refresh, the region is empty (design.md D5).
    await expect(statusRegion).toHaveText("");
    const beforeFirstText = await statusRegion.textContent();

    // ── First write -> debounce -> tick -> run -> SSE `succeeded` -> refetch, with NO manual
    // refresh action and NO page reload anywhere below. ──
    await form.getByRole("spinbutton", { name: "Amount" }).fill("20");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form.locator(".form-panel-view__status")).toContainText(/added/i);

    // Real wall-clock wait for the default debounce (5s) + up to one default scheduler tick
    // (30s) + run + SSE delivery -- see this file's header comment for why the interval isn't
    // shortened. `toHaveCount`'s built-in polling is what actually detects the landing; there is
    // no manual `page.reload()`/refresh click anywhere in this spec.
    await expect(tablePanelCard.locator("tbody tr")).toHaveCount(2, { timeout: 120_000 });

    const afterFirstText = await statusRegion.textContent();
    expect(afterFirstText).not.toBe("");
    expect(afterFirstText).not.toBe(beforeFirstText);

    // Task 3.4 (C4) -- COMPUTED accessible state, not markup presence. `interestingOnly: false`
    // per hel1090-form-panel-assembled-a11y.spec.ts's own documented CDP-scoped-root workaround.
    const statusHandle = await statusRegion.elementHandle();
    expect(statusHandle).not.toBeNull();
    const axSnapshotAfterFirst = await page.accessibility.snapshot({
      root: statusHandle ?? undefined,
      interestingOnly: false,
    });
    expect(axSnapshotAfterFirst).not.toBeNull();
    expect(axSnapshotAfterFirst?.role).toBe("status");
    // Probe-confirmed (not assumed): Chrome's CDP accessibility tree gives the `role="status"`
    // node itself an EMPTY `name` (role="status" is `nameFrom: "author"` only per ARIA-in-HTML —
    // there is no `aria-label` here to compute one from) and instead exposes the live region's
    // actual text as a CHILD `role: "text"` node's own `name` — this is the real computed surface
    // a screen reader reads for an unlabeled live region's content, which is what the assertion
    // below checks changes, not the (permanently empty) root node's `name`.
    expect(axSnapshotAfterFirst?.children?.[0]?.name).toBe(afterFirstText);

    // ── Second write -- proves the subscription survives across multiple runs (design.md D3 /
    // spec.md "watch subscription survives across multiple runs"), not just a single terminal
    // event, and that the announcement text changes AGAIN, distinctly. ──
    await form.getByRole("spinbutton", { name: "Amount" }).fill("30");
    await form.getByRole("button", { name: "Submit" }).click();
    await expect(form.locator(".form-panel-view__status")).toContainText(/added/i);

    await expect(tablePanelCard.locator("tbody tr")).toHaveCount(3, { timeout: 120_000 });

    const afterSecondText = await statusRegion.textContent();
    expect(afterSecondText).not.toBe("");
    expect(afterSecondText).not.toBe(afterFirstText);
  });
});
