# Evaluation Report — Cycle 1 (evaluation-1.md)

Base `a45e9881`; commits `142aec7c`, `22ed8642`. All gate runs below are MY OWN fresh runs
in the delivery worktree (`CLEAN_WORKTREE` not set), not the executor's report.

## Phase 1: Spec Review — FAIL

Verified good:

- **Decision 1 / primary lane (escalated + human-ruled)** — `state/stepTree.ts:105-118`
  implements exactly the ruling: the continuation is the `position === 0` child (with a
  narrow `kids.length === 1 && position === undefined` fallback for a not-yet-persisted
  step); every `position >= 1` child, and any second `position === 0` child, is enqueued as
  its own lane. `primaryLaneId = root.id`. Totality sweep (`:126-141`) appends unreached
  steps to the primary lane. **Mutation-verified by me**: forcing `continuationIndex = -1`
  (the pre-reversal "every child roots a lane" semantics) turns `stepTree.test.ts` RED
  (2 failed / 12 passed) — the ruling IS pinned, not merely coincidentally green.
- **Scope boundary** — `git diff --name-status a45e9881..HEAD` touches only `frontend/**`,
  `e2e/hel912-lanes-rejoin.spec.ts` (new), and this change's own `openspec/**` artifacts.
  Nothing in `backend/`, `schemas/`, `helio-mcp/`. PASS.
- **`e2e/hel908-trunk-reorder-drag.spec.ts` UNEDITED and green** — `git diff a45e9881..HEAD --
  e2e/hel908-trunk-reorder-drag.spec.ts` is empty (0 lines), as is the diff for
  `playwright.config.ts`. Run live by me: `DEV_PORT=6344 npx playwright test
  e2e/hel908-trunk-reorder-drag.spec.ts` → `1 passed (3.0s)`. AC2's only machine-checkable
  DOM contract holds unchanged.
- **`e2e/hel908-tail-attach.spec.ts` UNTOUCHED** — 0-line diff; still quarantined at
  `playwright.config.ts:47`. No pre-existing defect folded in.
- **Task 6.3 DO-NOT-IMPLEMENT honoured** — no `lanePath`/lane-path highlight anywhere in
  `frontend/src` or `e2e`; the only `runError` references are pre-existing
  (`PipelineDetailFooter.tsx`, `pipelinesSlice.ts`) and untouched by this diff; no
  client-side derivation from `stepRowCounts`.
- **Rejoin eligibility as a PROPERTY (contract items 6 / 6b)** — read as a shape of code at
  `ui/stepConfigs/SecondaryInputPicker.tsx:69-80`: `allSteps.filter(s => s.id !==
  currentStepId)` is the ONLY filter, and `disabled = ancestorIds.has(s.id)` is the ONLY
  disable, with the reason rendered in the option label. `computeAncestorIds`
  (`state/laneLayout.ts:139-163`) walks `parentStepId` AND `secondaryInput.kind === "lane"`
  edges. There is no terminal-only filter, no single-consumer filter, and no
  left-of/above-of/ordering comparison anywhere in the picker or its inputs. PASS.
- **Task 8.2 collection verified, not assumed** — `npx playwright test --list | grep
  hel912` returns exactly 1 test; CI runs a bare `npx playwright test`
  (`.github/workflows/ci.yml:317-318`) honouring the same config. The new spec runs green
  live: `1 passed (6.3s)`.
- **Backend `previewAtNode`/`pathToRoot` defect (HEL-970)** genuinely out of scope and
  genuinely NOT worked around in the frontend: no preview-path special-casing, retry, or
  secondary-lane stitching appears in the diff; `OutputEditorSheet`/`useOutputPreview` are
  untouched. `files-modified.md`'s FOUND-NOT-FIXED section is an honest root-cause note.

Issues:

1. **Tasks 5.5 and 5.6 are marked `[x]` but were not implemented.** There is no
   `SecondaryInputPicker.test.tsx`, and no test anywhere asserts an ancestor is
   listed-but-disabled with a reason, that the configuring step is absent, or that a
   non-terminal / already-consumed / higher-lane / lower-row node is selectable
   (`grep -rn "would create a cycle" frontend/src --include=*.test.*` → 0 hits). No
   round-trip test exists (`grep -rn "round-trip" frontend/src --include=*.test.*` finds
   only unrelated pre-existing tests). This makes ticket **AC2's literal clause "rejoin
   picker excludes ancestor lanes" unguarded by any Jest test**. `files-modified.md` does
   not flag this gap, unlike the two gaps it does flag honestly.
2. **Task 7.3 / AC3 ("Mobile stacking verified at 375px/430px") has no automated
   evidence.** `e2e/hel912-lanes-rejoin.spec.ts` contains no `setViewportSize` and no
   375/430 reference; task 7.3 explicitly required lane STACKING to be verified in the
   Playwright spec at both widths, separately from the CSS sweep. Task marked `[x]`.
   (I verified the behaviour myself, so this is an evidence gap, not a functional one —
   see Phase 3.)
3. **Task 7.1's per-lane mobile header was not built**, and the shipped CSS comment
   (`PipelineDetailPage.css:1541-1543`) says the stacking rules reveal "a per-lane header",
   which does not exist (`grep -rn "lane-header\|laneHeader" frontend/src e2e` → 0).
   `files-modified.md:241-246` does flag the gap honestly; the in-code comment does not.
   Task marked `[x]`.
4. **Ticket Scope bullet "drag-reorder works within a lane" is unfulfilled for every
   non-primary lane** — `LaneColumn.tsx` passes `onMoveUp/onMoveDown = undefined` and no-op
   drag handlers for all its cards, so a multi-step lane cannot be reordered at all, even
   though `reorderLane` supports any lane. Honestly disclosed in `files-modified.md:235-240`
   as a deliberate trim; not an AC, so recorded as a scope note rather than a blocker.

## Phase 2: Code Review — FAIL

Gates, run by me from the worktree (`frontend/**` changed; no `backend/**` changes, so sbt
not applicable):

- `npm run lint` → clean, rc=0 (`eslint . --max-warnings=0`)
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm run typecheck` → clean
- `npm test` → 253 suites / 2605 tests passed (plus the root 22/216 suite)
- `npx playwright test e2e/hel908-trunk-reorder-drag.spec.ts` → 1 passed
- `npx playwright test e2e/hel912-lanes-rejoin.spec.ts` → 1 passed

Verified good:

- **AC2's replacement guard is failable by ONE mutation, not a conjunction.** I changed only
  the compact branch's wrapper class in `LaneColumn.tsx:157` (`__tail-chain-item` →
  `__lane-column`) and `PipelineRiverView.test.tsx` went RED at `:371` (1 failed / 18
  passed); reverted. `files-modified.md:118-127` correctly labels it a **GUARD, not a proof
  of pixel identity**.
- **Task 5.1/5.1b data-loss branch really is deleted**, not retyped: `stepNarrowing.ts:509`
  / `:525` now pass `cfg.secondaryInput` straight through, and `useStepCardState.ts:373/381`
  widen `newConfig.secondary` instead of the unconditional `{kind:"source"}`. The old
  `stepNarrowing.test.ts:60` degrade pin is gone, replaced by positive lane-kind narrowing
  assertions for both `union` and `lookup` — the defect is not re-pinned in new clothes.
- Fixture/test edits in the four blast-radius files are shape migrations forced by the
  discriminated-union type change, each explained in `files-modified.md`; none accommodates
  a behaviour change. The `tokenAuditSweep.css.test.ts` baseline edit is a pure line-shift
  re-pin (+29/+44) with arithmetic shown and no entries added or removed — consistent with
  the known line-pinned-baseline pattern.
- File-size budgets improved, not regressed: `PipelineRiverView.tsx` 516 → 469,
  `usePipelineDetailPage.ts` 1055 → 1038; new files are 226 / 155 / 98 lines.
- No `any`, no dead `buildStepTree`/`tailsByStepId`/`hasTail`/`reorderTrunk` code paths
  remain (only historical prose in comments).

Issues:

5. **`stepNarrowing.test.ts:53-59` points at a test that does not exist**: "see task 5.6's
   round-trip test below for the full save/reload proof". There is no such test below (or
   anywhere). A comment asserting evidence that does not exist is exactly the
   confidently-false-documentation shape; it also makes the missing 5.6 coverage look
   covered to the next reader.
6. **The e2e spec's weakest assertion is on the one node the whole ticket is about, and its
   inline note overstates it.** `e2e/hel912-lanes-rejoin.spec.ts:198-200` asserts only
   `toContainText("rows")` for the union rejoin — which would pass on `0 rows` — while the
   FOUND-NOT-FIXED comment at `:212-215` states "its own row-count chip renders '2 rows' —
   asserted above". It is not asserted above. I tightened that single assertion to
   `toContainText("2 rows")` and re-ran the spec live: **1 passed** — so the precise value
   is available and the loose assertion is gratuitous (lesson 8).
7. **`stepTree.test.ts` still documents the REPUDIATED semantics in two test titles.**
   `:41` "every child of a node roots its OWN lane — a node with 2 children makes 2 lanes,
   not trunk+tail" and `:60` "b's two children (t1, c) BOTH root their own lane off b,
   neither privileged as 'the' continuation" are the pre-`22ed8642` (pre-ruling) claims.
   Both only still pass because their fixtures give every child `position: undefined`; they
   assert nothing about the human-ruled property and actively contradict it in prose, in the
   file a future reader will consult to learn the rule.
8. **DRY** — the "Branch" affordance (button + hint + `OpDropdown` + its two pieces of
   dropdown state) is duplicated near-verbatim between `PipelineRiverView.tsx:349-378` and
   `LaneColumn.tsx:81-113`. Two copies of the same affordance will drift.
9. **`laneOutputSubtitle` (task 6.1) has zero test coverage** — no test anywhere asserts the
   `off filter › lane 2 › aggregate` subtitle or that a primary-lane Output's subtitle is
   unchanged, though both are stated behaviours in `specs/pipeline-outputs-rail/spec.md`.

## Phase 3: UI Review — PASS (with one note)

Servers reused healthy via `scripts/concertino/start-servers.sh` (dev 6344 / backend 9251).
Beyond the two suite specs above I drove the real UI myself with a throwaway spec (created,
run, deleted — no repo change): register → source → pipeline → filter → two Branch lanes.

- Happy path end-to-end works (both e2e specs green live; run reaches `Run status:
  succeeded`, per-lane row counts render `5 rows` / `1 rows` / `1 rows` / `2 rows`, and the
  rejoin's Output chip is visible and addressable).
- **Breakpoints**: measured `getComputedStyle(.pipeline-detail-page__lane-row).flexDirection`
  and child `getBoundingClientRect().top` — 1440: `row`, lane tops `[351, 351]` (side by
  side); 430 and 375: `column`, lane tops `[437, 556]` (genuinely stacked). AC3's behaviour
  is real; only its automated evidence is missing (Phase 1 issue 2).
- Interactive elements: the new Branch control carries an outcome-worded `aria-label` and
  reuses `tap-expand-44`; the picker is a labelled `combobox` with named options; the CSS
  sweep suite is green.
- Console: one `404 (Not Found)` resource error during the session, not attributable to this
  diff (no failing feature request; noted, not charged to this change).
- Empty state / loading / error paths in the touched components are unchanged from P1.5.

## Overall: FAIL

## Change Requests

1. **Implement task 5.5** — add `ui/stepConfigs/SecondaryInputPicker.test.tsx` asserting the
   produced option list (not that render succeeded): (a) the configuring step's own id is
   absent from the options; (b) an ancestor (reached via `parentStepId` AND via an existing
   `{kind:"lane"}` edge) is PRESENT but `disabled` with its cycle reason; (c) a non-terminal
   node, an already-consumed node, a node in a higher-index lane, and a node at a lower row
   are each present and NOT disabled. This is the only Jest expression of ticket AC2's
   "rejoin picker excludes ancestor lanes".
2. **Implement task 5.6** — a round-trip test: a step stored with
   `config.secondaryInput = {kind:"lane", stepId}` loads with that node selected in the
   picker, and changing an unrelated field on the same step (e.g. `union`'s
   `mode` byPosition→byName) persists a `secondaryInput` that is still
   `{kind:"lane", stepId}`. Verify it is RED against the pre-change narrowing.
3. **Fix `frontend/src/features/pipelines/state/stepNarrowing.test.ts:57-59`** — the comment
   "see task 5.6's round-trip test below" must either point at the test CR2 adds or be
   removed. Do not leave a comment claiming evidence that does not exist.
4. **Tighten `e2e/hel912-lanes-rejoin.spec.ts:198-200`** from `toContainText("rows")` to
   `toContainText("2 rows")` (verified passing by this evaluation), and correct the
   FOUND-NOT-FIXED note at `:212-215` so its "asserted above" claim is true.
5. **Add lane-stacking assertions to `e2e/hel912-lanes-rejoin.spec.ts` (task 7.3 / AC3)** —
   at 430 and 375 assert the lanes are stacked (e.g. two `.pipeline-detail-page__lane-row`
   children have distinct `boundingBox().y`, and equal `y` at a desktop width). If this is
   instead deferred, un-tick task 7.3 and say so; do not leave it marked done.
6. **Retitle `frontend/src/features/pipelines/state/stepTree.test.ts:41` and `:60`** so they
   no longer assert the repudiated "every child roots its own lane / neither privileged as
   the continuation" semantics — state what they actually pin (siblings that all lack a
   `position` have no continuation, so each roots a lane), and give at least one of them an
   explicit `position: 0` sibling so the ruling is visible in this file's prose too.
7. **Reconcile tasks.md with reality** — task 7.1's per-lane mobile header was not built
   (`files-modified.md` says so; the task is ticked and
   `PipelineDetailPage.css:1541-1543`'s comment claims the header exists). Either build it
   or un-tick 7.1 and fix that CSS comment.

## Non-blocking Suggestions

- Extract the duplicated Branch affordance (issue 8) into one shared component used by both
  `PipelineRiverView` and `LaneColumn`.
- Add a small Jest test for `laneOutputSubtitle` (issue 9) covering the primary-lane
  (unchanged) and non-primary-lane (`› lane N ›`) cases.
- `frontend/src/features/pipelines/types/step.ts:30,36` still document `buildStepTree`, which
  this change deleted; update to `buildLaneGraph`.
- `PipelineRiverView.tsx` is 469 lines (down from 516, so no regression). Per
  `CONTRIBUTING.md:24`, propose a split in the PR description.
- The PR body must state task 6.3's deferral as a real gap in HEL-911 (no `lanePath` on the
  wire), not as a scope choice, and should reference HEL-970 for the `previewAtNode` defect.
