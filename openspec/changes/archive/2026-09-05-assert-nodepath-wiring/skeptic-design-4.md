## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Every load-bearing render-topology claim in design.md was checked against the source in this
worktree, not against the plan's narrative.

- **Sole call site.** `grep -n "nodePath(step.id"` → `PipelineRiverView.tsx:294` only. Matches D1/task 3.1.
- **Three title sites, exact lines.** `grep -n "title={nodePathByStepId"` →
  `PipelineRiverView.tsx:381`, `LaneColumn.tsx:171`, `LaneColumn.tsx:216`. All three cited line
  numbers are exact.
- **Four threading edges, exact lines.** `nodePathByStepId={nodePathByStepId}` →
  `PipelineRiverView.tsx:461` (E2, trunk step's child lanes), `:539` (E3, `RootColumn`),
  `RootColumn.tsx:114`, `LaneColumn.tsx:146` (E4). `renderChildLanes(step)` is invoked only at
  `LaneColumn.tsx:202` and `:243` — both inside `LaneColumn` — so the design's claim that E4
  renders *only* for a lane nested under another lane is correct.
- **`:171` is compact-only and unreachable from `RootColumn`.** `LaneColumn.tsx:165` is inside the
  `if (isCompact)` early return; `RootColumn.tsx` passes `isCompact={false}` (read at `:112`, in the
  `<LaneColumn>` block I read in full). Confirmed.
- **Labels.** `aria-label="Tail steps"` at `LaneColumn.tsx:165`, `aria-label="Lane"` at `:210`,
  `Root: ${root.dataSourceName}` at `RootColumn.tsx:78`, empty branch "No steps yet" present.
- **Root-column counting really is an invalid probe.** `extraRoots = roots.slice(1)` at
  `PipelineRiverView.tsx:325`; the add pseudo-column reuses `pipeline-detail-page__root-column`.
  Task 1.2's substitute probe is sound.
- **`rootId` trap is real.** `types/step.ts:49` declares `rootId?: string`. `nodePath`'s base case
  is gated on `rootStepIds.has(currentId) && step.rootId`, and the fallback is `return stepId` — so a
  `rootId`-less fixture yields bare ids, byte-identical to mutation A's replacement. `buildLaneGraph`
  independently routes root steps via `s.rootId && knownRootIds.has(s.rootId)`, so the same omission
  also collapses root 2's lane. Task 1.1's mandate is correct and load-bearing.
- **`linkChain` trap is real.** Lines 35-43 auto-link any step with `parentStepId === undefined` to
  the previous array element — root 2's head would be chained onto root 1's tail. Confirmed.
- **`baseProps` trap is real.** Lines 88-90 hardcode `roots: ONE_ROOT` and
  `laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT)`; only `steps` derives from overrides, and
  `...overrides` is spread last. Both must be overridden together, as tasks say.
- **`position` trap is real.** `stepTree.ts` computes the continuation via a `position === 0` find
  with a sole-positionless-child fallback (read the surrounding block). The two silent failure modes
  the design names follow from that code.
- **D3's query is safe.** I read `StepCard.tsx:200-300`: the label lives in a
  `span.pipeline-detail-page__step-card-label` inside a toggle `<button>` that carries **no** `title`;
  the only `title` attributes in the card are on the sibling Move/Enable/Duplicate buttons in the
  actions cluster, which are not ancestors of the label. So `closest("[title]")` from the label
  resolves to the wrapper the wiring writes — the query cannot silently latch onto an unrelated title.
- **Both mutations are genuinely discriminating.** Mutation A (`entries[step.id] = step.id`) turns
  every asserted exact string into a bare id → red; the mandated pre-mutation discrimination check
  (task 3.1) separates "wiring gone" from "fixture malformed", which is exactly the confound that
  reading `nodePath.ts`'s fallback exposes. Mutation B (bare `root` head) turns the exact-string
  assertions red, and task 3.3 explicitly requires the transcript to show a **new** HEL-985 assertion
  failing so AC4 cannot be credited from the pre-existing `nodePath.test.ts`. D5's exact-string
  assertion (not a prefix, not `toBeTruthy`) is what makes both reds real.
- **AC coverage.** AC1→tasks 2.2/2.3; AC2→task 2.4 (one assertion per remaining edge/site);
  AC3→3.1/3.5; AC4→3.3/3.5; AC5→3.2/3.4/4.1/4.2; AC6→D6 (zero non-test edits) + task 4.1's
  `git diff` check. No AC is uncovered, and no task exceeds the ticket's scope.

I found no defect that would let a vacuous or wrong-shaped guard ship: the guard asserts rendered
DOM, pins exact multi-hop strings anchored on a real second root id, and both mutation reds are
mandated with recorded transcripts and an anti-confound check.

### Verdict: CONFIRM

### Non-blocking notes

- **One factual overstatement in design.md Context.** `nodePathByStepId` is declared **non-optional**
  (`LaneColumn.tsx:65`, `RootColumn.tsx:47`), so literally deleting a prop-passing edge is a
  *typecheck* failure, not the "renders `title=undefined` with every gate green" the design asserts.
  The realistic silent regression is passing a wrong/empty lookup, which the planned per-edge
  assertions still catch — so the E2/E4 coverage is worth keeping, just not for the stated reason.
  Worth correcting in the design text so a later reader does not inherit a false premise.
- **Distinct step labels are assumed but never stated.** D3/task 2.1 locate steps via visible label;
  duplicate labels in the new fixture would make `getByText` throw. That failure is loud rather than
  vacuous, but the fixture task could say "every step in the new fixture carries a distinct label".
- **E4 assertion is slightly self-healing.** If the E4 edge were neutered, the nested step's wrapper
  renders no `title` and `closest("[title]")` walks up to the parent lane step's wrapper — the
  assertion still fails (wrong string), but the failure message will read as an off-by-one path
  rather than a missing attribute. Optionally assert `hasAttribute("title")` on the nested wrapper
  first for a more diagnostic message.
