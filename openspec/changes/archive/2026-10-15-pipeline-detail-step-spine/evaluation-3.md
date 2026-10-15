## Evaluation Report — Cycle 3 (evaluation-3.md)

**What was reviewed:**
- HEAD `5da09741d605a8db646a431b5dae7c1f4e0b05d2`, base `cd64409ad828d9024074f907a7ea32800ab71ff3`.
- The cycle-3 delta is `f614a02fd..5da09741d`:
  - `SpineScheduleChip.tsx`: calendar icon, title carrying the full state;
  - `PipelineSpineHeader.css`: compact chip at ≤1100px, icon at ≤900px;
  - the e2e narrow test (seeds a paused schedule, adds 1280);
  - the spec deltas and design D3.
- There are no backend changes since cycle 1, whose `sbt testFull` (8139 passed, 0 failed) and `PipelineRunStepRowCountsRlsSpec` (6/6, non-BYPASSRLS pool) still stand.

This is the final execution cycle (`EXECUTION_CYCLES: 3`).

### Gate evidence (fresh runs, this worktree)

| Gate | Result |
|---|---|
| `npm run lint`, `format:check`, `typecheck`, `npm --prefix frontend run build`, `check:schemas`, `check:openspec` | all exit 0 |
| `openspec validate pipeline-detail-step-spine --type change` | valid |
| `npm test` (3 workers) | root 469 tests; frontend 616 suites / 7360 tests; 0 failed |
| Pipeline page and CommandBar suites (`--json`, paths `.../HEL-1579/frontend/src/...`) | 305 tests, 0 failed (`spine.test` 43, `spineEditing.test` 38, `PipelineDetailPage.test` 132, ...) |
| Playwright, 2 workers, servers 7011/9918 (cwd = this worktree, DB `helio_hel1579`) | 38 passed. Covers:<br>- `focus-presence-guard` (incl. pipeline-detail, dark and light)<br>- `state-surface-contrast-guard` (incl. pipeline-detail, dark and light)<br>- `hel908-step-card-split`<br>- `hel1007-multi-root-reorder`<br>- all 8 tests of `hel1579-pipeline-spine-layout`: the accent audit (both themes, two presets), 1280x800 no-scroll with ≥8 rows, 1440x900, 820/900/1100/1280 with a paused schedule, selection, lanes, and the flush test |

The four specs the executor did not re-run after the chip change (focus-presence, state-surface, hel908-step-card-split, hel1007) are green.

### Running-app measurements (paused 15m schedule, 24-character name "newshist-pipe-runs-trend"; dark and light measured identically)

| Width | Chip | Header | Document scroll | Name vs neighbours |
|---|---|---|---|---|
| 820 | icon + "Paused", title "Every 15m · paused" | one row, 44px | none | **name box 316–434px overlaps the "Succeeded" status chip at 411px** |
| 860 | icon + "Paused" | one row | none | no overlap (name right 443, status left 451) |
| 900 | icon + "Paused" | one row | none | no overlap |
| 1100 | "Every… Paused" (ellipsized) | one row | none | no overlap |
| 1280 | "Every 15m Paused" | one row | none | no overlap; spine + editor in view, 10 preview rows |
| 1440 | "Every 15m Paused" | one row | none (`<main>` 852/852) | no overlap |

Other cases checked at 820:
- An enabled cron schedule shows the icon only, with title "0 6 * * * · next run …".
- No schedule shows the icon with name/title "Add schedule".
- At 390px the phone river is unchanged: tabs plus 3 step cards, spine class absent.

### Phase 1: Spec Review — PASS

- Cycle-2 CR1 is resolved. The schedule chip is never dropped: compact at ≤1100px, icon plus "Paused" at ≤900px, full state in the title. This matches the ticket's header element list, and the "Paused" state is visible at every desktop width.
- Cycle-2 CR2 is resolved. `specs/pipeline-detail-spine-layout/spec.md` records the narrow-width header rules (crumb hidden, meta truncates first, compact/icon chip, 14-character name) with the scenario "Paused schedule stays visible when narrow". `specs/pipeline-schedule-config-ui/spec.md` and design.md D3 are updated to match.
- All ACs remain met (verified across cycles 1–3; AC 4 re-measured this cycle in both themes).
- Non-retired CONSTRAINTS C1–C8 remain honored.

### Phase 2: Code Review — PASS (gates green)

Minor, non-blocking:
- `SpineScheduleChip.tsx` uses `size={14}` where the shared `ICON_SIZE.sm` (= 14, `shared/ui/iconSize.ts:4`) exists; the rest of the spine uses `ICON_SIZE.sm`.
- The comment block at `PipelineSpineHeader.css:241-243` now sits above the `.spine-header__chip-icon` rule and the ≤900px block instead of the ≤1100px block it describes.
- `files-modified.md` "Cycle 2" item 3 still says "At or below 1100px the schedule chip is hidden", superseded by the Cycle 3 entry below it.

### Phase 3: UI Review — FAIL

1. **Header overlap at 769px to somewhere below 860px with a realistic pipeline name.**
   - At 820px the name button ("newshist-pipe-runs-trend") spans x = 316–434, while its `nav.spine-header__crumbs` container ends at 403 and the "Succeeded" status chip starts at 411. The status chip paints over the name's tail: the screenshot reads "newshist-pi.Succeeded" (`eval1579c3-dark-820.png`, `eval1579c3-light-820.png`). Same in both themes.
   - Root cause: `PipelineSpineHeader.css:278-279` gives `.spine-header__name` `min-width: 14ch` at ≤1100px. Its parent `.spine-header__crumbs` (`:12-16`) is `flex: 0 1 auto; min-width: 0`, so the nav shrinks below its child and the name overflows into the next flex item.
   - This was introduced by the cycle-2 `min-width` combined with the cycle-3 chip taking about 83px back. The cycle-2 e2e had no chip at this width and a shorter name in the manual run.
   - The e2e "820/900/1100/1280" test seeds exactly this name but asserts only the name's own visible width (≥ 110px), not that it ends before the status chip, so it passes over the overlap.
2. Observation, not a failure: at ≤900px with a long name, the "rows written · last run" meta truncates to 0px. Spec and design say "the meta text truncates with an ellipsis first", so this is within the recorded rule. The ticket lists rows written in the header, though; consider whether to keep at least the count.

Everything else passes:
- the accent audit;
- focus and state-surface guards on pipeline-detail in both themes;
- no console errors beyond the pre-existing `404 GET …/schedule` for a pipeline without a schedule;
- no Delete anywhere;
- breadcrumb not duplicated;
- lanes labelled and selectable;
- phone path unchanged;
- HEL-1585 symptom absent on this page at 1440x900.

Evidence (persisted), all under `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/`:
- `eval1579c3-dark-820.png`, `-dark-900.png`, `-dark-1100.png`, `-dark-1280.png`, `-dark-1440.png`
- `eval1579c3-light-820.png`, `-light-900.png`, `-light-1100.png`, `-light-1280.png`, `-light-1440.png`

### Overall: FAIL

### Change Requests

1. **Stop the name overflowing into the status chip at narrow desktop widths** (`PipelineSpineHeader.css:12-16`, `:278-279`).
   - Move the at-≤1100px floor from the name to its container: put `min-width: 14ch` (or `min-width: min-content`) on `.spine-header__crumbs`. Keep `.spine-header__name` at `min-width: 0` with its existing ellipsis, so the nav reserves the name's space and the name can never extend past its container.
   - Extend `e2e/hel1579-pipeline-spine-layout.spec.ts` "820/900/1100/1280" with an assertion that the name button's right edge is ≤ the run-status chip's left edge, and that no two header children's boxes intersect. Check that this new assertion fails on the current CSS before applying the fix, since the seeded name "newshist-pipe-runs-trend" reproduces the overlap at 820.

### Non-blocking Suggestions

- Use `ICON_SIZE.sm` in `SpineScheduleChip.tsx` instead of the literal `14`.
- Move the narrow-width comment at `PipelineSpineHeader.css:241-243` back above the `@media (max-width: 1100px)` block.
- Fix the stale "schedule chip is hidden" line in `files-modified.md` Cycle 2 item 3, so the PR body built from it is accurate.
- Consider keeping the row count (e.g. "14 rows") visible when the meta truncates at ≤900px.
- The schedule chip's `aria-label="Edit schedule"` overrides its visible "Paused" text. The state reaches assistive tech only through `title` (accessible description). Consider folding the state into the label, e.g. "Edit schedule, paused".
- `PipelineSpine.tsx` (346 lines) remains over the ~250 soft budget.

### Critical Path (final cycle)

The implementation is functionally complete. Every acceptance criterion is met and verified in the running app and by gates:
- every step kind is editable in the focused editor;
- no edit is lost on selection change;
- persisted per-step counts are RLS-proven;
- lanes are labelled and selectable;
- 1280x800 shows the spine, the editor and ≥8 rows without scroll;
- the accent audit is mutation-proven failable.

The single remaining blocker is a small, cosmetic-but-observable CSS overlap in the header at narrow viewport widths (overlap measured at 820px, none at 860px) when the pipeline name is long (CR1): a two-rule CSS fix plus one e2e assertion.

Recommendation for the human: either allow a short fix-forward of CR1 (low risk: CSS-only, scoped to `.spine-header` at ≤1100px, no behaviour change), or accept the PR with CR1 filed as a follow-up ticket against HEL-1579. The overlap affects only narrow desktop windows with names longer than about 14 characters, and touches no data path.
