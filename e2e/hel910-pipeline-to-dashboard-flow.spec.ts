import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-910 task 6.1/6.2 -- the P1.7 sweep's own "end-to-end proof" AC
// (ticket.md, design.md decision 8): source -> pipeline -> three Outputs ->
// dashboard, and separately placing an already-existing Output on a
// dashboard, both driven through the real UI (not API-seeded, per the
// ticket brief's "from clicking 'New pipeline' with a pasted table") and
// measured with a shared click-counting helper (decision 8's exact
// definition: wraps every actual `page.click`/`page.keyboard.press("Enter")`
// dispatch, no hand-counted "logical actions").
//
// IMPORTANT, measured finding (not a guess -- read straight off this spec's
// own instrumented run): the ticket's "<= 12 interactions" budget for the
// three-Outputs-to-dashboard scenario is NOT achievable against the UI as
// actually shipped by P1.5/P1.6, and the gap is provable by construction,
// not just this run's particular path:
//   - Every OutputEditorSheet create ALWAYS opens with `kind` hardcoded to
//     "chart" (OutputEditorSheet.tsx: `useState<OutputKind>((output?.kind as
//     OutputKind) ?? "chart")`, re-seeded to that same default on every
//     open). Chart is the only kind whose fields are non-trivial regardless
//     -- it requires 3 required selects (Group by / Value field / Reduce)
//     before Save will even validate.
//   - The cheapest kind to actually submit is "table" (TableKindFields has
//     no required selects at all -- see OutputKindFields.tsx), but reaching
//     it from the hardcoded "chart" default costs 2 clicks (open the "Output
//     kind" combobox, choose "Table") EVERY time, since the sheet always
//     re-opens on "chart".
//   - So the real floor per Output is 4 clicks: "Add output" -> open kind
//     combobox -> choose "Table" -> "Save". Three Outputs alone cost 12 --
//     the ticket's entire budget -- before a single click toward creating
//     the pipeline/source or placing anything on a dashboard.
// DELIBERATE, HUMAN-APPROVED RELAXATION OF THE TICKET AC -- read this before
// touching the assertion below. ticket.md's AC and design.md decision 8 both
// state "<= 12 interactions" as the DESIGNED TARGET; that target is NOT what
// this spec enforces. The orchestrator escalated this exact conflict (28
// measured vs. <= 12 required, unreachable against the shipped UI per the
// construction above) to the human coordinator, who ruled explicitly: ship
// this spec asserting the real measured ceiling now, and track restoring
// "<= 12" as its own acceptance criterion on the follow-up ticket, HEL-942
// ("Streamline Output creation flow to meet the <=12-interaction budget").
// So: `toBeLessThanOrEqual(30)` below is a REGRESSION GUARD against the
// CURRENT UI's real cost, not the product's intended target -- a future
// reader must not mistake 30 (or the measured 28) for the designed number,
// which remains 12 until HEL-942 ships and tightens this assertion back
// down. HEL-942's own AC requires updating this exact `toBeLessThanOrEqual`
// call, not just streamlining the UI in isolation.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel910-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-910 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Design.md decision 8's exact click-counting helper: wraps every real
 *  `page.click`/`page.keyboard.press("Enter")` dispatch and counts them.
 *  Nothing else (typing, waits, assertions, navigation) counts. */
function makeInteractionCounter(page: Page) {
  let count = 0;
  return {
    async click(locator: import("@playwright/test").Locator) {
      await locator.click();
      count += 1;
    },
    async enter() {
      await page.keyboard.press("Enter");
      count += 1;
    },
    get count() {
      return count;
    },
  };
}

test.describe("HEL-910 source -> pipeline -> Outputs -> dashboard (live UI proof)", () => {
  test("New pipeline with a manually-entered ('pasted') table -> three table Outputs -> all placed on a dashboard", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "full-flow");
    const io = makeInteractionCounter(page);

    // ── Seed a dashboard to place Outputs onto (dashboard creation itself
    // is not part of the budgeted scenario -- "New pipeline ... to three
    // Outputs placed on a dashboard" presupposes a target dashboard exists,
    // exactly like HEL-909's own seeded-dashboard convention). ──
    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-910 Flow Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashRes.status()).toBe(201);

    // ── "New pipeline" with a manually-entered table (the shipped
    // "paste-a-table" source kind is the Manual/static connector -- see
    // SourceTypeToggle.tsx's `displayName: "Manual"` for `kind: "static"`,
    // and hel908-full-flow.spec.ts's own precedent for calling this the
    // "paste-table" shape) ──
    await page.goto("/pipelines");
    // Scoped to the main content region -- the sidebar's own "+" control
    // (SidebarBody.tsx's `addLabel="New pipeline"`) shares the same
    // accessible name and would otherwise make this locator ambiguous.
    await io.click(page.locator("#app-main-content").getByRole("button", { name: "New pipeline" }));

    const pipelineModal = page.getByRole("dialog", { name: "Create pipeline" });
    await expect(pipelineModal).toBeVisible();
    await pipelineModal.locator("#pipeline-name").fill("HEL-910 Flow Pipeline");
    await io.click(pipelineModal.getByRole("button", { name: "Create a new source" }));

    const sourceModal = page.getByRole("dialog", { name: "Add data source" });
    await io.click(sourceModal.getByRole("button", { name: "Manual" }));
    await sourceModal.locator("#source-name-static").fill("HEL-910 Flow Source");
    // Default single column ("", type "string") is renamed via typing only
    // (not counted) -- no "+ Add column" click needed for a minimal source.
    await sourceModal.getByLabel("Column 1 name").fill("label");
    await io.click(sourceModal.getByRole("button", { name: "Next: Add rows" }));
    await io.click(sourceModal.getByRole("button", { name: "+ Add row" }));
    await sourceModal.getByLabel("Row 1 label").fill("a");
    await io.click(sourceModal.getByRole("button", { name: "Create source" }));

    // AddSourceModal's onCreated callback reports the new source id back
    // into CreatePipelineModal (still open, pre-filled name intact).
    await expect(sourceModal).toBeHidden();
    await expect(pipelineModal).toBeVisible();
    const pipelineCreated = page.waitForResponse(
      (res) => res.url().includes("/api/pipelines") && res.request().method() === "POST",
    );
    await io.click(pipelineModal.getByRole("button", { name: "Create pipeline" }));
    const pipelineRes = await pipelineCreated;
    const pipeline = (await pipelineRes.json()) as { id: string };
    await page.waitForURL(`/pipelines/${pipeline.id}`);

    // A brand-new pipeline has zero steps, so the per-step "Add output"
    // rail chip (PipelineRiverView) has nothing to attach to yet -- the
    // "Outputs" tab's own "+ New output"/"New output" affordance
    // (OutputsGalleryTab.tsx) is the entry point that works against the
    // pipeline root regardless of step count.
    await io.click(page.getByRole("tab", { name: /Outputs/ }));

    // ── Three Outputs, all "table" kind (the only kind with zero required
    // selects -- see this file's header note on why "chart", the sheet's
    // hardcoded default, is never the cheap path). ──
    const outputNames = ["Output One", "Output Two", "Output Three"];
    for (const outputName of outputNames) {
      await io.click(page.getByRole("button", { name: /New output/ }));
      await page.locator("#output-name").fill(outputName);
      await io.click(page.getByRole("combobox", { name: "Output kind" }));
      await io.click(page.getByRole("option", { name: "Table" }));
      const saved = page.waitForResponse(
        (res) => res.url().includes("/outputs") && res.request().method() === "POST",
      );
      await io.click(page.getByRole("button", { name: "Save" }));
      await saved;
    }
    await expect(page.locator(".output-gallery-card")).toHaveCount(3);

    // ── Place all three Outputs on the seeded dashboard. First placement
    // uses the "No panels yet" empty-state CTA (single click straight into
    // the picker); subsequent placements go through the command bar's
    // "Dashboard actions" kebab (the only entry point once the empty state
    // is gone -- see PanelList.tsx). ──
    // A freshly-registered user has exactly the one dashboard seeded above
    // (no demo data), and `fetchDashboards.fulfilled` auto-selects the most
    // recently created dashboard when none is selected yet -- no explicit
    // "switch dashboard" interaction needed.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /HEL-910 Flow Dashboard/ })).toBeVisible();

    for (let i = 0; i < outputNames.length; i++) {
      const outputName = outputNames[i];
      if (i === 0) {
        await io.click(page.getByRole("button", { name: "Add panel" }));
      } else {
        await io.click(page.getByRole("button", { name: "Dashboard actions" }));
        await io.click(page.getByRole("menuitem", { name: "Add panel" }));
      }
      const picker = page.getByRole("dialog", { name: "Add panel" });
      await expect(picker).toBeVisible();
      await io.click(picker.getByRole("option", { name: new RegExp(`^${outputName}`) }));
      await expect(picker).toBeHidden();
    }

    await expect(page.locator(".react-grid-item")).toHaveCount(3);

    console.log(`HEL-910 flow: ${io.count} interactions (see file header note on the budget).`);
    // 30 is a measured regression ceiling, NOT the design target -- see the
    // file header's "DELIBERATE, HUMAN-APPROVED RELAXATION" note. Designed
    // target remains <= 12 (ticket AC); HEL-942 owns tightening this exact
    // assertion once the underlying OutputEditorSheet flow is streamlined.
    expect(io.count).toBeLessThanOrEqual(30);
  });
});

test.describe("HEL-910 place an already-existing Output on a dashboard (<= 2 interactions)", () => {
  test("empty-state 'Add panel' CTA -> click the Output card places it", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "existing-output");
    const io = makeInteractionCounter(page);

    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-910 Existing Output Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashRes.status()).toBe(201);

    const sourceRes = await request.post("/api/data-sources", {
      data: {
        name: "HEL-910 Existing Source",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = (await sourceRes.json()) as { id: string };

    const pipelineRes = await request.post("/api/pipelines", {
      data: { name: "HEL-910 Existing Pipeline", sourceDataSourceId: source.id },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = (await pipelineRes.json()) as { id: string };

    const outputRes = await request.post(`/api/pipelines/${pipeline.id}/outputs`, {
      data: { kind: "table", name: "Existing Output", config: {} },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(outputRes.status()).toBe(201);

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /HEL-910 Existing Output Dashboard/ }),
    ).toBeVisible();

    // Interaction 1: the "No panels yet" empty-state CTA opens the Output
    // picker directly (PanelList.tsx -- `setPanelCreationModalOpen(true)`),
    // no kebab menu required on a fresh dashboard.
    await io.click(page.getByRole("button", { name: "Add panel" }));
    const picker = page.getByRole("dialog", { name: "Add panel" });
    await expect(picker).toBeVisible();

    // Interaction 2: click the already-existing Output directly (no search
    // typing needed -- typing is excluded from the count anyway, and with
    // only one Output seeded it's already visible).
    await io.click(picker.getByRole("option", { name: /^Existing Output/ }));
    await expect(picker).toBeHidden();

    await expect(page.locator(".react-grid-item")).toHaveCount(1);
    console.log(`HEL-910 existing-Output placement: ${io.count} interactions.`);
    expect(io.count).toBeLessThanOrEqual(2);
  });
});
