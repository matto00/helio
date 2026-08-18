## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly:
  - "One header region, one footer region; no more than one info bar above the step list" —
    verified structurally (single `.pipeline-detail-header` container, single
    `.pipeline-detail-page__footer-region` container) and visually in the live app
    (`/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`).
  - "All existing actions ... remain reachable with no loss of function" — every accessible
    name preserved verbatim ("Edit source", "Edit type", "Set schedule"/"Edit schedule",
    "Disable schedule"/"Enable schedule", "Last run metadata", "Share", "Open run history",
    "Preview", "Dry run", "Run pipeline"); confirmed both in the ported Jest suite and live
    interaction (Share dialog opens with `aria-label="Share pipeline Profit (migrated)"`; Edit
    schedule dialog opens pre-filled correctly).
  - "Works cleanly at 430px" (HEL-687 mobile floor) — `PipelineDetailPage.css.test.ts`'s
    HEL-687 regression guard passes unchanged, and 430px live render stacks correctly (see
    Phase 3 — this AC's literal 430px scope is satisfied; a related-but-broader breakpoint
    defect is at 1100px, reported under Phase 3 since it's an observable rendering issue, not
    a spec/plan mismatch).
- [x] No AC silently reinterpreted.
- [x] All 17 task items in `tasks.md` marked done and match what was implemented (verified via
  diff read-through: labelForKind relocation, PipelineDetailHeader creation, footer
  consolidation, CSS cleanup, deletions, and test porting all present exactly as described).
- [x] No scope creep — diff is 100% frontend, confined to `frontend/src/features/pipelines/ui/`
  and the new `frontend/src/features/sources/utils/labelForKind.ts`, matching proposal.md's
  declared Impact. The one behavior addition beyond pure relocation (the `__share-btn:hover`
  background fix, `--app-surface` → `--app-surface-soft`) is justified and necessary — the
  button's new backdrop (`--app-surface`, from `__footer-region`) is the same color its old
  hover state used, which would have made hover invisible; this is a direct, disclosed
  consequence of the relocation, not unrelated scope.
- [x] No regressions to existing behavior covered by other specs — full Jest suite (210 suites /
  2260 tests) passes; `pipeline-sharing` spec unaffected (no delta needed per design.md D4,
  confirmed correct).
- [x] No API/schema changes — none needed, none made.
- [x] Planning artifacts (`proposal.md`, `design.md`, spec deltas in
  `specs/pipeline-editor-page/spec.md` and `specs/pipeline-schedule-config-ui/spec.md`) all
  accurately reflect the final implemented behavior — spot-checked against the live render and
  the diff, no drift found.

### Phase 2: Code Review — PASS

Fresh gates run in `WORKTREE_PATH` (no `CLEAN_WORKTREE` — default speed):

- `npm run lint` → 0 warnings/errors.
- `npm run format:check` → all files formatted.
- `npm test` (full suite, not just touched files) → **210 suites / 2260 tests passed**,
  including `PipelineDetailPage.css.test.ts` (HEL-687 regression guard) and the new
  `PipelineDetailHeader.test.tsx` (ports every scenario from the three retired `.test.tsx`
  files plus a single-container structural check).
- `npm --prefix frontend run build` → succeeds (pre-existing >500kB chunk warning, unrelated to
  this change).
- No `backend/**` files touched — `sbt test` not required.

Hook-bypass check: the commit was made with `git commit -n`, bypassing Husky. Verified the
stated reason is accurate: `npm run check:openspec` (`scripts/check-openspec-hygiene.mjs:32-34`)
fails any change with all tasks complete but not yet archived — exactly this change's state at
Cycle 1, before evaluator/skeptic sign-off (`workflow-state.md`: `PHASE: Execution`,
`SKEPTIC_CYCLE: 0` at commit time). Archiving is a distinct, later orchestrator-owned phase per
this repo's `/concertino-deliver` workflow, not something the executor can or should do early.
The commit body calls this out explicitly (per CLAUDE.md's bypass-disclosure requirement) and
states all other hooks (lint, format:check, check:schemas, full Jest) were run fresh and passed —
independently reconfirmed above. This bypass is appropriate.

Canonical-standard compliance (`CONTRIBUTING.md`, `DESIGN.md`):

- **Imports & Qualifiers**: no inline FQNs; `labelForKind` imports updated to the new location in
  both consumers (`CreatePipelineModal.tsx`, `ShapeInstantiateStep.tsx`).
- **File-size budgets** [informational per CONTRIBUTING.md]: `PipelineDetailFooter.tsx` grew
  253→305 lines (already over the ~250 soft budget pre-change; still well under the ~400 hard
  cap that would require a split-proposal). This was a disclosed, self-approved choice in
  `design.md`'s Planner Notes (extend the existing footer rather than add a new file, to keep
  `PipelineDetailPage.css.test.ts`'s selectors resolving unchanged) — reasonable trade-off, not
  flagged as a defect.
- **Design tokens** [mechanical]: no hardcoded hex/rgba, no literal `font-size`/`font-weight`, no
  ad-hoc `font-family` in any new or modified CSS. All `--app-*`/`--text-*`/`--eyebrow-*` tokens
  used correctly and consistently with existing usage elsewhere in the codebase.
- **DRY**: `labelForKind` is a genuine single-source relocation (byte-identical function body),
  not a new duplication. `PipelineDetailHeader.tsx`'s three field groups share one bordered
  container rather than three separate bar components — matches design.md D1's intent.
- **Behavior-preserving relocation**: line-by-line comparison of the three retired components
  (`BoundSourceBar.tsx`, `BoundTypeBar.tsx`, `PipelineScheduleBar.tsx`) against
  `PipelineDetailHeader.tsx` confirms all JSX/logic (including the spray-json
  absent-vs-null `nextRunAt` regression guard) ported unchanged; only class names and the outer
  container changed.
- **Tests meaningful**: `PipelineDetailHeader.test.tsx` ports every scenario from the three
  retired test files (11 tests) plus a new single-container structural assertion. New Share-button
  coverage in `PipelineDetailPage.test.tsx` (visible/absent by ownership, opens dialog) fills a
  pre-existing test gap (confirmed: `main`'s `PipelineDetailPage.test.tsx` had zero Share-button
  coverage before this change) rather than being padding.
- **No dead code**: no stray references to the three deleted components anywhere in the app
  (`grep -rl "BoundSourceBar\|BoundTypeBar\|PipelineScheduleBar"` only matches doc-comment
  mentions in the new files explaining what was ported from where).

Non-blocking observation (see below) on pre-existing non-token spacing values carried over
verbatim into the new CSS file — not a new violation, not blocking.

### Phase 3: UI Review — FAIL

Dev servers started cleanly via `scripts/concertino/start-servers.sh` /
`scripts/concertino/assert-phase.sh servers` → `PASS servers`. No console errors/warnings
observed across any tested interaction.

**Happy path** (pipeline `555f4bae-7c76-4566-84eb-036bc33b4485`, "Profit (migrated)", owned
source/type, active schedule, last-run data present): confirmed exactly one header region (DATA
SOURCE / OUTPUT TYPE / SCHEDULE) and exactly one footer region (last-run metadata row + PIPELINE/
OUTPUT + action buttons including the relocated Share button), matching the design intent. "Edit
schedule" opens `PipelineScheduleDialog` pre-filled correctly (Interval / 1 / Minutes / next run /
timezone / Enabled checkbox). "Share" opens `PipelineShareDialog`
(`aria-label="Share pipeline Profit (migrated)"`). No console errors during any of these.

**Breakpoint check (1440 / 1100 / 768 / 430 — DESIGN.md §4's canonical, binding set) — FAIL at
1100px**:

- **1440px**: minor truncation — `.pipeline-detail-header__schedule-expression` ("Every 1m")
  renders at 46px width vs. its 67px content (`scrollWidth`), so it displays as "Ever…" even
  though the group has 400px total width available. Not severe on its own, but the first sign of
  the underlying crowding problem.
- **1100px (canonical breakpoint, DESIGN.md §4) — genuine layout breakage**, confirmed via both
  screenshot and `getBoundingClientRect()`/computed-style inspection:
  - `.pipeline-detail-header__source-name` ("Profit") renders at **0px width — fully invisible**.
    The DATA SOURCE field group shows only the "Static" kind badge; the user cannot see which
    source is bound to the pipeline at all.
  - `.pipeline-detail-header__schedule-expression` ("Every 1m") also renders at **0px width**.
  - `.pipeline-detail-header__schedule-disabled-badge` ("DISABLED") visually overflows its
    parent's box and **overlaps the "Edit schedule" button** (badge right edge at x=1020 vs. the
    button starting at x=965 — garbled overlapping text confirmed in screenshot).
  - Root cause: `.pipeline-detail-header__group-value` (`flex: 1; min-width: 0`) has no
    `overflow: hidden`, and its `flex-shrink: 0` children (`__source-kind`,
    `__schedule-disabled-badge`, the `Toggle`) refuse to shrink and consume all available space,
    squeezing the *should-be-visible* text (`__source-name`, `__schedule-expression`) down to
    zero and letting the non-shrinking badges overflow the container's own box.
  - This is exactly the risk `design.md`'s own Risks section named — *"[Combining three field
    groups into one header risks visual crowding at **1100**/768px ...]"* — but the implemented
    mitigation, `frontend/src/features/pipelines/ui/PipelineDetailHeader.css:121`
    (`@media (max-width: 768px)`), only covers ≤768px, leaving the self-identified 1100px risk
    unaddressed. The header's own code comment
    (`PipelineDetailHeader.css:116-120`) names "1100/768px" as the at-risk range while the rule
    beneath it only fixes half of that range.
- **768px**: header's `@media (max-width: 768px)` rule applies (768 is inclusive of `max-width:
  768px`) — field groups stack vertically, "Every 1m" displays fully, no overlap. Correct.
- **430px**: header stacks correctly (same as 768px); footer stacks per the pre-existing HEL-687
  treatment (Run pipeline full-width, action buttons wrap). Correct.

This is an objective, reproducible rendering defect at a DESIGN.md-ratified, required breakpoint
(1100px sits squarely in the middle of the canonical set), not a subjective visual-polish call —
real bound-source/schedule data becomes fully invisible and UI elements visually overlap. It
directly undermines the ticket's "no loss of function" acceptance criterion (the source binding
becomes unreadable, not merely less polished) at a width every desktop reviewer is very likely to
hit.

Other Phase 3 checks: no console errors across all tested flows; interactive elements have
accessible names (verified); keyboard-operable dialogs (Escape closes both Share and Schedule
dialogs); loading/empty states not affected by this change (untouched code paths). Not exhaustively
re-tested given Phase 3 already fails on the breakpoint check above.

### Overall: FAIL

### Change Requests

1. **Fix the header's crowding at the 1100px breakpoint** —
   `frontend/src/features/pipelines/ui/PipelineDetailHeader.css:121` currently reads
   `@media (max-width: 768px)`. The header's own three-column layout becomes broken between
   ~769px and ~1100px+ (verified broken exactly at 1100px): `.pipeline-detail-header__source-name`
   and `.pipeline-detail-header__schedule-expression` render at 0px width (fully hidden) and
   `.pipeline-detail-header__schedule-disabled-badge` visually overlaps the "Edit schedule"
   button. Either (a) widen the existing stacking media query to cover 1100px (e.g.
   `@media (max-width: 1100px)`, consistent with DESIGN.md §4's canonical breakpoint), or (b) keep
   the 3-column layout at 1100px but rebalance the flex children inside
   `.pipeline-detail-header__group-value` so the truncatable text (`__source-name`,
   `__schedule-expression`) gets guaranteed minimum space and non-critical badges
   (`__source-kind`, `__schedule-disabled-badge`) yield first — e.g. give the badges
   `flex-shrink: 1` with a sane `min-width`, or hide the "Disabled" badge below a width threshold
   since the toggle already conveys enabled/disabled state. Re-verify at 1100px with
   `getBoundingClientRect()`/`scrollWidth` checks (not just a visual screenshot) that no header
   text renders at 0 width and no two elements' boxes overlap.
2. **Fix the residual truncation at 1440px** — same file, `.pipeline-detail-header__schedule-expression`
   (`PipelineDetailHeader.css:86-94`) currently truncates "Every 1m" to "Ever…" even at the
   widest supported breakpoint (400px available in the group, only 46px given to the expression
   span). Once (1) is fixed, re-check that the fix doesn't leave 1440px undersized for its own
   sibling elements.

### Non-blocking Suggestions

- `PipelineDetailHeader.css:20-21` (`gap: 12px; padding: 10px 20px;`) and `:66`/`:109`
  (`padding: 2px 6px;`) are literal px values rather than `--space-*` tokens, which DESIGN.md
  marks `[mechanical]`. These are exact carryovers from the retired `BoundSourceBar`/
  `BoundTypeBar`/`PipelineScheduleBar` components (verified byte-identical against `main`), not
  new debt introduced by this change — not blocking, but worth a follow-up spinoff if the header
  layout is being reworked anyway to address the Change Requests above.
- `PipelineDetailFooter.tsx` (305 lines) is now further past the ~250-line soft budget; purely
  informational per `CONTRIBUTING.md`, already a disclosed, reasoned trade-off in `design.md`'s
  Planner Notes.
