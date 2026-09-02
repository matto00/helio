import { expect, test } from "@playwright/test";

// HEL-666 — live verification (tasks.md 3.3/3.4, AC1/AC2). Both the quick-launcher (HEL-665) and
// the proposal hand-off (HEL-665's `ProposalHandoff.tsx`) were already fully shipped before this
// ticket -- this ticket's own job here is to LIVE-VERIFY they still hold once the old assistant's
// per-feature entry point (`AuthoringChatDrawer`'s "magic wand" button in `DashboardList.tsx`) is
// deleted, not to build anything new (see design.md D7). Mirrors e2e/hel665-message-composer.spec.ts
// and e2e/hel399-shape-instantiate.spec.ts's pattern -- run on demand via `npm run e2e` against real
// dev servers with a real `ANTHROPIC_API_KEY`, not part of the pre-commit gates.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel666-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-666 single assistant entry point live verification", () => {
  test("every authenticated route shows exactly one way to reach the assistant; the old per-feature button is gone", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("entrypoints");
    const password = "correcthorsebattery1";
    await request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-666 E2E Entry Points" },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    // A dashboard, so "/" also exercises the dashboard-scoped "Refine with AI" button below
    // (auto-selected as most-recent, mirroring e2e/hel399-shape-instantiate.spec.ts's precedent).
    const dashboardRes = await page.request.post("/api/dashboards", {
      data: { name: "HEL-666 Entry Points" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashboardRes.status()).toBe(201);

    // HEL-909: /registry and /metrics were retired outright (nav collapse) --
    // dropped from this route list rather than asserting the launcher is
    // visible on routes that no longer exist.
    const routes = ["/", "/sources", "/pipelines", "/chat"];
    for (const route of routes) {
      await page.goto(route);
      // The single quick-launcher trigger (HEL-665, unconditional) is present on every route --
      // AC1's "the inline launcher... available on every screen".
      await expect(page.getByRole("button", { name: "Open assistant" })).toBeVisible();
      // The old per-feature "magic wand" entry point (AuthoringChatDrawer's mount in
      // DashboardList.tsx) is gone everywhere -- deleted by this ticket, not just hidden (AC3).
      await expect(
        page.getByRole("button", { name: "Author dashboard with AI" }),
      ).not.toBeVisible();
    }

    // Note (tasks.md 3.3, design-gate round 1 non-blocking observation): "Refine with AI" is a
    // SECOND, DIFFERENT AI-related icon that legitimately remains visible on "/" with a dashboard
    // selected -- RefinementChatDrawer's own, separate, explicitly-out-of-scope HEL-343 entry
    // point (design.md D4), not a violation of AC1's "exactly one way to reach the [new top-level]
    // assistant". Verified live here as a regression guard on that boundary, not touched by this
    // ticket's diff.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Refine this dashboard with AI" })).toBeVisible();

    // Cmd/Ctrl+K opens the same overlay as the command-bar trigger (HEL-665) -- the second half of
    // AC1's "inline launcher".
    await page.keyboard.press("Control+k");
    await expect(page.getByLabel("Message")).toBeVisible();
  });

  test("a real propose_dashboard result hands off to Proposal Review, and Accept creates the dashboard", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("proposal");
    const password = "correcthorsebattery1";
    await request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-666 E2E Proposal" },
      headers: { [CSRF_HEADER]: "1" },
    });

    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL("/");

    // Grounding data: a real pipeline-output DataType (source -> pipeline -> type, the only path
    // that produces panel-bindable data) the assistant's `find`/`get_resource` tools can discover.
    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-666 Sales",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20], [30]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = (await sourceRes.json()) as { id: string };

    const pipelineRes = await page.request.post("/api/pipelines", {
      data: {
        name: "HEL-666 Sales Pipeline",
        sourceDataSourceId: source.id,
        outputDataTypeName: "Hel666SalesTotal",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = (await pipelineRes.json()) as { id: string };

    const runRes = await page.request.post(`/api/pipelines/${pipeline.id}/run`, {
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(runRes.status()).toBe(200);

    await page.goto("/chat");
    const input = page.getByLabel("Message");
    await expect(input).toBeVisible();
    await input.fill(
      'Create a new dashboard named "HEL-666 Sales Overview" with one panel showing the amount ' +
        "values from the Hel666SalesTotal data type. Propose it now.",
    );

    // A real, non-mocked round trip through the real Anthropic API -- generous timeout, mirroring
    // e2e/hel665-message-composer.spec.ts.
    const [converseResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/converse") && r.request().method() === "POST",
        { timeout: 60_000 },
      ),
      page.getByRole("button", { name: "Send" }).click(),
    ]);
    expect(converseResponse.status()).toBe(200);

    // ProposalHandoff.tsx (HEL-665) renders once extractProposal finds a successful
    // propose_dashboard call -- the exact same navigate(..., {state: {proposal}}) mechanism
    // AuthoringChatDrawer used, now reached via a different producer (proposal.md's own framing).
    const reviewButton = page.getByRole("button", { name: "Review proposal" });
    await expect(reviewButton).toBeVisible({ timeout: 20_000 });
    await reviewButton.click();

    await page.waitForURL("/proposals/review");
    await expect(page.getByRole("heading", { name: "Review dashboard proposal" })).toBeVisible();
    await expect(page.getByLabel("Dashboard name")).toHaveValue("HEL-666 Sales Overview");
    await expect(page.getByText("1 panel")).toBeVisible();

    // Accept actually applies -- the same apply-proposal endpoint today's dashboard proposals
    // already use (ProposalReviewPage.tsx, untouched by this ticket).
    const [applyResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/dashboards/apply-proposal") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Accept & create" }).click(),
    ]);
    expect(applyResponse.status()).toBe(201);

    // Navigates back to "/" and the newly-created dashboard is selected and visible in the
    // sidebar list (scoped to the dashboard-list button -- the same name also legitimately
    // appears in the breadcrumb and mobile title once selected).
    await page.waitForURL("/");
    await expect(page.getByRole("button", { name: "HEL-666 Sales Overview" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
