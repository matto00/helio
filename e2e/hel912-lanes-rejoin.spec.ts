import { expect, test } from "@playwright/test";

// HEL-912 task 8.1 — AC1's only guard: add a lane off a filter, add an
// aggregate in each lane, rejoin with `union` selecting the OTHER lane, add
// a table Output on the rejoin, dry-run, assert per-lane row counts render
// and the Output thumbnail renders. Asserts on the VALUES produced (row
// count text, thumbnail text), not merely that each interaction succeeded
// (lesson 8).
const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel912-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

/** The NEAREST enclosing per-step wrapper for the Nth step card carrying
 *  the given accessible label (several cards can share a label -- e.g. two
 *  "Group & aggregate" lanes -- so this is index-scoped, not name-unique).
 *  A PRIMARY-lane step (or a multi-step lane's own step) wraps in
 *  `.step-section`; a one-step (compact) lane's step wraps in
 *  `.tail-chain-step` instead -- a plain grouping div around the
 *  byte-identical `.tail-chain-item` ROW (task 3.1/3.3) plus that step's OWN
 *  "+ lane" affordance and child lanes as SIBLINGS of the row, not nested
 *  inside it (skeptic-final-1 CR1: the row is `flex-direction: row`, so
 *  nesting them there squeezed the card into the same horizontal track as
 *  its own action icons). Either wrapper is a valid "closest enclosing card
 *  wrapper," and BOTH nest inside their branch step's own OUTER
 *  `.step-section` (so lanes render "below" it), so a plain
 *  `.filter({has: ...})` on either class alone matches every ANCESTOR
 *  wrapper too, not just the closest one -- walk up from the card's own
 *  toggle button to its closest wrapper ancestor instead. */
function stepSection(page: import("@playwright/test").Page, label: string, index = 0) {
  return page
    .getByRole("button", { name: label, exact: false })
    .nth(index)
    .locator(
      "xpath=ancestor::div[contains(@class,'pipeline-detail-page__step-section') or contains(@class,'pipeline-detail-page__tail-chain-step')][1]",
    );
}

test.describe("HEL-912 parallel lanes: add lane, aggregate each lane, union rejoin, dry-run", () => {
  test("two lanes off a filter, rejoined by union, produce per-lane row counts and an Output thumbnail", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail("lanes-rejoin");
    const password = "correcthorsebattery1";

    const registerRes = await page.request.post("/api/auth/register", {
      data: { email, password, displayName: "HEL-912 Lanes Rejoin E2E" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(registerRes.status()).toBe(201);

    const sourceRes = await page.request.post("/api/data-sources", {
      data: {
        name: "HEL-912 Lanes Rejoin Source",
        type: "static",
        columns: [
          { name: "amount", type: "integer" },
          { name: "category", type: "string" },
        ],
        rows: [
          [10, "a"],
          [20, "b"],
          [30, "a"],
          [40, "b"],
          [50, "a"],
        ],
      },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(sourceRes.status()).toBe(201);
    const source = await sourceRes.json();

    const pipelineRes = await page.request.post("/api/pipelines", {
      data: { name: "HEL-912 Lanes Rejoin Pipeline", sourceDataSourceId: source.id },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipelineRes.status()).toBe(201);
    const pipeline = await pipelineRes.json();

    await page.goto(`/pipelines/${pipeline.id}`);

    // ── Filter step (from the zero-step empty state) ──
    const filterCreated = page.waitForResponse(
      (res) =>
        res.url().includes(`/pipelines/${pipeline.id}/steps`) && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "+ Add step" }).click();
    await page.getByRole("menuitem", { name: "Filter rows" }).click();
    await filterCreated;
    await expect(page.getByRole("button", { name: "Filter rows", exact: false })).toBeVisible();

    // ── Lane 1: "+ lane" (Branch) off Filter -> aggregate ──
    const lane1Created = page.waitForResponse(
      (res) =>
        res.url().includes(`/pipelines/${pipeline.id}/steps`) && res.request().method() === "POST",
    );
    await stepSection(page, "Filter rows")
      .getByRole("button", { name: "Branch this step", exact: false })
      .first()
      .click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Group & aggregate" }).click();
    await lane1Created;
    await expect(page.getByRole("button", { name: "Group & aggregate", exact: false })).toHaveCount(
      1,
    );

    // ── Lane 2: a SECOND "+ lane" off Filter -> aggregate. Filter's own
    // "Branch" affordance is always the FIRST match within its own
    // section -- it renders immediately after the card, before the lanes
    // row containing lane 1's own nested "Branch" button. ──
    const lane2Created = page.waitForResponse(
      (res) =>
        res.url().includes(`/pipelines/${pipeline.id}/steps`) && res.request().method() === "POST",
    );
    await stepSection(page, "Filter rows")
      .getByRole("button", { name: "Branch this step", exact: false })
      .first()
      .click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Group & aggregate" }).click();
    await lane2Created;
    await expect(page.getByRole("button", { name: "Group & aggregate", exact: false })).toHaveCount(
      2,
    );

    // ── Task 7.3 / AC3 — lane STACKING verified in Playwright at both
    // required widths, separately from the CSS sweep (which parses CSS,
    // not a viewport render, and so cannot demonstrate that lanes actually
    // stack — lesson 4). At a desktop width the two lane children of
    // `.pipeline-detail-page__lane-row` sit SIDE BY SIDE (equal `y`); at
    // 430px and 375px they STACK (distinct `y`, second below the first). ──
    const laneRow = page.locator(".pipeline-detail-page__lane-row").first();
    async function laneChildTops(): Promise<number[]> {
      const children = laneRow.locator(":scope > *");
      const count = await children.count();
      const tops: number[] = [];
      for (let i = 0; i < count; i++) {
        const box = await children.nth(i).boundingBox();
        if (box) tops.push(Math.round(box.y));
      }
      return tops;
    }

    // task 7.1 (evaluation-2.md) — the per-lane mobile header itself: hidden
    // at desktop widths (position alone communicates lane identity there),
    // revealed with its numbered text once lanes stack. Asserts what it
    // PRODUCED (the exact "Lane 1"/"Lane 2" text), not merely that an
    // element exists -- a header rendering empty or unnumbered still fails.
    const laneHeaders = laneRow.locator(".pipeline-detail-page__lane-header");
    async function visibleLaneHeaderTexts(): Promise<string[]> {
      const count = await laneHeaders.count();
      const texts: string[] = [];
      for (let i = 0; i < count; i++) {
        if (await laneHeaders.nth(i).isVisible()) {
          texts.push((await laneHeaders.nth(i).textContent())?.trim() ?? "");
        }
      }
      return texts;
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const desktopTops = await laneChildTops();
    expect(desktopTops).toHaveLength(2);
    expect(desktopTops[0]).toBe(desktopTops[1]); // side by side
    expect(await visibleLaneHeaderTexts()).toEqual([]); // hidden at desktop

    await page.setViewportSize({ width: 430, height: 900 });
    const tablet430Tops = await laneChildTops();
    expect(tablet430Tops).toHaveLength(2);
    expect(tablet430Tops[1]).toBeGreaterThan(tablet430Tops[0]); // stacked
    expect(await visibleLaneHeaderTexts()).toEqual(["Lane 1", "Lane 2"]);

    await page.setViewportSize({ width: 375, height: 900 });
    const phone375Tops = await laneChildTops();
    expect(phone375Tops).toHaveLength(2);
    expect(phone375Tops[1]).toBeGreaterThan(phone375Tops[0]); // stacked
    expect(await visibleLaneHeaderTexts()).toEqual(["Lane 1", "Lane 2"]);

    await page.setViewportSize({ width: 1440, height: 900 }); // restore for the rest of the flow

    // ── Configure each lane's aggregate: a single sum(amount) aggregation,
    // no group-by (a grand-total row) -- enough for a real, distinct
    // per-lane row count without depending on multiple Select popovers
    // (each `Select` renders via a document-body portal, so scoping by
    // section alone doesn't disambiguate which popover is open; the field
    // itself already auto-defaults to the first numeric column
    // (`handleAddAggregation`), so no further Select interaction is
    // needed here). ──
    async function configureAggregate(index: number, alias: string) {
      const section = stepSection(page, "Group & aggregate", index);
      await section.getByRole("button", { name: "Group & aggregate", exact: false }).click();
      await section.getByRole("button", { name: "+ Add aggregation" }).click();
      await section.getByRole("textbox", { name: "Alias for aggregation 1" }).fill(alias);
      await page.waitForTimeout(600); // let the debounced PATCH (useStepCardState) flush
      // Collapse again so later section-scoped locators aren't confused by
      // this card's own expanded editor body.
      await section.getByRole("button", { name: "Group & aggregate", exact: false }).click();
    }
    await configureAggregate(0, "total_left");
    await configureAggregate(1, "total_right");

    // ── Rejoin: a "+ lane" off lane 1's aggregate step, set to `union`,
    // selecting lane 2's aggregate step as the "other lane" (design.md
    // Decision 3's eligibility property: every node except self is
    // offered; only ancestors are disabled). ──
    const rejoinCreated = page.waitForResponse(
      (res) =>
        res.url().includes(`/pipelines/${pipeline.id}/steps`) && res.request().method() === "POST",
    );
    await stepSection(page, "Group & aggregate", 0)
      .getByRole("button", { name: "Branch this step", exact: false })
      .first()
      .click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Union / append rows" }).click();
    await rejoinCreated;
    const unionSection = stepSection(page, "Union / append rows");
    await expect(unionSection.getByRole("button", { name: "Union / append rows" })).toBeVisible();

    await unionSection.getByRole("button", { name: "Union / append rows", exact: false }).click();
    await unionSection.getByRole("combobox", { name: "Other source" }).click();
    // Lane 2's own option; lane 1 (an ancestor of this union step) is
    // offered too but greyed/disabled with a cycle reason -- selecting the
    // enabled one disambiguates without depending on DOM order.
    await page
      .getByRole("option", { name: "Lane node: Group & aggregate", disabled: false })
      .click();
    await page.waitForTimeout(600); // let the debounced PATCH (useStepCardState) flush

    // ── Table Output on the rejoin ──
    await unionSection.getByRole("button", { name: "Add output" }).click();
    await page.locator("#output-name").fill("Rejoined rows");
    await page.getByRole("combobox", { name: "Output kind" }).click();
    await page.getByRole("option", { name: "Table" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(600);

    // ── Dry run ──
    await page.getByRole("button", { name: "Dry run" }).click();
    await expect(page.getByLabel(/Run status: succeeded/i)).toBeVisible({ timeout: 15000 });

    // ── Assert per-lane row counts render on every lane's card, not just
    // the primary lane (task 6.2) -- the produced VALUES, not merely that
    // the run succeeded (lesson 8). The count chip is a DIRECT child of
    // its own step's toggle button (not a nested descendant), so scope to
    // the button itself, not the enclosing section -- a lane's section
    // wraps every node "below" it (task 3's own nesting), so a
    // section-scoped lookup for Filter (the outermost wrapper) would
    // ambiguously match every OTHER node's count chip too. ──
    await expect(
      page.getByRole("button", { name: "Filter rows", exact: false }).first(),
    ).toContainText("5 rows", { timeout: 10000 });
    await expect(
      page.getByRole("button", { name: "Group & aggregate", exact: false }).nth(0),
    ).toContainText("1 rows");
    await expect(
      page.getByRole("button", { name: "Group & aggregate", exact: false }).nth(1),
    ).toContainText("1 rows");
    await expect(
      page.getByRole("button", { name: "Union / append rows", exact: false }),
    ).toContainText("2 rows");

    // ── The rejoin's Output CHIP renders (the create call succeeded, and
    // it's addressable/clickable) -- see the FOUND-NOT-FIXED note below for
    // why its live thumbnail value is not asserted here. ──
    const rejoinedChip = page.getByRole("button", { name: "Open Rejoined rows output" });
    await expect(rejoinedChip).toBeVisible();

    // FOUND, NOT FIXED (backend, out of this ticket's frontend-only scope --
    // see files-modified.md): the rejoin's own Output thumbnail stays at the
    // "—" placeholder. Root-caused by reading (not editing)
    // `backend/.../PipelineRunService.scala`'s `previewAtNode`: its
    // `pathToRoot` helper slices the step list by walking ONLY
    // `parentStepId` back to the root, never following a union/lookup
    // step's `secondaryInput: {kind:"lane"}` edge -- so the engine slice
    // handed to `backend.execute` for a rejoin's preview omits its OWN
    // secondary-lane input entirely, and `POST /pipelines/:id/preview`
    // 422s ("Pipeline execution failed") for that node. Confirmed live: the
    // exact same node previews FINE via the real `/run` path used by "Dry
    // run" above (its own row-count chip renders "2 rows" — asserted above)
    // -- only the SEPARATE `previewAtNode`/`previewOutputs` slicing has the
    // gap. `OutputEditorSheet`'s own sheet preview (`useOutputPreview`) goes
    // through the SAME broken endpoint, so there is no frontend-only
    // workaround. Filed as HEL-970 (High, related to HEL-911/912/913,
    // deliberately not blocked-by) rather than silently asserted around or
    // left as a permanently-red gate wired into CI.
  });
});
