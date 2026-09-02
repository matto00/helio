import { expect, test } from "@playwright/test";

// HEL-908, Cycle 8 — closes a real coverage gap flagged by Cycle 6/the human:
// `hel908-step-card-split.spec.ts`'s "Move step up" interaction only ever
// asserted the step-card COUNT stayed the same afterward, never the actual
// resulting ORDER — a green check that could not have caught (and never did
// catch) trunk-to-trunk reorder being a silent no-op.
//
// This spec asserts real order directly, against the LIVE backend (not a
// mock). Originally written wrapped in `test.fail()` (Cycle 8) while the
// backend gap was open: `PipelineStepRepository.reorderInternal` grouped
// `orderedIds` by each id's EXISTING `parentStepId` before renumbering, so a
// pure trunk (every step with a distinct parent) always saw singleton groups
// and never actually reordered. Cycle 9 fixed this — the human ruled
// "the tail follows its trunk step", and `PipelineStepRepository
// .reorderTrunkInternal` relinks the trunk's `parentStepId` chain itself
// (see design.md decision 15 / non-goal waiver #2). The `test.fail()`
// annotation has been REMOVED and this spec re-run to confirm it is GREEN
// for real (not papered over) — see execution-progress.md Cycle 9 for the
// unwrap confirmation.
test.describe("HEL-908 trunk-to-trunk reorder — real order assertion", () => {
  const CSRF_HEADER = "X-Helio-Requested-With";

  function uniqueEmail(label: string): string {
    return `hel908-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
  }

  test("reordering 3 distinct trunk steps via the UI actually changes their visible order", async ({
    page,
  }) => {
    const email = uniqueEmail("trunk-reorder");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 Reorder E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 Reorder Source",
        type: "static",
        columns: [{ name: "amount", type: "integer" }],
        rows: [[10], [20], [30]],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = await sourceRes.json();

    const pipelineRes = await page.request.post("/api/pipelines", {
      data: {
        name: "HEL-908 Trunk Reorder Verification",
        sourceDataSourceId: source.id,
        outputDataTypeName: "HEL-908 Trunk Reorder Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    // Three DISTINCT op types, so their visible labels ("Limit rows",
    // "Sort rows", "Select fields") let this assertion tell trunk position
    // apart from mere card count -- the exact gap the original spec had.
    const limitRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "limit", config: { count: 2 } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(limitRes.status()).toBe(201);
    const sortRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "sort", config: { sortBy: [{ field: "amount", direction: "asc" }] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sortRes.status()).toBe(201);
    const selectRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "select", config: { columns: ["amount"] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(selectRes.status()).toBe(201);

    await page.goto(`/pipelines/${pipeline.id}`);
    const stepLabels = page.locator(".pipeline-detail-page__step-card-label");
    await expect(stepLabels).toHaveCount(3);

    // Initial trunk order: Limit, Sort, Select.
    await expect(stepLabels.nth(0)).toHaveText("Limit rows");
    await expect(stepLabels.nth(1)).toHaveText("Sort rows");
    await expect(stepLabels.nth(2)).toHaveText("Select fields");

    // Move the LAST step (Select) up twice -> should become the FIRST step.
    // The two clicks must not fire back-to-back: each "Move step up" click
    // triggers an async optimistic-reorder + PUT /steps/order round trip
    // (`usePipelineDetailPage.handleReorderSteps`), and the SECOND click's
    // `nth(1)` locator is re-resolved against whatever the DOM looks like at
    // that instant -- clicking before the first reorder's re-render commits
    // would target the wrong card (a genuine test race, not a product bug;
    // confirmed via a network probe during debugging: the second click sent
    // a `stepIds` request derived from the PRE-first-reorder DOM). Assert
    // the intermediate state after each click so the second click always
    // targets a settled DOM.
    await page.getByRole("button", { name: "Move step up" }).nth(2).click();
    await expect(stepLabels.nth(0)).toHaveText("Limit rows");
    await expect(stepLabels.nth(1)).toHaveText("Select fields");
    await expect(stepLabels.nth(2)).toHaveText("Sort rows");

    await page.getByRole("button", { name: "Move step up" }).nth(1).click();

    // The real assertion this gap needed: actual resulting ORDER, not count.
    // Confirmed GREEN for real (test.fail() removed, see the file-header
    // comment) now that PipelineStepRepository.reorderTrunkInternal relinks
    // the trunk's parentStepId chain instead of reorderInternal's no-op
    // sibling-scoped renumber.
    await expect(stepLabels.nth(0)).toHaveText("Select fields");
    await expect(stepLabels.nth(1)).toHaveText("Limit rows");
    await expect(stepLabels.nth(2)).toHaveText("Sort rows");
  });
});
