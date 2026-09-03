## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from a command I ran or a file/screenshot I read
in this worktree, not from `evaluation-*.md` or `files-modified.md` (both read only as claims).

### What I verified (with evidence)

**Scope boundary — CLEAN.**
`git diff --name-only a45e9881...HEAD | grep -v -E '^(frontend/|e2e/|openspec/changes/parallel-lanes-river-editor/)'`
returned nothing. No `backend/`, `schemas/`, or `helio-mcp/` file is touched.

**Item 5 — the two hel908 specs are 0-line diffs.** Independently reproduced:
`git diff --stat a45e9881...HEAD -- e2e/hel908-trunk-reorder-drag.spec.ts e2e/hel908-tail-attach.spec.ts`
is empty, and the only `e2e/` path in the whole diff is `+++ b/e2e/hel912-lanes-rejoin.spec.ts`
(a pure add).

**Item 6 — gates re-run by me, all green.**
- `npm run typecheck` → clean; `npm run lint` (`eslint src --max-warnings=0`) → clean;
  `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → **254 suites / 2613 tests passed, Snapshots: 0 total.** The zero confirms
  design.md's claim that AC2's literal "identical to P1.5 snapshots" is unsatisfiable — there
  are no frontend snapshots to compare against, so the DOM-contract guard is the right
  substitute rather than an excuse.
- `npm run build` → succeeded (PWA precache generated).
- `npx playwright test --list | grep -c hel912` → `1`. The new spec IS collected by the glob
  CI runs; task 8.2's claim holds.
- Live e2e: `hel908-trunk-reorder-drag.spec.ts` **passed on all 3 runs**.
  `hel912-lanes-rejoin.spec.ts` **failed once** (first pair run, at the lane-1 op-menu click,
  `getByRole("menu")…"Group & aggregate"`), then passed **3/3** on re-run (solo, and two more
  pair runs). Per the evidence law this is a non-reproduced anomaly, consistent with the
  documented shared-Playwright-session contention with HEL-913/914 — recorded, not a REFUTE.

**AC2 mutation proof re-established against the FINAL tree** (the concern raised about
`BranchAffordance` extraction moving the mutable surface): I mutated
`LaneColumn.tsx:151`'s `className="pipeline-detail-page__tail-chain-item"` → `"MUTATED"` and ran
`PipelineRiverView.test.tsx`: **exactly 1 test failed, 18 passed**. Single mutation, not a
conjunction. File restored (`git diff --stat` clean). The recorded proof still holds.

**Item 2 — rejoin-picker eligibility read as a PROPERTY, not by name-grep.**
`SecondaryInputPicker.tsx:70-80` is the whole eligibility surface: the option list is
`allSteps.filter(s => s.id !== currentStepId)` and the only `disabled` predicate is
`ancestorIds.has(s.id)`. There is no other filter, no `.slice`, no row/column comparison, no
consumer count, no terminal test anywhere in the component. `computeAncestorIds`
(`laneLayout.ts:135-160`) walks `parentStepId` **and** `{kind:"lane"}` `secondaryInput` edges,
so a cycle closing through a lane edge is caught. Contract items 6/6b are honoured.
`SecondaryInputPicker.test.tsx` asserts the produced option list (present/absent, `aria-disabled`,
reason text) for a non-terminal node, an already-consumed node, a higher-index lane and a lower
row — genuine coverage, not "render succeeded".

**Item 3 — position-0 primary-lane semantics are correct in code.** `stepTree.ts:105-118`
selects the continuation as the position-0 child (with the documented `position === undefined`
single-child fallback) and enqueues every other child as its own lane. No code path treats all
children symmetrically. (Two *documents* still carry the repudiated rule — CRs 5 and 6.)

**Item 4 — task 6.3's DO-NOT-IMPLEMENT holds.** `grep -rn "lanePath|lane-path|lane path"` over
`frontend/src/features/pipelines/` and the new e2e spec returns nothing. Every `runError`
occurrence is pre-existing (`pipelinesSlice.ts`, `PipelineDetailFooter.tsx`,
`usePipelineDetailPage.ts`) and none of them is parsed; nothing derives a highlight from
`stepRowCounts`.

**Baseline shift (lesson 1).** `tokenAuditSweep.css.test.ts`'s re-pin is entry-count-preserving
(24 in / 24 out in the shifted block) and every entry shifts by a uniform +41, matching the
documented +29/+12 arithmetic. No entry added or removed; the sweep still passes. Honest.

**AC1** — `e2e/hel912-lanes-rejoin.spec.ts` asserts produced values, not interactions:
`"5 rows"` on the filter, `"1 rows"` on each lane's aggregate, and `"2 rows"` on the union. That
last one is real proof the lane rejoin consumed both lanes end to end. The Output **thumbnail**
is not asserted (chip visibility only) — the documented `previewAtNode`/`pathToRoot` backend gap,
accepted per brief.
**AC3** — the viewport block asserts real `boundingBox` geometry: equal `y` at 1440, strictly
increasing `y` at 430 and 375, plus exact `["Lane 1","Lane 2"]` header text visible only when
stacked. This is a viewport render, correctly kept separate from the CSS-parsing sweep.
**AC4** — re-run by me above.

**UI judgment (my domain).** Started servers (`start-servers.sh` reused healthy ones;
`assert-phase.sh servers` → `PASS servers`), drove a real two-lane pipeline and screenshotted the
river at 1440×1000. See CR1 — the screenshot shows a real layout defect.
Light/dark parity: I could **not** get my throwaway theme-toggle script to run (my scaffolding
failed, not the product), so parity is **not visually confirmed**. What I can state is that all
new CSS uses only semantic theme-aware tokens (`--app-border-strong`, `--app-text-muted`,
`--space-*`, `--text-micro`, `--weight-medium`) with no literal colors, so parity follows from
tokens rather than from an observation. Flagging the limitation rather than claiming the check.

### Verdict: REFUTE

The engineering core is sound — the lane model, the layout module, the picker property, the
gates and the AC guards all hold up under independent re-derivation. What does not hold up is
(a) the rendered result of the new multi-lane path, and (b) four artifacts that describe a tree
that no longer exists. (b) is exactly the shape this run kept catching in itself, and it is
still present in four places.

### Change Requests

1. **The compact lane branch lays its affordances out as row siblings of the step card,
   squeezing the card and colliding its label with its own action icons.**
   `LaneColumn.tsx:151` opens `<div className="pipeline-detail-page__tail-chain-item">`, and at
   `:178-179` both `renderAddLaneAffordance(step)` and `renderChildLanes(step)` are rendered as
   siblings of `<StepCard>` **inside** that div. That class is
   `display: flex; flex-direction: row; align-items: stretch` (`PipelineDetailPage.css:416-420`)
   and the card is `flex: 1` (`:429-431`), so the card now shares its horizontal track with the
   Branch affordance and with any nested lane row. Observed at 1440px with two lanes off a
   filter (screenshot `desktop-light.png` / crop `crop.png` in this run's scratchpad):
   the "Group & aggregate" and "Sort rows" labels wrap to two lines and the second line runs
   **underneath the disable and duplicate icons**, and each lane's "Branch" button floats in
   dead space to the right of its lane's dashed connector run instead of sitting beneath the
   card as it does on the primary lane. A nested child lane would likewise render horizontally
   beside its parent card rather than "below" it, contradicting `pipeline-tails-ui`'s own
   "beneath the parent step" wording. Fix: render the affordance and the child-lane row as
   siblings of the `tail-chain-item` (i.e. in the enclosing column), not inside the flex-row item.
2. **The same code refutes its own comment.** `LaneColumn.tsx:144-146` states the compact branch
   is "byte-identical to `TailChain`'s markup". It is not: `TailChain.tsx` (base `a45e9881`,
   `:61-62`) put only the connector `<span>` and the `<StepCard>` inside `tail-chain-item`;
   this version adds two more children. Either restore byte-identity (CR1's fix does) or delete
   the claim — an artifact asserting evidence it does not have is the exact failure mode this
   run has been fighting.
3. **User-visible copy still asserts the single-tail invariant this ticket deleted.**
   `BranchAffordance.tsx:35-44`: `aria-label` and `title` read "Branch this step to build **a
   second output**, without changing the main pipeline", and the hint span reads "for a second
   output". Task 4.1 and ticket Scope call this the "+ lane" affordance, and Decision 1 removed
   the at-most-one-branch invariant outright — yet on a step that already has two or three lanes
   the control still tells the user it will make "a second output". Update the label, title and
   hint to lane language.
4. **`files-modified.md` "Known gaps" contains a claim that is false against the final tree.**
   It states the per-lane mobile header "was not added as a separate DOM element — only the CSS
   stacking/border treatment… Flagged as a gap, not fixed given the remaining time budget."
   `LaneColumn.tsx:110` renders `<div className="pipeline-detail-page__lane-header">Lane
   {laneNumber}</div>`, the e2e spec asserts its exact text at 430/375, and lines 5-17 of that
   same file record verifying it RED. Stale from before `10d1b886`/`084978b7`; delete or rewrite.
5. **`files-modified.md` "Gate-shift housekeeping" is stale by one re-pin.** It says the baseline
   was "re-pinned a **third** time" with "+29 after original line 432, +15 after original line
   1510". The shipped `tokenAuditSweep.css.test.ts` documents a **fourth** re-pin (+12 / +4 on
   top), and the actual entries moved by +41, not +29. Bring the record in line with the file.
6. **Two artifacts still carry the repudiated "every child roots a lane" semantics.**
   - `tasks.md:8` (task 1.1, ticked): "Every step child of a node roots its own lane" — flatly
     contradicted by the shipped `buildLaneGraph` and by design.md Decision 1's own correction.
   - `design.md:128` (Risks / Trade-offs): "with n lanes there is no trunk-vs-tail question to
     disambiguate — every child roots a lane — so the branch is removed rather than ported."
     This is the exact rule `design.md:51` repudiates, so design.md now contradicts itself, and
     the justification given for deleting the position-based tail disambiguation rests on a rule
     that no longer exists. Restate both under the position-0 ruling (the deletion is still
     correct — the *reason* needs to be the real one).

### Non-blocking notes

- **Descendants are offered as enabled in the rejoin picker.** Only ancestors are disabled, so
  selecting a *descendant* (e.g. the configuring step's own child) is offered but closes a cycle
  and will be rejected 400 at write time. This matches the contract's literal "non-self,
  non-ancestor" and AC2's literal "excludes ancestor lanes", and I am deliberately not
  re-litigating a rule the design gate locked over five rounds — but ticket Scope's
  "cycle-invalid lanes greyed with a reason" arguably covers this case too, and
  `computeAncestorIds` already has the machinery to compute it. Worth a follow-up.
- The e2e spec's found-not-fixed comment calls the `previewAtNode` gap "a spinoff candidate for
  HEL-913"; per the orchestrator it is already **filed as HEL-970**. Update the reference so the
  next reader does not re-triage it.
- One non-reproducing `hel912-lanes-rejoin` failure (1 red, then 3 green). Recorded as
  contention per the run's own standing rule; no action, but do not let it be reported as a
  clean 100% first-run pass.
