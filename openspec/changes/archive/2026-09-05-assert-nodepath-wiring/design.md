## Context

See proposal.md — Why. Grounding facts read from the tree at planning time:

- `PipelineRiverView.tsx:292-296` builds `nodePathByStepId` in a `useMemo` — the sole `nodePath()` call site.
- That lookup reaches the DOM at three distinct `title=` sites, over **four** prop-threading edges. The sites:
  `PipelineRiverView.tsx:381` (the primary-lane `div.pipeline-detail-page__step-section` wrapping each trunk
  `StepCard`), `LaneColumn.tsx:171` (`div.pipeline-detail-page__tail-chain-step`, rendered ONLY on the
  `if (isCompact)` early return at `LaneColumn.tsx:151`) and `LaneColumn.tsx:216` (the lane's own
  `div.pipeline-detail-page__step-section`, the non-compact branch). The edges: (E1) `:381` renders directly from
  the memo; (E2) `PipelineRiverView.tsx:461` passes the prop to a **trunk step's child lanes** — this is E2 regardless of
  whether that lane is compact; (E3) `PipelineRiverView.tsx:539` → `RootColumn.tsx:114` → `LaneColumn`; (E4)
  `LaneColumn.tsx:146` passes it on to a child lane from inside `renderChildLanes`, which is invoked only from
  within a `LaneColumn` (`:202` compact branch, `:243` non-compact branch) — so **E4 renders only for a lane
  nested under another lane**, never for a trunk step's own child lane. E2 and E4 are distinct edges that no `RootColumn` fixture exercises. Note precisely what the risk is:
  `nodePathByStepId` is declared **non-optional** (`LaneColumn.tsx:65`, `RootColumn.tsx:47`), so literally deleting
  an edge is a typecheck failure, not a silent green. The realistic silent regression is threading a **wrong or
  empty** lookup down one edge — which typechecks fine and renders `title=undefined`. The per-edge assertions are
  what catch that.
- **`RootColumn` can never reach the `LaneColumn.tsx:171` site.** `RootColumn.tsx:112` hardcodes
  `isCompact={false}`, and the `isCompact` early return is the only path to line 171. Every step under a
  `RootColumn` takes the line-216 branch. Line 171 renders only for a **single-step child lane**
  (`isCompact={childLane.steps.length === 1}`, at `PipelineRiverView.tsx:460` and `LaneColumn.tsx:144`).
- The two lane containers carry different accessible labels: non-compact is `aria-label="Lane"`
  (`LaneColumn.tsx:210`), compact is `aria-label="Tail steps"` (`LaneColumn.tsx:165`).
- `RootColumn.tsx:78` labels its column `Root: <dataSourceName>`. Root 1 never renders as a root column
  (`extraRoots = roots.slice(1)`), and the "+ root" pseudo-column (`PipelineRiverView.tsx:545`) reuses the same
  `pipeline-detail-page__root-column` class — so counting root columns is not a valid shape probe.
- `PipelineRiverView.test.tsx`'s `baseProps` (lines 88-90) hardcodes `roots: ONE_ROOT` and
  `laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT)`; only `steps` is derived from overrides, and `...overrides`
  is spread last (line 117), so both must be overridden together.
- `nodePath()` returns `root:<rootId> > <id> > <id>` and falls back to the bare `stepId` when a step is
  unresolvable — so an unwired render yields `undefined`, and a *broken-function* render yields a bare id. The
  guard must distinguish both from a correct R5 string.
- `PipelineRiverView.test.tsx` (509 lines) already renders the component directly via `renderWithStore`, with a
  `linkChain()` helper and a single-root `ONE_ROOT` fixture. It mocks `dataSourceService.fetchSources`.

## Goals / Non-Goals

**Goals:**
- A guard whose failure mode is "the wiring is gone", asserted on rendered DOM, not on a return value.
- Two independent, recorded mutation transcripts (call site; function logic) proving the guard is not
  evidence-shaped non-evidence.

**Non-Goals:**
- Asserting on `nodePath()`'s own semantics beyond what the rendered format requires — `nodePath.test.ts` owns that.
- Any E2E, and any change to render behavior, markup, or class names.

## Decisions

**D1 — Extend `PipelineRiverView.test.tsx` rather than add a new file.** It already owns direct rendering of this
component, the `renderWithStore` harness, the `fetchSources` mock and the `linkChain` fixture convention. A new file
would duplicate all four. The new assertions live in their own `describe("nodePath wiring (HEL-985)")` block so the
guard reads as a named regression guard, not as incidental coverage of the reorder tests.

**D2 — Assert via the DOM `title` attribute, matched against a strict R5 regex anchored on the fixture's real root
id** — e.g. `/^root:root-2 > /` plus the exact expected full string. Alternatives rejected: (a) `toBeTruthy()` on
the title — stays green under the function mutation, since a bare-`root` head is still truthy; (b) asserting the
call with `jest.mock` on `nodePath` — that asserts a call happened, not that its result reaches the user, and would
stay green if the result were computed and then dropped before render. Asserting rendered text is the only form
that is red for both mutations.

**D3 — Query by structure, not by `getByTitle`.** Locate the step by its visible label (`screen.getByText("...")`)
then walk to the nearest ancestor carrying `title` via `closest("[title]")`, and assert on that attribute. Using
`getByTitle(expectedPath)` would make the *query itself* the assertion, producing a "unable to find element"
failure that is indistinguishable from an unrelated fixture break; walking from the label gives a real
expected-vs-actual diff and keeps the failure message diagnostic.

**D4 — A two-root fixture with a multi-hop lane, exercising all three title sites.** Root 1 carries a trunk chain
(base case, `PipelineRiverView.tsx:381`) at least two hops deep so the multi-level chain case is covered by a path
with two step ids. Root 2 carries a branch lane so `RootColumn → LaneColumn` renders and both `LaneColumn` title
sites are reachable. Two roots (not one) is required: with a single root the tiebreak is vacuous and a regression
that hard-coded a single root's id would still pass.

**The fixture must cover all four threading edges, not two.** Concretely it needs: root 1's trunk chain (E1,
`:381`); a **single-step child lane** hanging off a trunk step (E2 + the compact `:171` site — the only way that
site renders at all); a **≥2-step child lane** on a trunk step (still E2, plus the non-compact `:216` site); a
**lane nested under another lane** — required, not an alternative, since E4 is a separately-droppable edge that
renders only in this shape; and root 2 with its own lane (E3, via `RootColumn`). Root 2 is what
makes the two-root requirement load-bearing, since its distinct `root:root-2` head cannot be produced by a
single-root regression.

The fixture must NOT be built to this test file's existing `stepA`–`stepD` conventions, which contain two traps
that would each silently make the guard vacuous:

- **`rootId` is optional and unset in every existing fixture** (`types/step.ts:49`; `stepA`–`stepD`). `nodePath()`
  gates its base case on `rootStepIds.has(id) && step.rootId`, so a `rootId`-less fixture makes every title fall
  back to the bare `stepId` — *byte-identical to mutation A's replacement*, leaving the guard green under mutation
  A. Each parentless root-head step must therefore set `rootId` matching its `PipelineRoot` id, exactly as
  `state/nodePath.test.ts`'s `step()` helper does (`rootId: parentStepId ? undefined : rootId`).
- **`linkChain` cannot express a second root.** It auto-links any step with `parentStepId === undefined` to the
  previous array element, so root 2's parentless head step gets chained onto root 1's tail, collapsing the fixture
  to one root and making D5/task 2.4's distinct `root:root-2` head unwritable. Set `parentStepId` explicitly on
  every step in the new fixture, or bypass `linkChain`.

A third trap: **`Step.position` decides trunk-continuation vs. branch, and is optional.** `buildLaneGraph`
(`state/stepTree.ts:117-125`) computes `continuationIndex = kids.findIndex((k) => k.position === 0)`, with one
fallback: a *sole* positionless child becomes the continuation. So a fixture with explicit `parentStepId` but no
`position` misbehaves in two silent ways — a branch step that is its parent's only child becomes a trunk
continuation (no lane renders at all, so neither `LaneColumn` title site appears), and a parent with two
positionless children yields `continuationIndex === -1`, seeding both children as lanes and **terminating the
trunk at the parent**, silently shortening the multi-hop chain D5's exact-string assertion depends on. The rule,
which this test file's own lane fixtures already follow (lines 353-355, 378-379, 400, 424-425): **the continuation
child of every branch point carries `position: 0`, and each branching child carries `position >= 1`.**

A fourth trap: `baseProps` hardcodes `laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT)` alongside
`roots: ONE_ROOT`. Overriding `roots` alone leaves the graph seeded from one root, so root 2 gets no lane and
`RootColumn` renders its "No steps yet" empty branch (`RootColumn.tsx:117-121`) — a silently wrong shape that
renders no titles at all. The override must pass `roots: TWO_ROOTS` **and**
`laneGraph: buildLaneGraph(twoRootSteps, TWO_ROOTS)` together. (`nodePath()`'s tiebreak reads root order from that
same `roots` array, so the two must agree.)

Consequently the shape probe must NOT count root columns: root 1 never renders as one and the "+ root"
pseudo-column shares the class, so a correct fixture yields one real column plus the add column while a collapsed
fixture yields the add column alone — the count check would pass or fail for the wrong reason. Probe instead with
`screen.getByLabelText("Root: <root-2 dataSourceName>")`, plus the presence of root 1's trunk steps outside it.

**D5 — Assert full expected strings, not just the `root:` prefix.** `toBe("root:root-2 > b > d")` pins hop order and
the separator; a prefix-only match would stay green if the tail were dropped.

**D6 — Test-only change.** No `data-testid`, no export, no seam. D3's label-then-`closest("[title]")` query needs
nothing that is not already rendered, so AC6 is satisfied by making zero non-test edits — the strongest form.

## Risks / Trade-offs

- [The lane fixture may not produce the lane shape assumed, since `buildLaneGraph`'s totality sweep gives orphaned
  parentless steps their own singleton lanes] → the executor must verify the rendered shape before asserting
  titles inside it, rather than assuming. Note which label belongs to which branch: a non-compact lane is
  `aria-label="Lane"`, a compact (single-step) lane is `aria-label="Tail steps"` — probing for "Lane" alone would
  miss the compact case entirely, which is the only case that renders the `:171` title site.
- [Mutation (a) could be performed as "delete the whole `useMemo`", which is also a typecheck failure, making the
  red uninformative] → the mutation must keep the code compiling: replace the `nodePath(...)` call's result with a
  plain constant/`step.id` so the guard's redness, not the compiler's, is what is demonstrated.
- [Mutation A's `step.id` replacement is byte-identical to `nodePath()`'s own unresolvable-data fallback, so a red
  could mean "the fixture is malformed" rather than "the wiring is gone"] → a discrimination check is mandatory:
  record, on the unmutated tree, that the asserted titles are `root:`-headed R5 strings and not bare ids, before
  mutation A's red is accepted as meaningful.
- [Mutation B would turn `state/nodePath.test.ts` red on its own — it already asserts the bare-`root` head is never
  emitted — satisfying AC4's letter while proving nothing about the new guard] → mutation B's transcript must show
  a **new** HEL-985 assertion failing, so no later reader can credit AC4 from the pre-existing unit test.
- [A single mutation transcript could be mistaken for both] → the two transcripts must be separately captured, each
  showing the mutated diff and the resulting failing assertion.

## Planner Notes

- Self-approved: `skip_specs: true` in `.openspec.yaml`. No requirement changes; specs describe behavior and this
  change adds none. Inventing a requirement to satisfy validation is explicitly disallowed by the artifact rules.
- Self-approved: no new dependency, no migration (the dev Postgres is shared with concurrent runs HEL-987/HEL-983),
  no backend touch. Nothing in this change goes near any of them.
