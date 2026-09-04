import { expect, test } from "@playwright/test";

// HEL-908, Cycle 8 — live proof for the "+ tail" create affordance restored
// on top of the new backend `attachTailInternal` primitive (design.md's
// non-goal waiver). This is the EXACT probe shape that exposed the original
// Cycle 6 defect: two trunk steps, add a tail off the FIRST one, assert the
// result is nested/indented as a tail (`.pipeline-detail-page__tail-chain-item`)
// — NOT three top-level trunk cards, which is what the pre-fix
// `spliceInsertAtInternal`-routed create used to produce.
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel908-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-908 tail-attach live verification", () => {
  test("adding a tail off the first of two trunk steps nests it, not a third trunk card", async ({
    page,
  }) => {
    const email = uniqueEmail("tail-attach");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 Tail Attach E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 Tail Attach Source",
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
        name: "HEL-908 Tail Attach Verification",
        roots: [{ sourceId: source.id }],
        outputDataTypeName: "HEL-908 Tail Attach Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    // Two trunk steps: Limit -> Sort.
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

    await page.goto(`/pipelines/${pipeline.id}`);
    // Scoped to exclude tail items: `StepCard` is reused inside `TailChain`
    // with the same base `step-card` class, but a tail card ALSO carries the
    // `--tail` modifier (`StepCard`'s `isTail` prop) that a top-level trunk
    // card never does — this counts only TOP-LEVEL trunk cards, the exact
    // distinction the original bug erased.
    const stepCards = page.locator(
      ".pipeline-detail-page__step-card:not(.pipeline-detail-page__step-card--tail)",
    );
    await expect(stepCards).toHaveCount(2);
    // Only trunk cards render an "Add tail step" button; two trunk steps ->
    // two visible affordances (neither has a tail yet).
    await expect(page.getByRole("button", { name: "Add tail step" })).toHaveCount(2);

    // Add a tail off the FIRST trunk step (Limit).
    await page.getByRole("button", { name: "Add tail step" }).first().click();
    await page.getByRole("menuitem", { name: "Select fields" }).click();

    // The trunk card COUNT must stay 2 — the new step is NOT a third
    // top-level trunk card (the exact defect this ticket's Cycle 6 caught).
    await expect(stepCards).toHaveCount(2);

    // The new step is nested as a genuine tail item.
    const tailItems = page.locator(".pipeline-detail-page__tail-chain-item");
    await expect(tailItems).toHaveCount(1);
    await expect(tailItems.first().locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Select fields",
    );

    // The tail now exists off Limit -> its "Add tail step" button disappears
    // (single-tail-per-node enforcement); Sort (no tail) keeps its own.
    await expect(page.getByRole("button", { name: "Add tail step" })).toHaveCount(1);

    // Reload to confirm this is REAL persisted server structure, not
    // optimistic-only client state.
    await page.reload();
    await expect(stepCards).toHaveCount(2);
    const tailItemsAfterReload = page.locator(".pipeline-detail-page__tail-chain-item");
    await expect(tailItemsAfterReload).toHaveCount(1);
    await expect(
      tailItemsAfterReload.first().locator(".pipeline-detail-page__step-card-label"),
    ).toHaveText("Select fields");

    // Sort's trunk position is preserved (NOT reparented onto the new tail) —
    // the top-level Limit -> Sort trunk chain is still intact, both still
    // top-level cards.
    await expect(stepCards.nth(0).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Limit rows",
    );
    await expect(stepCards.nth(1).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Sort rows",
    );
  });

  // evaluation-2.md CR9 — surfaced by, and newly reachable because of, CR1's
  // own leaf-anchor fix: attach a tail off a LEAF anchor, then append a NEW
  // trunk step after that same anchor. The backend's `spliceInsertAtInternal`
  // reparents the anchor's existing child (the tail) onto the new trunk step
  // server-side, but `usePipelineDetailPage`'s create handlers used to patch
  // only the newly-created element into local state, leaving every OTHER
  // step's now-stale `parentStepId` feeding `buildStepTree`. This asserts the
  // tail renders under its TRUE new owner immediately, with no reload.
  test("a leaf tail follows its true owner after a later trunk-append, without reload", async ({
    page,
  }) => {
    const email = uniqueEmail("cr9-trunk-append");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 CR9 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 CR9 Source",
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
        name: "HEL-908 CR9 Verification",
        roots: [{ sourceId: source.id }],
        outputDataTypeName: "HEL-908 CR9 Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    // A single leaf trunk step (Filter).
    const filterRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "filter", config: { conditions: [] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(filterRes.status()).toBe(201);

    await page.goto(`/pipelines/${pipeline.id}`);

    // Attach a tail (Group & aggregate) off the leaf.
    await page.getByRole("button", { name: "Add tail step" }).first().click();
    await page.getByRole("menuitem", { name: "Group & aggregate" }).click();
    await expect(page.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);

    // Append a NEW trunk step (Sort) after the same node — the backend
    // reparents the aggregate tail onto Sort.
    await page.getByRole("button", { name: "+ Add transformation step" }).click();
    await page.getByRole("menuitem", { name: "Sort rows" }).click();

    const stepCards = page.locator(
      ".pipeline-detail-page__step-card:not(.pipeline-detail-page__step-card--tail)",
    );
    await expect(stepCards).toHaveCount(2);

    // Without any reload: the tail must render under Sort's section, not
    // Filter's — matching the persisted `parentStepId`.
    const sections = page.locator(".pipeline-detail-page__step-section");
    await expect(sections.nth(0).locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(0);
    await expect(sections.nth(1).locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);
  });

  // evaluation-3.md CR10 — `handleDuplicateStep` has the identical CR9
  // defect: `PipelineService.duplicateStep` routes through the same
  // server-side `spliceInsertAtInternal` reparenting primitive as a trunk
  // splice-insert, so duplicating a tailed trunk step reparents that tail
  // onto the clone. The old handler patched only the clone into local state,
  // leaving the tail's stale `parentStepId` render the clone AS a tail branch
  // off the original, and the real tail promoted to a top-level trunk card —
  // until reload. This asserts the correct tree immediately, with no reload.
  test("duplicating a tailed trunk step keeps the tail on the clone, without reload", async ({
    page,
  }) => {
    const email = uniqueEmail("cr10-duplicate");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 CR10 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 CR10 Source",
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
        name: "HEL-908 CR10 Verification",
        roots: [{ sourceId: source.id }],
        outputDataTypeName: "HEL-908 CR10 Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    // A single leaf trunk step (Filter) that will own a tail.
    const filterRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "filter", config: { conditions: [] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(filterRes.status()).toBe(201);

    await page.goto(`/pipelines/${pipeline.id}`);

    // Attach a tail (Group & aggregate) off Filter.
    await page.getByRole("button", { name: "Add tail step" }).first().click();
    await page.getByRole("menuitem", { name: "Group & aggregate" }).click();
    await expect(page.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);

    const stepCards = page.locator(
      ".pipeline-detail-page__step-card:not(.pipeline-detail-page__step-card--tail)",
    );
    await expect(stepCards).toHaveCount(1);

    // Duplicate the trunk owner of the tail (Filter).
    await stepCards.first().getByRole("button", { name: "Duplicate step" }).click();

    // Without any reload: 2 top-level trunk cards (Filter, its clone), and
    // exactly 1 tail item — attached to the CLONE's section, not rendered as
    // a tail branch off the original, and the aggregate must NOT be promoted
    // to a top-level trunk card.
    await expect(stepCards).toHaveCount(2);
    await expect(page.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);

    const sections = page.locator(".pipeline-detail-page__step-section");
    await expect(sections.nth(0).locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(0);
    await expect(sections.nth(1).locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);
    await expect(
      sections
        .nth(1)
        .locator(".pipeline-detail-page__tail-chain-item .pipeline-detail-page__step-card-label"),
    ).toHaveText("Group & aggregate");
  });

  // evaluation-4.md CR11 — `handleRemoveStep` has the identical CR9/CR10
  // defect, but on the delete path: `PipelineStepRepository.deleteInternal`
  // reparents the deleted step's HEAD child onto the deleted step's own
  // parent AND cascade-deletes every other child's entire descendant
  // subtree (any tail). The old handler patched local state with a bare
  // `.filter()` removing only the clicked step, so a step that owns BOTH a
  // head (trunk-continuation) child and a tail rendered the cascade-deleted
  // tail as a live top-level trunk card — a phantom for a row that no
  // longer exists server-side at all — until reload. This asserts the
  // correct, post-cascade tree immediately, with no reload.
  test("removing a step that owns both a head child and a tail drops the cascade-deleted tail, without reload", async ({
    page,
  }) => {
    const email = uniqueEmail("cr11-remove");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 CR11 E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 CR11 Source",
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
        name: "HEL-908 CR11 Verification",
        roots: [{ sourceId: source.id }],
        outputDataTypeName: "HEL-908 CR11 Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    // Trunk: Filter -> Sort. Filter (the step we'll delete) also owns a
    // Group & aggregate tail, so the delete hits BOTH server-side mutations
    // at once: Sort (the head child) gets reparented onto Filter's own
    // parent (null, i.e. becomes the new trunk root), and the aggregate
    // tail (Filter's other child) gets cascade-deleted outright.
    const filterRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "filter", config: { conditions: [] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(filterRes.status()).toBe(201);
    const sortRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "sort", config: { sortBy: [{ field: "amount", direction: "asc" }] } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sortRes.status()).toBe(201);

    await page.goto(`/pipelines/${pipeline.id}`);

    const stepCards = page.locator(
      ".pipeline-detail-page__step-card:not(.pipeline-detail-page__step-card--tail)",
    );
    await expect(stepCards).toHaveCount(2);

    // Attach a tail (Group & aggregate) off Filter — the FIRST trunk card.
    await page.getByRole("button", { name: "Add tail step" }).first().click();
    await page.getByRole("menuitem", { name: "Group & aggregate" }).click();
    await expect(page.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);
    await expect(stepCards).toHaveCount(2);

    // Remove Filter — the owner of BOTH the head child (Sort) and the tail
    // (Group & aggregate). The remove button only renders once the card is
    // expanded.
    await stepCards
      .first()
      .getByRole("button", { name: /Filter rows/i })
      .click();
    await stepCards.first().getByRole("button", { name: "Remove step" }).click();

    // Without any reload: exactly ONE trunk card must remain (Sort, now the
    // new trunk root), and the cascade-deleted aggregate tail must be GONE
    // from the DOM entirely — not rendered as a live top-level trunk card,
    // which is the exact phantom-node defect this asserts against.
    await expect(stepCards).toHaveCount(1);
    await expect(stepCards.first().locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Sort rows",
    );
    await expect(page.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(0);
    await expect(page.getByText("Group & aggregate")).toHaveCount(0);

    // Reload to confirm this matches persisted server truth, not just a
    // lucky optimistic render.
    await page.reload();
    await expect(stepCards).toHaveCount(1);
    await expect(stepCards.first().locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Sort rows",
    );
    await expect(page.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(0);
  });
});
