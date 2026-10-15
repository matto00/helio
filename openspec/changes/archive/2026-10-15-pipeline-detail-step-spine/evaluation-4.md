## Evaluation Report — Cycle 4 (evaluation-4.md, owner-granted extra cycle)

**Scope:**
- Reviewed HEAD: `2bd0dc7ca1fa76f8c7d0921fde4524a80fc130fb`. Base: `cd64409ad828d9024074f907a7ea32800ab71ff3`.
- Delta since cycle 3 (`5da09741d..2bd0dc7ca`):
  - `PipelineSpineHeader.css`: the 14ch floor moved from the name to `.spine-header__crumbs`, the name is now `min-width: 0`, and `.spine-header__meta` is hidden at ≤900px. The misplaced comment was also moved.
  - `SpineScheduleChip.tsx`: uses `ICON_SIZE.sm`, and the aria-label is "Edit schedule, paused" when disabled.
  - The e2e test gained a header no-overlap assertion.
  - One jest selector was updated.
  - Docs only: spec delta and design D3 now record the ≤900px meta rule.
- Backend: unchanged since cycle 1 (`sbt testFull` 8139 passed / 0 failed; RLS spec 6/6 on the non-BYPASSRLS pool).

### Gate evidence (fresh runs, this worktree)

| Gate | Result |
|---|---|
| `npm run lint`, `format:check`, `typecheck`, `npm --prefix frontend run build`, `check:schemas`, `check:openspec` | all exit 0 |
| `openspec validate pipeline-detail-step-spine --type change` | valid |
| `npm test` (3 workers) | root: 469 tests. Frontend: 616 suites / 7360 tests. 0 failed |
| Spine suites (`--json`, `.../HEL-1579/frontend/src/...`) | `PipelineDetailPage.spine.test.tsx` 43 passed; `.spineEditing.test.tsx` 38 passed |
| Playwright, 2 workers, servers 7011/9918 (cwd = this worktree) | **38 passed**. Covers `hel908-step-card-split`, `hel1007-multi-root-reorder`, `focus-presence-guard` (incl. pipeline-detail, both themes), `state-surface-contrast-guard` (incl. pipeline-detail, both themes), and all 8 `hel1579-pipeline-spine-layout` tests (accent audit; 1280x800 no-scroll with ≥8 rows; 1440x900; 820/900/1100/1280 with a paused schedule and the new overlap check; selection; lanes; flush) |

### Cycle-3 CR1 (name running under the status chip): FIXED, and the assertion is failable

Measured after `document.fonts.ready` at 820px with the seeded 24-character name and a paused schedule.

**Overlap is gone, both themes.**

| Theme | Name ends | "Succeeded" chip starts |
|---|---|---|
| Dark | x = 436 | x = 444 |
| Light | x = 436 | x = 444 |

- In the dark run, the e2e's own box logic returns no failures over 6 header items.
- The name ellipsizes inside its container (120 of 218 px visible).

**The new assertion goes red on the old layout.**
- Method: re-impose the cycle-3 rule in the live page (`.spine-header__crumbs{min-width:0}` and `.spine-header__name{min-width:14ch}` at ≤1100px), then run the assertion's exact `evaluate` body.
- Result: `"spine-header__name" (right 434) overlaps "ui-status-chip" (left 419)`.
- Removing the injected rule returns it to no failures.

### Judgment: hiding the rows-written meta at ≤900px

The ticket's header list includes "rows written plus relative last run". The decision to hide it at ≤900px is acceptable:
- At ≤900px the meta had already truncated to 0 px in cycle 3, so hiding it removes an empty element, not visible information.
- The run status chip still shows the last run's outcome, and in-session runs still show "Snapshot replaced: N rows" / "Preview: N rows" in the status chip.
- The figures stay in Run history.
- The ticket's header spec describes the full layout; the ACs bind only 1280x800.
- The rule is now explicit in `specs/pipeline-detail-spine-layout/spec.md` and design D3.

Not a finding.

### Phase 1: Spec Review — PASS

- Every AC remains met and verified across cycles:
  - Focused editor for every step kind; no lost edits.
  - Per-step counts persisted, RLS-proven.
  - Lanes labelled and selectable.
  - 1280x800 shows spine, editor and 10 rows without scroll, in both themes (re-measured this cycle).
  - Accent only on Run, the selected step and focus (e2e audit, mutation-proven in cycle 1).
- Planning artifacts reflect the implemented narrow-width header.
- C1–C8 honoured.

### Phase 2: Code Review — PASS

- Gates are green.
- The cycle-3 non-blocking items are addressed: `ICON_SIZE.sm`; the comment placement; the paused state in the chip's accessible name; the stale `files-modified.md` line.

### Phase 3: UI Review — FAIL

1. **At 769–~835px the header now overflows its own width, cutting off the "Pipeline actions" menu (and at the low end, Run).**
   - Cause: the cycle-4 fix moved the 14ch floor onto `.spine-header__crumbs`, so the header's minimum content width is 529 px. That is: crumbs 120 + status chip 82 + compact schedule chip 83 + Dry run 68 + Run 96 + actions 28 + gaps, plus 2 x 12 px padding.
   - At 820px the header's client width is only 516 px (`scrollWidth 529 > clientWidth 516`).
   - The right-most controls are pushed past the viewport edge, while the document itself does not scroll (`scrollWidth == innerWidth`).

   | Viewport | "Pipeline actions" (⋮) position | Run pipeline position |
   |---|---|---|
   | 820 | x 805–833: 13 px off-screen, half visible | inside |
   | 780 | x 805–833: fully off-screen | x 701–797: right 17 px cut |
   | 840 | inside | inside |
   | 860 | inside | inside |
   | 900 | inside | inside |
   | 1100 | inside | inside |
   | 1280 | inside | inside |

   - The menu is the only route to Rename, schedule Edit/Pause/Resume, Run history, Share and Edit source.
   - Same numbers in dark and light.
   - Evidence: `eval1579c4-dark-820.png`, `eval1579c4-dark-780.png`, `eval1579c4-light-820.png`.
   - Why the e2e misses it: "820/900/1100/1280" asserts the schedule chip is inside the viewport and that items do not overlap each other, but never that the **last** header control ends inside the viewport (or that `.spine-header` does not overflow). The cut-off passes.

2. **At ≈769–800px the focused editor's action row also overflows.** This is pre-existing (from cycle 2, missed in my earlier cycles, which measured from 820 up).
   - At 780 the centre column is 206 px.
   - The editor's `scrollWidth 213 > clientWidth 172`.
   - "Remove" spans x 743–804, so it is cut at the viewport edge.

Workaround the user already has: collapsing the context list (HEL-1574) gives these widths about 248 px back.

Everything else passes in both themes:
- Schedule state is visible at every width.
- One-row header.
- No document scroll at 820/900/1100/1280/1440.
- The focus and state-surface guards.
- No Delete.
- No breadcrumb duplication.
- Phone path unchanged.
- HEL-1585 symptom absent at 1440x900 (`<main>` 852/852).

Evidence (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/eval1579c4-{dark-780,dark-820,dark-900,dark-1100,dark-1280,light-820,light-1280}.png`

### Overall: FAIL

### Change Requests

1. **Make the header fit at every desktop width from 769px**, so no control is ever pushed past the edge (`PipelineSpineHeader.css`, the `@media (max-width: 900px)` block).
   - The ≤900px row needs to shed about 70 px at 769px. Options, in this order:
     - make the run-status chip compact at ≤900px (icon/dot plus its accessible name `Run status: …` / "Succeeded", text hidden);
     - lower the crumbs floor at ≤900px to about `8ch`;
     - make Dry run an icon button at ≤900px, keeping its "Dry run" accessible name.
   - Run and the "Pipeline actions" trigger must never shrink or move.
   - Extend `e2e/hel1579-pipeline-spine-layout.spec.ts` "820/900/1100/1280":
     - add 769 to the widths;
     - assert `.spine-header`'s `scrollWidth <= clientWidth`;
     - assert the "Pipeline actions" button's right edge ≤ viewport width.
   - Show it red on the current CSS (820 fails today) before the fix.
2. **Keep the focused editor's action row inside the centre column at 769–800px** (`StepCardFocused.css`). Let `.step-focused__actions` wrap below the title (`flex-wrap: wrap`, or move it to its own row in the ≤340px container query). Assert in the same e2e at 769 that the "Remove step" button's right edge ≤ viewport width.

### Non-blocking Suggestions

- `PipelineSpine.tsx` (346 lines) remains over the ~250 soft budget.

### Critical Path (final, extra cycle)

The product work is complete and correct. Every acceptance criterion is verified by gates and in the running app at the AC's own width (1280x800) and at 1440, in both themes. The persistence, RLS and data-loss fixes are solid.

The only remaining defects are layout at the narrowest desktop band (769 to ~835px) with the context list expanded:
- the header's right-most controls are clipped;
- the editor's "Remove" is clipped below about 800px.

Both are CSS-only fixes scoped to the spine page.

Recommendation for the human: this is the last granted cycle, so choose one of two paths.
- **Accept and merge with a follow-up ticket** for CR1/CR2. They are CSS-only, affect only 769–835px windows with the context list expanded, have a workaround (collapse the list) and touch no data path. This is the lower-risk route, since the phone layout below 768px is unaffected and HEL-1582 will revisit narrow layouts.
- **Grant one more short fix-forward**, limited to the two CSS rules and the e2e assertions above.
