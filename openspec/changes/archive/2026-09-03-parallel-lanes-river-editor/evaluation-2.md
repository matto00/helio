# Evaluation Report — Cycle 2 (evaluation-2.md)

Cycle-2 commit `10d1b886` on top of `22ed8642`. Every gate and every mutation below is MY
OWN fresh run in the delivery worktree; nothing here is taken from the executor's report.
Every mutation was reverted (`git status --porcelain` clean after each).

## Phase 1: Spec Review — PASS

evaluation-1.md's seven CRs, verified by mechanism:

- **CR1 (task 5.5) — RESOLVED, and proven failable in the exact shape requested.** New
  `ui/stepConfigs/SecondaryInputPicker.test.tsx` asserts the produced option list: the
  configuring step absent; an ancestor via `parentStepId` present-but-`aria-disabled` with
  "would create a cycle"; an ancestor reachable ONLY through an existing `{kind:"lane"}`
  edge likewise; and a non-terminal node, an already-consumed node, a higher-index-lane
  node and a lower-row node each present and NOT disabled.
  **My mutations:** (A) replacing the self-filter with the exact contract-item-6b mistake
  (a left-of/ordering filter) → 3 failed / 2 passed; (B) **making ancestors eligible**
  (`const disabled = false`) → 2 failed / 3 passed. AC2's "rejoin picker excludes ancestor
  lanes" is now genuinely guarded, single-mutation-failable in the ancestor direction.
- **CR2 (task 5.6) — RESOLVED, and I re-verified its redness myself rather than trusting
  the note.** Two SEPARATE single reverts, each red on its own (not a conjunction):
  (A) restoring `unionConfigOf`'s lane-kind degrade → `round-trips a stored lane-kind
  secondaryInput` fails on the load assertion; (B) restoring `onUnionChange`'s unconditional
  `{kind:"source"}` widening → the same test fails on the persist assertion. The test pins
  both halves of the data-loss branch.
- **CR3 — RESOLVED.** `stepNarrowing.test.ts:56-62` now names the real test
  (`hooks/useStepCardState.test.ts`, "round-trips a stored lane-kind secondaryInput").
- **CR4 — RESOLVED.** `e2e/hel912-lanes-rejoin.spec.ts:237` asserts `"2 rows"`, and the
  FOUND-NOT-FIXED note's "asserted above" claim at `:256` is now true.
- **CR5 — RESOLVED and failable.** `:123-158` measures `.pipeline-detail-page__lane-row`
  children's `boundingBox().y` at 1440 (equal → side by side), 430 and 375 (strictly
  increasing → stacked). **My mutation:** deleting `flex-direction: column` from the
  phone-breakpoint block turned the spec RED at `:149` (`Expected: > 443, Received: 443`).
  This is a real viewport render, not the CSS-parsing sweep (lesson 4 honoured).
- **CR6 — RESOLVED.** Both `stepTree.test.ts` titles are off the repudiated semantics; the
  first now gives one of three children an explicit `position: 0` and asserts the primary
  lane is `["a","cont"]`, so the human ruling is visible in this file's own prose. The
  second is narrowed honestly to "when NEITHER child carries a position".
- **CR7 — RESOLVED by building, and the cycle-1 defect combination is gone.** The
  `.pipeline-detail-page__lane-header` rule exists, `LaneColumn` renders it in both the
  compact and full branches, and `PipelineDetailPage.css:455-465` no longer claims anything
  untrue. **Verified live by me** (throwaway spec, created/run/deleted): 2 headers, texts
  `["Lane 1","Lane 2"]`, `visible=[false,false]` at 1440 and `[true,true]` at 430 and 375.
- **Tick-state audit against the TREE, not files-modified.md:** all 36 tasks are `[x]` and I
  found no ticked task describing behaviour that does not exist. (Task 7.1's header and
  7.3's stacking assertions — the cycle-1 offenders — are both real now.) The one remaining
  disclosed trim, drag-reorder inside a non-primary lane, is a ticket Scope bullet, not a
  numbered task; task 1.3 only requires `reorderLane`, which exists and is tested.
- **Task 6.3's do-not-implement still holds** — `grep -rn "lanePath\|laneHighlight\|
  --lane-failed" frontend/src e2e` → 0; no `runError` parsing added; no derivation from
  `stepRowCounts`.
- Boundary re-confirmed independently of the coordinator's check: `e2e/hel908-tail-attach.
  spec.ts`, `e2e/hel908-trunk-reorder-drag.spec.ts` and `playwright.config.ts` are 0-line
  diffs across `a45e9881..HEAD`; nothing in `backend/`, `schemas/`, `helio-mcp/`.

## Phase 2: Code Review — PASS

Gates (mine, in the worktree; no `backend/**` changes so sbt N/A):

- `npm run lint` → clean (`--max-warnings=0`)
- `npm run format:check` → clean
- `npm run typecheck` → clean
- `npm test` → **254 suites / 2613 tests passed** (was 253 / 2605)
- `npx playwright test e2e/hel908-trunk-reorder-drag.spec.ts e2e/hel912-lanes-rejoin.spec.ts`
  → **2 passed** live against the shared dev stack

Both regression risks this cycle's own fixes introduced were checked and are clear:

1. **`BranchAffordance.tsx` extraction did not move the AC2 mutable surface.** Mutating ONLY
   `LaneColumn`'s compact-branch wrapper class (`__tail-chain-item` → `__lane-column`) still
   turns `PipelineRiverView.test.tsx` RED (1 failed / 18 passed). The guard survives the
   extraction, still single-mutation.
2. **The `laneNumber` prop did not disturb the DOM contract.**
   `.pipeline-detail-page__tail-chain-item` nesting is intact (the header is a sibling
   `<div>` above the chain items, not a wrapper) and `hel908-trunk-reorder-drag.spec.ts`
   passes live, unedited.

`tokenAuditSweep.css.test.ts` re-pin audited two ways, per the "re-pin is how a guard becomes
a rubber stamp" concern:

- **Genuinely new lines, no absorbed drift.** I recomputed the claimed shift mechanically
  (entries `<455` unshifted, `[455,1554]` +12, `>1554` +16) against the pre-change file:
  42 entries before, 42 after, and `sorted(map(shift, old)) == sorted(new)` → **True**. No
  entry added, removed, or silently re-anchored.
- **Still a live guard.** Planting a raw-px spacing violation (`margin-bottom: 13px`) in the
  NEW `.pipeline-detail-page__lane-header` rule turns the sweep RED (1 failed / 45 passed).

Other code quality: `BranchAffordance` is a clean fully-controlled extraction (each caller
keeps its own dropdown coordination — `PipelineRiverView` still closes its gap/bottom
pickers); `types/step.ts`'s stale `buildStepTree` references are corrected;
`laneOutputSubtitle` gained the two cases I asked for; `PipelineRiverView.tsx` is 460 lines
(down from 516 at base). No `any`, no dead code, no TODO/FIXME introduced.

## Phase 3: UI Review — PASS

- Happy path end-to-end green live (register → source → pipeline → filter → two lanes →
  configured aggregates → union rejoin selecting the other lane → table Output → dry run →
  `Run status: succeeded`), with per-node produced values asserted: `5 rows` / `1 rows` /
  `1 rows` / `2 rows`, plus the Output chip.
- Breakpoints: lanes side by side at 1440, stacked at 430 and 375 — now asserted by the
  suite itself and independently re-measured by me.
- Per-lane header renders "Lane 1"/"Lane 2", hidden at desktop, revealed at 430/375
  (measured, see CR7 above).
- Interactive elements: Branch button keeps its outcome-worded `aria-label` and
  `tap-expand-44`; picker options expose `aria-disabled` with a visible cycle reason.
- No new console errors attributable to this diff.
- Environment: servers reused healthy; no Flyway validation failure occurred, and no DB or
  Playwright contention symptoms appeared across the six live runs.

## Overall: PASS

## Non-blocking Suggestions

- **The per-lane header itself has no test** (`grep -rn "lane-header" --include=*.test.*
  --include=*.spec.ts` finds only the sweep's comment). It is built and I verified it live,
  but nothing would notice if it disappeared or started showing at desktop. Cheapest fix:
  two assertions in the block `hel912-lanes-rejoin.spec.ts` already added — e.g.
  `.pipeline-detail-page__lane-header` hidden at 1440 and visible with text `Lane 2` at 375.
- Drag-reorder within a non-primary lane is still unwired (`reorderLane` supports it;
  `LaneColumn` passes `undefined` move handlers). Honestly disclosed in `files-modified.md`
  as a deliberate trim, not an AC — worth a follow-up ticket rather than a silent carry.
- `PipelineRiverView.tsx` at 460 lines is still over `CONTRIBUTING.md:24`'s ~400 line
  threshold (improved from 516). Propose the split (e.g. the gap/insert-dropdown block) in
  the PR description, as that guidance asks.
- PR body must still state task 6.3's deferral as a real gap in HEL-911 (no `lanePath` on
  the wire) and reference HEL-970 for the `previewAtNode`/`pathToRoot` defect this run found
  and correctly did not work around.
