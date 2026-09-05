import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-968 task 11 / AC1 (HEL-913's original AC5, verbatim): add a second
// root via pasted table, join it to the first lane, place the resulting
// table Output. Driven through the real running UI, not API-seeded, per
// the ticket's own "prove it against the running app" instruction --
// `npm run typecheck` cannot catch a wire-shape break here (design.md).
//
// HEL-970's known live defect: `previewAtNode`'s `pathToRoot` never follows
// a rejoin's `secondaryInput` lane edge, so preview 422s for a non-ancestor
// lane rejoin. This flow deliberately joins root 2 via a `union` step's
// SOURCE-kind secondary input (root 2's own `dataSourceId`), not a
// `{kind:"lane"}` rejoin onto one of root 2's own steps (root 2 has none --
// it's a fresh, empty root) -- so this flow does not exercise that defect
// at all. If a future step config on this file's fixture does hit a
// non-ancestor lane rejoin and preview 422s, that is HEL-970's defect, not
// this ticket's to fix or work around.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel968-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-968 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

test.describe("HEL-968 multi-root editor (live UI proof)", () => {
  test("add a second root via pasted table, join it to the first lane, place the resulting table Output", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "multi-root");

    // ── New pipeline with a single-root pasted table (root 0). ──
    await page.goto("/pipelines");
    await page.locator("#app-main-content").getByRole("button", { name: "New pipeline" }).click();

    const pipelineModal = page.getByRole("dialog", { name: "Create pipeline" });
    await expect(pipelineModal).toBeVisible();
    await pipelineModal.locator("#pipeline-name").fill("HEL-968 Multi-Root Pipeline");
    await pipelineModal.getByRole("button", { name: "Create a new source" }).click();

    const sourceModal = page.getByRole("dialog", { name: "Add data source" });
    await sourceModal.getByRole("button", { name: "Manual" }).click();
    await sourceModal.locator("#source-name-static").fill("HEL-968 Root One");
    await sourceModal.getByLabel("Column 1 name").fill("label");
    await sourceModal.getByRole("button", { name: "Next: Add rows" }).click();
    await sourceModal.getByRole("button", { name: "+ Add row" }).click();
    await sourceModal.getByLabel("Row 1 label").fill("a");
    await sourceModal.getByRole("button", { name: "Create source" }).click();

    await expect(sourceModal).toBeHidden();
    await expect(pipelineModal).toBeVisible();
    const pipelineCreated = page.waitForResponse(
      (res) => res.url().includes("/api/pipelines") && res.request().method() === "POST",
    );
    await pipelineModal.getByRole("button", { name: "Create pipeline" }).click();
    const pipelineRes = await pipelineCreated;
    const pipeline = (await pipelineRes.json()) as { id: string };
    await page.waitForURL(`/pipelines/${pipeline.id}`);

    // ── AC1 — "+ root": a second root via a pasted table. ──
    await page.getByRole("button", { name: "+ Add root" }).click();
    const addRootModal = page.getByRole("dialog", { name: "Add a root" });
    await expect(addRootModal).toBeVisible();
    await addRootModal.getByRole("button", { name: "Create a new source" }).click();

    const rootTwoSourceModal = page.getByRole("dialog", { name: "Add data source" });
    await rootTwoSourceModal.getByRole("button", { name: "Manual" }).click();
    await rootTwoSourceModal.locator("#source-name-static").fill("HEL-968 Root Two");
    await rootTwoSourceModal.getByLabel("Column 1 name").fill("category");
    await rootTwoSourceModal.getByRole("button", { name: "Next: Add rows" }).click();
    await rootTwoSourceModal.getByRole("button", { name: "+ Add row" }).click();
    await rootTwoSourceModal.getByLabel("Row 1 category").fill("x");
    await rootTwoSourceModal.getByRole("button", { name: "Create source" }).click();
    await expect(rootTwoSourceModal).toBeHidden();
    await expect(addRootModal).toBeVisible();

    const rootAdded = page.waitForResponse(
      (res) => res.url().includes("/roots") && res.request().method() === "POST",
    );
    await addRootModal.getByRole("button", { name: "Add root" }).click();
    await rootAdded;
    await expect(addRootModal).toBeHidden();

    // Root 2 renders as its own column, labelled with its source's name,
    // an empty lane (no steps yet) -- task 6.1/6.2.
    await expect(
      page.locator(".pipeline-detail-page__root-column-title", { hasText: "HEL-968 Root Two" }),
    ).toBeVisible();
    await expect(page.getByText(/No steps yet — join this source/i)).toBeVisible();

    // ── "join it to the first lane": add a union step off root 1's own
    // (only) step-less lane -- root 1 also has no steps yet, so seed one
    // first, then union root 2's source into it. ──
    const selectStepCreated = page.waitForResponse(
      (res) => res.url().includes("/steps") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByRole("menuitem", { name: /Select fields/i }).click();
    await selectStepCreated;
    await expect(page.getByRole("button", { name: /Select fields/i })).toBeVisible();

    const unionStepCreated = page.waitForResponse(
      (res) => res.url().includes("/steps") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Branch this step" }).first().click();
    await page.getByRole("menuitem", { name: /Union/i }).click();
    await unionStepCreated;
    const unionStepToggle = page.getByRole("button", { name: /Union \/ append rows/ });
    await expect(unionStepToggle).toBeVisible();
    // The step card's config editor is collapsed by default -- expand it.
    await unionStepToggle.click();

    // The union step's secondary input: source-kind, pointed at root 2's
    // own data source (NOT a lane-kind rejoin -- see file header note on
    // why this sidesteps HEL-970's defect entirely).
    await page.getByRole("combobox", { name: "Other source" }).click();
    const secondaryPatched = page.waitForResponse(
      (res) =>
        res.url().includes("/pipeline-steps/") &&
        (res.request().method() === "PATCH" || res.request().method() === "PUT"),
    );
    await page.getByRole("option", { name: "Data source: HEL-968 Root Two" }).click();
    await secondaryPatched;

    // Reload so the Outputs tab's "Target step" picker addresses this step
    // by its real, persisted id -- not the local `step-N` temp id
    // `handleAddLaneStep`'s optimistic splice used before the create
    // call's server-fresh resync landed.
    await page.reload();
    await expect(page.getByRole("button", { name: /Union \/ append rows/ })).toBeVisible();

    // ── Place the resulting table Output. ──
    await page.getByRole("tab", { name: /Outputs/ }).click();
    await page.getByRole("button", { name: /New output/ }).click();
    await page.locator("#output-name").fill("Joined Output");
    // Attach to the union step explicitly -- the joined columns exist on
    // that node, not on the ambiguous "Pipeline root" default (root 1
    // alone) the sheet otherwise pre-selects.
    await page.getByRole("combobox", { name: "Target step" }).click();
    await page.getByRole("option", { name: /Union/i }).click();
    await page.getByRole("combobox", { name: "Output kind" }).click();
    await page.getByRole("option", { name: "Table" }).click();
    const outputSaved = page.waitForResponse(
      (res) => res.url().includes("/outputs") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save" }).click();
    await outputSaved;

    await expect(page.locator(".output-gallery-card")).toHaveCount(1);
    await expect(page.getByText("Joined Output")).toBeVisible();

    // ── Place it on a dashboard. ──
    const dashRes = await request.post("/api/dashboards", {
      data: { name: "HEL-968 Multi-Root Dashboard" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(dashRes.status()).toBe(201);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /HEL-968 Multi-Root Dashboard/ })).toBeVisible();
    await page.getByRole("button", { name: "Add panel" }).click();
    const picker = page.getByRole("dialog", { name: "Add panel" });
    await expect(picker).toBeVisible();
    await picker.getByRole("option", { name: /^Joined Output/ }).click();
    await expect(picker).toBeHidden();
    await expect(page.locator(".react-grid-item")).toHaveCount(1);
  });
});

// HEL-968 task 10.2 — measured RENDERED boxes (bounding-box/computed-style
// in the running app), not a CSS `min-height` source reading: a declared
// value proves nothing about what actually lays out ("evidence-shaped
// non-evidence" trap this project has recorded). Both mobile breakpoints
// task 10.1 targets.
test.describe("HEL-968 mobile touch targets (task 10.2)", () => {
  for (const width of [375, 430]) {
    test(`"+ Add root" and root-remove controls are >= 44px in both dimensions at ${width}px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await registerAndLogin(page, request, `touch-target-${width}`);

      const sourceRes = await request.post("/api/data-sources", {
        data: {
          name: "HEL-968 Touch Target Source",
          type: "static",
          columns: [{ name: "label", type: "string" }],
          rows: [["a"]],
        },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(sourceRes.status()).toBe(201);
      const source = (await sourceRes.json()) as { id: string };

      const pipelineRes = await request.post("/api/pipelines", {
        data: { name: "HEL-968 Touch Target Pipeline", roots: [{ sourceId: source.id }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(pipelineRes.status()).toBe(201);
      const pipeline = (await pipelineRes.json()) as { id: string };

      const rootTwoRes = await request.post(`/api/pipelines/${pipeline.id}/roots`, {
        data: { sourceId: source.id },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(rootTwoRes.status()).toBe(201);

      await page.goto(`/pipelines/${pipeline.id}`);
      const addRootBtn = page.getByRole("button", { name: "+ Add root" });
      await expect(addRootBtn).toBeVisible();
      const addRootBox = await addRootBtn.boundingBox();
      expect(addRootBox).not.toBeNull();
      expect(addRootBox!.width).toBeGreaterThanOrEqual(44);
      expect(addRootBox!.height).toBeGreaterThanOrEqual(44);

      const removeBtn = page.getByRole("button", { name: /Remove root/i });
      await expect(removeBtn).toBeVisible();
      const removeBox = await removeBtn.boundingBox();
      expect(removeBox).not.toBeNull();
      expect(removeBox!.width).toBeGreaterThanOrEqual(44);
      expect(removeBox!.height).toBeGreaterThanOrEqual(44);
    });
  }
});
