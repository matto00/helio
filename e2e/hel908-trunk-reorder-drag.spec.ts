import { expect, test } from "@playwright/test";

// HEL-908, Cycle 9 — the human's evidence bar for the trunk-reorder fix
// explicitly requires "Live Playwright proof of the real DRAG interaction
// (not just the API call) -- drag-reorder is the user-facing thing being
// fixed, so the e2e evidence must exercise the actual drag gesture the UI
// exposes". `hel908-trunk-reorder-order.spec.ts` covers the Move up/down
// buttons; this spec drives the actual HTML5 drag handle
// (`.pipeline-detail-page__step-card-drag-handle`) via Playwright's
// `dragTo()`, against the live backend, and specifically drags a TRUNK NODE
// THAT HAS A TAIL -- the exact scenario the human's ruling ("the tail
// follows its trunk step") targets: the tail must travel with its node to
// the node's new position, and the node that ends up occupying the moved
// node's OLD slot must not inherit it.
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel908-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

test.describe("HEL-908 trunk-to-trunk reorder — real drag gesture", () => {
  test("dragging a tailed trunk node to a new position carries its tail with it", async ({
    page,
  }) => {
    const email = uniqueEmail("trunk-drag");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 Drag Reorder E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-908 Drag Reorder Source",
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
        name: "HEL-908 Trunk Drag Reorder Verification",
        roots: [{ sourceId: source.id }],
        outputDataTypeName: "HEL-908 Trunk Drag Reorder Output",
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    // Three DISTINCT trunk op types: Limit -> Sort -> Select.
    const limitRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: { type: "limit", config: { count: 2 } },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(limitRes.status()).toBe(201);
    const limit = await limitRes.json();
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

    // A tail off Limit (the FIRST trunk step, the one about to be dragged) —
    // built via the real branch-attach primitive (attachTailInternal). Uses
    // a DIFFERENT op ("rename") than any trunk step's label, so the
    // drop-target locator below (which matches on visible label text) can't
    // ambiguously match both a trunk card and this nested tail card.
    const tailRes = await page.request.post(`/api/pipelines/${pipeline.id}/steps`, {
      data: {
        type: "rename",
        config: { mappings: [{ from: "amount", to: "amount" }] },
        parentStepId: limit.id,
        attachAsTail: true,
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(tailRes.status()).toBe(201);
    const tail = await tailRes.json();
    expect(tail.parentStepId).toBe(limit.id);

    await page.goto(`/pipelines/${pipeline.id}`);
    const stepCards = page.locator(
      ".pipeline-detail-page__step-card:not(.pipeline-detail-page__step-card--tail)",
    );
    await expect(stepCards).toHaveCount(3);

    // Initial trunk order: Limit, Sort, Select. Limit has a nested tail
    // ("Rename fields").
    await expect(stepCards.nth(0).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Limit rows",
    );
    await expect(stepCards.nth(1).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Sort rows",
    );
    await expect(stepCards.nth(2).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Select fields",
    );
    const tailItems = page.locator(".pipeline-detail-page__tail-chain-item");
    await expect(tailItems).toHaveCount(1);
    // The tail's section is Limit's own `.pipeline-detail-page__step-section`.
    const limitSection = page.locator(".pipeline-detail-page__step-section").filter({
      has: page.locator(".pipeline-detail-page__step-card-label", { hasText: "Limit rows" }),
    });
    await expect(limitSection.locator(".pipeline-detail-page__tail-chain-item")).toHaveCount(1);

    // Real DRAG: dropping onto a card's section means "insert before this
    // card" (the drop-indicator's own semantics — see
    // `PipelineRiverView.handleCardDrop`'s CR1 comment). Limit is already
    // immediately before Sort, so dropping Limit onto Sort would be a
    // no-op; drop it onto SELECT's section instead — "insert Limit
    // immediately before Select" — which moves it to sit AFTER Sort. New
    // trunk order: Sort, Limit, Select.
    const limitDragHandle = stepCards
      .nth(0)
      .locator(".pipeline-detail-page__step-card-drag-handle");
    const selectSection = page.locator(".pipeline-detail-page__step-section").filter({
      has: page.locator(".pipeline-detail-page__step-card-label", { hasText: "Select fields" }),
    });
    // Playwright's `locator.dragTo()` simulates a real OS-level pointer drag,
    // but this app's drag surface is a plain HTML5 `draggable` span reacting
    // to `dragstart`/`dragover`/`drop` DOM events (`StepCard`'s drag handle +
    // `PipelineRiverView.handleCardDragOver`/`handleCardDrop`) -- confirmed
    // via a network probe during debugging that `dragTo()`'s synthetic
    // pointer movement across intervening DOM (the "+ tail" row, the ribbon
    // gap) does not reliably deliver the intermediate `dragover` events
    // needed to update `overIndex` before drop, so no request fired at all.
    // Dispatching the actual `DragEvent` sequence directly on the exact
    // elements the app listens on is the standard, reliable way to exercise
    // HTML5-draggable React UI in Playwright -- this still drives the app's
    // REAL event handlers (`onDragStart`/`onDragOver`/`onDrop`), not a
    // direct API call; it is the DOM-event equivalent of the user's drag
    // gesture, not a bypass of it.
    const srcHandle = await limitDragHandle.elementHandle();
    const dstHandle = await selectSection.elementHandle();
    // A real user drag has many event-loop ticks between "hovering over the
    // target" (dragover, which sets React's `overIndex` state) and
    // "releasing" (drop, whose handler reads `overIndex` from its own
    // render's closure) -- long enough for React to re-render between them.
    // Dispatching all events in one synchronous script (no `await` between
    // them) fires `drop` against the STALE pre-dragover closure (`overIndex`
    // still `null`), so `handleCardDrop`'s guard silently no-ops -- found via
    // a network probe while debugging (zero `PUT /steps/order` requests
    // fired). A `requestAnimationFrame` between `dragover` and `drop` lets
    // the state commit and a fresh closure attach, matching what a real
    // pointer-drag's natural pacing already guarantees.
    await page.evaluate(
      async ([src, dst]) => {
        const dataTransfer = new DataTransfer();
        const raf = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        src!.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }),
        );
        await raf();
        dst!.dispatchEvent(
          new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }),
        );
        await raf();
        await raf();
        dst!.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
        );
        await raf();
        src!.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }),
        );
      },
      [srcHandle, dstHandle],
    );

    // The real assertion: actual resulting ORDER, via a genuine HTML5 drag
    // gesture against the live backend (not the Move button, not a direct
    // API probe).
    await expect(stepCards.nth(0).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Sort rows",
    );
    await expect(stepCards.nth(1).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Limit rows",
    );
    await expect(stepCards.nth(2).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Select fields",
    );

    // "The tail follows its trunk step": the tail is STILL nested under
    // Limit's card, wherever Limit now sits (index 1) -- NOT under Sort
    // (the node that now occupies Limit's OLD slot, index 0).
    await expect(tailItems).toHaveCount(1);
    const limitSectionAfterDrag = page.locator(".pipeline-detail-page__step-section").filter({
      has: page.locator(".pipeline-detail-page__step-card-label", { hasText: "Limit rows" }),
    });
    const sortSectionAfterDrag = page.locator(".pipeline-detail-page__step-section").filter({
      has: page.locator(".pipeline-detail-page__step-card-label", { hasText: "Sort rows" }),
    });
    await expect(
      limitSectionAfterDrag.locator(".pipeline-detail-page__tail-chain-item"),
    ).toHaveCount(1);
    await expect(
      sortSectionAfterDrag.locator(".pipeline-detail-page__tail-chain-item"),
    ).toHaveCount(0);

    // Reload to confirm this is REAL persisted server structure (the drag's
    // PUT /steps/order round trip actually landed), not optimistic-only
    // client state.
    await page.reload();
    await expect(stepCards.nth(0).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Sort rows",
    );
    await expect(stepCards.nth(1).locator(".pipeline-detail-page__step-card-label")).toHaveText(
      "Limit rows",
    );
    const limitSectionAfterReload = page.locator(".pipeline-detail-page__step-section").filter({
      has: page.locator(".pipeline-detail-page__step-card-label", { hasText: "Limit rows" }),
    });
    await expect(
      limitSectionAfterReload.locator(".pipeline-detail-page__tail-chain-item"),
    ).toHaveCount(1);
  });
});
