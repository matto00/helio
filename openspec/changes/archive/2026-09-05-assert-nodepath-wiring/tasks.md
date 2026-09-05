## 1. Fixture

- [x] 1.1 In `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx`, add a two-root fixture (`TWO_ROOTS`)
      plus its `Step[]`, shaped to cover all FOUR prop-threading edges (design.md Context/D4):
      - root 1's trunk chain, at least two hops deep — edge E1, title site `PipelineRiverView.tsx:381`;
      - a **single-step child lane** off a trunk step — edge E2 (`PipelineRiverView.tsx:461`) and the compact
        title site `LaneColumn.tsx:171`. This is the ONLY shape that renders line 171 at all:
        `RootColumn.tsx:112` hardcodes `isCompact={false}`, so no `RootColumn` fixture can reach it;
      - a **≥2-step child lane** off a trunk step — still edge E2 (a trunk step's child lane renders from
        `:461` whether compact or not), plus the non-compact title site `LaneColumn.tsx:216`;
      - a **lane nested under another lane** — REQUIRED, not an alternative. Edge E4 (`LaneColumn.tsx:146`) sits
        inside `renderChildLanes`, invoked only from within a `LaneColumn` (`:202`, `:243`), so it renders for a
        nested lane and nothing else. Without this shape E4 stays a separately-droppable edge whose removal
        renders `title=undefined` with every gate green;
      - root 2 with its own lane — edge E3 (`PipelineRiverView.tsx:539` → `RootColumn.tsx:114`), carrying the
        distinct `root:root-2` head that a single-root regression cannot produce.
      **Every step in the new fixture must carry a distinct visible label** — D3/task 2.1 locate steps via
      `screen.getByText`, which throws on duplicates.
      **Set `position` explicitly at every branch point:** the continuation child carries `position: 0` and each
      branching child carries `position >= 1`, as this file's own lane fixtures already do (lines 353-355,
      378-379, 400, 424-425). `buildLaneGraph` (`state/stepTree.ts:117-125`) picks the continuation via
      `kids.findIndex((k) => k.position === 0)`, falling back to a *sole* positionless child. Omitting `position`
      therefore fails silently two ways: a lone branch child becomes a trunk continuation (no lane renders, so
      neither `LaneColumn` title site appears), and two positionless children give `continuationIndex === -1`,
      seeding both as lanes and TERMINATING the trunk at their parent — which silently shortens the multi-hop
      chain task 2.3 asserts. Task 1.2's shape probe does not catch this second case.
      Also: the override MUST pass `roots: TWO_ROOTS` **and** `laneGraph: buildLaneGraph(twoRootSteps, TWO_ROOTS)`
      together. `baseProps` (lines 88-90) hardcodes both from `ONE_ROOT` and derives only `steps` from overrides;
      overriding `roots` alone leaves the graph seeded from one root, root 2 gets no lane, and `RootColumn`
      renders its "No steps yet" branch (`RootColumn.tsx:117-121`) — a silently wrong shape with no titles. **Do NOT follow this file's existing
      `stepA`–`stepD` conventions for the new fixture** — they are the trap this ticket exists to avoid. Two
      specific requirements override them:
      - **Each parentless root-head step MUST set `rootId`** (`"root-1"` / `"root-2"`, matching the `PipelineRoot`
        ids), mirroring `state/nodePath.test.ts`'s `step()` helper (`rootId: parentStepId ? undefined : rootId`).
        `types/step.ts:49` declares `rootId?: string` optional and no existing fixture in this file sets it;
        `nodePath()` gates its base case on `rootStepIds.has(id) && step.rootId`, so without it EVERY title
        degrades to the bare-`stepId` fallback — byte-identical to mutation A's replacement, which would make the
        guard green under mutation A.
      - **Set `parentStepId` explicitly on every step in the new fixture, or bypass `linkChain` entirely.**
        `linkChain` (lines 35-43) auto-links any step with `parentStepId === undefined` to the previous array
        element, so routing root 2's parentless head step through it silently chains it onto root 1's tail and
        collapses the fixture to a single root.
- [x] 1.2 Verify the rendered shape before asserting on it (design.md risk 1). Do NOT probe by counting root
      columns: root 1 never renders as one (`extraRoots = roots.slice(1)`) and the "+ root" pseudo-column
      (`PipelineRiverView.tsx:545`) reuses the same class, so a count of two would pass or fail for the wrong
      reason. Probe instead with `screen.getByLabelText("Root: <root-2 dataSourceName>")` (`RootColumn.tsx:78`)
      plus the presence of root 1's trunk steps OUTSIDE it. Confirm both lane branches rendered, using the right
      label for each: non-compact is `aria-label="Lane"` (`LaneColumn.tsx:210`), compact is
      `aria-label="Tail steps"` (`LaneColumn.tsx:165`). Expect MULTIPLE `"Lane"` elements once root 2's lane and
      a ≥2-step trunk child lane both render — use `getAllByLabelText` or scope the query; a "found multiple
      elements" throw here is the fixture being right, not broken. Adjust the fixture — not the assertions — if
      `buildLaneGraph` produces a different shape.

## 2. The wiring guard

- [x] 2.1 Add a `describe("nodePath wiring (HEL-985)")` block. Locate each step under test by its visible label and
      walk to `closest("[title]")` (design.md D3); never `getByTitle`.
- [x] 2.2 Assert the trunk/base case at `PipelineRiverView.tsx:381`'s title site: a step directly on root 1 renders
      the exact full string `root:<root1Id> > <stepId>` (design.md D5).
- [x] 2.3 Assert the multi-level chain: a step two or more hops from its root renders the exact full multi-hop
      string, pinning hop order and the ` > ` separator.
- [x] 2.4 Assert a step's exact `root:`-headed title on EACH remaining edge/site — this is what covers AC2, and
      one assertion per edge is required since each is separately droppable:
      - E2 + compact site `LaneColumn.tsx:171` — the single-step child lane off a trunk step;
      - E2 + non-compact site `LaneColumn.tsx:216` — the ≥2-step child lane off a trunk step;
      - E4 — a step inside the lane NESTED under another lane. Required separately: E4 is the only edge that
        shape exercises, and no trunk child lane reaches it;
      - E3 — a step inside root 2's lane, asserting an exact `root:<root2Id>`-headed path. The distinct root id is
        what makes the two-root requirement load-bearing (design.md D4).
      Use `closest("[title]")` directly (design.md D3). Do NOT reuse the existing `sectionFor()` helper
      (lines 121-127): it queries `.closest(".pipeline-detail-page__step-section")`, which cannot find the compact
      tail-chain site's `.pipeline-detail-page__tail-chain-step` wrapper.

## 3. Mutation evidence (the load-bearing part)

- [x] 3.1 Mutation A — call site. **First, the discrimination check (design.md risk 2):** on the UNMUTATED tree,
      record that the asserted titles are `root:`-headed R5 strings and not bare step ids. Mutation A's replacement
      is byte-identical to `nodePath()`'s unresolvable-data fallback, so without this check a red is
      indistinguishable from a mis-built fixture — it would prove the fixture is broken, not that the wiring is
      gone. Then edit `PipelineRiverView.tsx:294` so the memo still compiles but no longer uses `nodePath`
      (e.g. `entries[step.id] = step.id;`). Run the new tests. Capture the full failing transcript AND the mutated
      diff. Confirm red, and confirm the red is attributable to the wiring.
- [x] 3.2 Revert mutation A. Confirm green.
- [x] 3.3 Mutation B — function logic. Edit `state/nodePath.ts`'s final `join` to emit the stale bare-`root` head
      instead of `root:<rootId>`. Run the new tests. Capture the full failing transcript AND the mutated diff. The
      transcript MUST show a **new** (HEL-985) assertion failing: `state/nodePath.test.ts` already asserts the
      bare-`root` head is never produced and will go red on mutation B regardless, satisfying AC4's letter while
      proving nothing about the new guard. Confirm red on the new guard specifically.
- [x] 3.4 Revert mutation B. Confirm green.
- [x] 3.5 Write both transcripts (each showing its mutated diff and its failing assertion) into the change directory
      as `mutation-evidence.md` so the evaluator and skeptic verify a record, not a claim (AC3, AC4).

## 4. Gates

- [x] 4.1 Confirm the tree is fully reverted: `git diff` shows changes to the test file only, and no edit to
      `PipelineRiverView.tsx`, `LaneColumn.tsx`, `RootColumn.tsx`, or `state/nodePath.ts` (AC5, AC6, design.md D6).
- [x] 4.2 Run and pass the full gate set from the repo root: `npm run lint`, `npm run typecheck`,
      `npm run format:check`, `npm test`.
- [x] 4.3 Commit, and write `files-modified.md` declaring every path touched.
