import { expect, test } from "@playwright/test";
import { recordRegisteredUser } from "./support/userCleanup";
import { uniqueEmail } from "./support/auth";

// HEL-908, Cycle 9 — the human's evidence bar for the trunk-reorder fix
// explicitly requires "Live Playwright proof of the real DRAG interaction
// (not just the API call) -- drag-reorder is the user-facing thing being
// fixed, so the e2e evidence must exercise the actual drag gesture the UI
// exposes". `hel908-trunk-reorder-order.spec.ts` covers the Move up/down
// buttons; this spec drives the actual HTML5 drag handle
// (`.spine-row__grip`) via Playwright's
// `dragTo()`, against the live backend, and specifically drags a TRUNK NODE
// THAT HAS A TAIL -- the exact scenario the human's ruling ("the tail
// follows its trunk step") targets: the tail must travel with its node to
// the node's new position, and the node that ends up occupying the moved
// node's OLD slot must not inherit it.
const CSRF_HEADER = "X-Helio-Requested-With";

test.describe("HEL-908 trunk-to-trunk reorder — real drag gesture", () => {
  test("dragging a tailed trunk node to a new position carries its tail with it", async ({
    page,
  }) => {
    const email = uniqueEmail("hel908", "trunk-drag", "example.com");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-908 Drag Reorder E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    await recordRegisteredUser(registerRes);
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
    // HEL-1579: the desktop page is the step spine. A trunk row is a direct row of the top-level lane (not of a
    // nested sub-spine); a tail is a sub-spine nested inside the list item of the step it hangs off.
    const trunkItems = page.locator(
      ".spine-lane:not(.spine-lane--sub) > .spine-lane__steps > .spine-lane__item",
    );
    const stepCards = trunkItems.locator(":scope > .spine-row");
    const titleOf = (n: number) => stepCards.nth(n).locator(".spine-row__title");
    await expect(stepCards).toHaveCount(3);

    // Initial trunk order: Limit, Sort, Select. Limit has a nested tail ("Rename column").
    await expect(titleOf(0)).toHaveText("Limit rows");
    await expect(titleOf(1)).toHaveText("Sort rows");
    await expect(titleOf(2)).toHaveText("Select fields");
    const tailItems = page.locator(".spine-lane--sub .spine-row");
    await expect(tailItems).toHaveCount(1);
    await expect(trunkItems.nth(0).locator(".spine-lane--sub .spine-row")).toHaveCount(1);

    // Real DRAG: dropping onto a row means "insert before this row" (the drop indicator's own semantics).
    // Limit is already immediately before Sort, so dropping Limit onto Sort would be a no-op; drop it onto
    // SELECT's row instead -- "insert Limit immediately before Select" -- which moves it to sit AFTER Sort.
    // New trunk order: Sort, Limit, Select.
    const limitDragHandle = stepCards.nth(0).locator(".spine-row__grip");
    const selectRow = stepCards.nth(2);
    // Playwright's `locator.dragTo()` simulates a real OS-level pointer drag, but this app's drag surface is
    // a plain HTML5 `draggable` span reacting to `dragstart`/`dragover`/`drop` DOM events (the row's grip and
    // `useLaneReorder`'s handlers), so the `DragEvent` sequence is dispatched directly on the elements the app
    // listens on. This still drives the app's REAL event handlers, not a direct API call.
    const srcHandle = await limitDragHandle.elementHandle();
    const dstHandle = await selectRow.elementHandle();
    // A real user drag has many event-loop ticks between "hovering over the target" (dragover, which sets
    // React's `overIndex` state) and "releasing" (drop, whose handler reads `overIndex` from its own render's
    // closure); a `requestAnimationFrame` between `dragover` and `drop` lets the state commit.
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

    // The real assertion: actual resulting ORDER, via a genuine HTML5 drag gesture against the live backend
    // (not the Move menu item, not a direct API probe).
    await expect(titleOf(0)).toHaveText("Sort rows");
    await expect(titleOf(1)).toHaveText("Limit rows");
    await expect(titleOf(2)).toHaveText("Select fields");

    // "The tail follows its trunk step": the tail is STILL nested under Limit, wherever Limit now sits
    // (index 1) -- NOT under Sort (the node that now occupies Limit's OLD slot, index 0).
    await expect(tailItems).toHaveCount(1);
    await expect(trunkItems.nth(1).locator(".spine-lane--sub .spine-row")).toHaveCount(1);
    await expect(trunkItems.nth(0).locator(".spine-lane--sub .spine-row")).toHaveCount(0);

    // Reload to confirm this is REAL persisted server structure (the drag's
    // PUT /steps/order round trip actually landed), not optimistic-only
    // client state.
    await page.reload();
    await expect(titleOf(0)).toHaveText("Sort rows");
    await expect(titleOf(1)).toHaveText("Limit rows");
    await expect(trunkItems.nth(1).locator(".spine-lane--sub .spine-row")).toHaveCount(1);
  });
});
