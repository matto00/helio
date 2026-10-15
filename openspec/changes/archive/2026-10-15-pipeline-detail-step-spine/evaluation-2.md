## Evaluation Report — Cycle 2 (evaluation-2.md)

**What was reviewed:**
- HEAD `f614a02fd318e17ac5ca1ab6fea54b4e59ed1df4`, base `cd64409ad828d9024074f907a7ea32800ab71ff3`.
- The cycle-2 delta is `7ff453641..f614a02fd`: it touches only frontend, e2e and change-dir files. The backend is unchanged since cycle 1, whose `sbt testFull` (8139 passed, 0 failed) and RLS spec (6/6) still stand.

### Gate evidence (fresh runs, this worktree)

| Gate | Result |
|---|---|
| `npm run lint`, `format:check`, `typecheck`, `npm --prefix frontend run build`, `check:schemas` | all exit 0 |
| `openspec validate pipeline-detail-step-spine --type change` | valid |
| `npm test` (3 workers) | root 469 tests; frontend 616 suites / 7360 tests (+3 vs cycle 1); 0 failed |
| Spine suites (`--json`, `.../HEL-1579/frontend/...`) | `PipelineDetailPage.spine.test.tsx` 43 passed, `.spineEditing.test.tsx` 38 passed |
| CR1 test red against the old code | In a throwaway detached worktree at HEAD with `useStepCardPersist.ts` reverted to `7ff453641`, "re-selecting the edited step ..." FAILS ("Unable to find an element with the display value: 240"). The worktree was removed afterwards (`git worktree list` shows none). |
| Playwright, 2 workers, servers 7011/9918 (cwd = this worktree) | 40 passed: hel1579 spine spec (8, including the new 820/900/1100 test), hel908-step-card-split, hel1345, hel958, hel1007, state-surface-contrast-guard, focus-presence-guard |

### Cycle-1 change requests

- **CR1 (flush keeps page state): FIXED.** In the running app (pipeline `47b36d2f…`), the full reproduction now holds:
  - Edit the filter value 260 → 270, then select step 2. The server stores 270.
  - Re-select step 1. The editor shows **270** and the spine summary shows `duration_s ≥ 270`.
  - Click "ANY (OR)". The server stores `{"combinator":"OR","conditions":[{…"value":"270"}]}`.

  The new unit test is a real red-green guard (shown above).
- **CR2 (last-row insert test + ledger): FIXED.** `spineEditing.test.tsx:252` asserts no position, the new step last, and the new step selected. The ledger now cites file:line.
- **CR3 (narrow-desktop editor): FIXED for the editor.** The filter field / operator / value / remove control widths (px), measured in both themes:
  - 820 → 148 / 180 / 180 / 28 (stacked)
  - 900 → 228 / 260 / 260 / 28
  - 1100 → 145 / 101 / 174 / 28
  - 1280 → 203 / 142 / 243 / 28

  The header is 44px tall (one row) at every width. The document never scrolls (`scrollHeight == innerHeight`, `scrollWidth == innerWidth`) at 820/900/1100/1280/1440 in dark and light. The name keeps 123–134 of its 134px.
- **CR4 (marker states in the row name): FIXED.** In the running app the row reads "Step 3: Compute column, 14 rows, has a validation error". Tests cover the validation, warnings and save-error states.
- **1280x800 AC re-check: holds** in both themes. Spine and editor fully in the viewport, 10 of 10 preview rows visible, no document scroll. At 1440x900 the document and `<main>` (852/852) do not scroll.

### Phase 1: Spec Review — FAIL

1. **The schedule chip disappears on desktop at ≤1100px.** This diverges from the ticket and from this change's own specs.
   - What ships: `PipelineSpineHeader.css:250-253` sets `.spine-header__chip { display: none; }` inside `@media (max-width: 1100px)`.
   - The ticket's header spec lists "a schedule chip ('Add schedule' when there is none)".
   - This change's spec delta `specs/pipeline-schedule-config-ui/spec.md:12` says: "On desktop there is no schedule bar: the header's schedule chip shows the state."
   - `specs/pipeline-detail-spine-layout/spec.md` "The header is one row …" requires the chip. design.md D3 allows only "the meta text truncates with ellipsis" at 820–1100.
   - Observed with a paused 15-minute schedule (pipeline `73d6332c…`):
     - At 1280 and 1440 the chip reads "Every 15m Paused".
     - At 1100, 900 and 820 there is no chip, so the page shows **no schedule state at all**. Only the menu's "Edit schedule / Resume schedule" items hint at it. The context list's "Scheduled" section says "Nothing scheduled.", because paused schedules are not listed there.
     - At 1100 there is visible free room: the meta is 230px with about 100px to spare before Dry run (`eval1579c2-dark-1100.png`). So the chip is dropped where it fits.
   - The new e2e narrow test seeds no schedule, so it cannot see this.
2. **The "Pipelines" breadcrumb is hidden at ≤1100px** (`PipelineSpineHeader.css:245-248`, from cycle 1). The spec requirement says the header "SHALL show a 'Pipelines' breadcrumb", and no delta records the narrow-width exception. The command bar's "Data Pipelines" section label arguably covers it, so this is a planning-artifact accuracy issue rather than a UX defect.

Constraints C1–C8: no regressions from cycle 2. The cycle-2 CSS is scoped to `.pipeline-detail-page--spine` and the spine header, so the phone path is untouched (C4).

### Phase 2: Code Review — PASS

- **Flush fix:** the `onConfigChange` it calls is read from the `latest` ref, so it is the page-level `handleStepConfigChange`, which is safe after the editor unmounts. It is called only on success, and the failure path is unchanged.
- **Container query:** `container-type: inline-size` on `.spine-body__main`. The two `@container` steps are scoped to the spine page and tokens-only.
- **Accessible-name additions** are a pure string join.
- No dead code, no new soft-budget growth beyond the cycle-1 note.

### Phase 3: UI Review — FAIL

The only failure is item 1 above: the schedule state is not observable at ≤1100px. Everything else passes in both themes:
- Accent: the audit passes in e2e (both themes, two presets).
- No document scroll at any measured width.
- One-row header at every width.
- Editor controls usable at 820/900.
- Breadcrumb in the command bar shows the section label only.

The only console errors are the pre-existing `404 GET …/schedule` on the pipeline without a schedule.

Evidence (persisted), all under `/home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.playwright-mcp/`:
- `eval1579c2-dark-820.png`, `-dark-900.png`, `-dark-1100.png`, `-dark-1280.png`, `-dark-1440.png`
- `eval1579c2-light-820.png`, `-light-900.png`, `-light-1100.png`, `-light-1280.png`, `-light-1440.png`

### Overall: FAIL

### Change Requests

1. **Keep the schedule chip, and the state it shows, on desktop at ≤1100px** (`PipelineSpineHeader.css:250-253`).
   - Replace `display: none` with a compact chip:
     - a `max-width` (e.g. about 12–16ch) with `text-overflow: ellipsis`;
     - the Paused marker kept visible, since it is the state that matters;
     - the full text ("Every 15m, paused, next …" / "Add schedule") in the chip's accessible name and `title`.
   - Let the meta (`Last run metadata`) truncate first, as design D3 specifies.
   - If at 820px the chip genuinely cannot fit beside the name (keep the name's `min-width: 14ch`), collapse it to an icon-only button. Its accessible name and `title` must carry the state, and a visible "Paused" marker must remain when the schedule is disabled. The schedule state must stay observable on the page at every desktop width.
   - Extend `e2e/hel1579-pipeline-spine-layout.spec.ts` "820/900/1100px". Seed a **paused** interval schedule (`PUT /api/pipelines/:id/schedule {kind:"interval", expression:"15m", timezone:"UTC", enabled:false}`). Assert at each width that the chip is visible, its accessible name contains "Paused", and the header stays one row (< 60px). Also assert the no-schedule case still shows an "Add schedule" control.
2. **Record the narrow-width header behaviour in the planning artifacts.**
   - In `specs/pipeline-detail-spine-layout/spec.md`, requirement "The header is one row with a single primary action", add the exception: at or below 1100px the "Pipelines /" crumb yields to the command bar's section label. Add whatever compact-chip rule CR1 lands on, with a scenario.
   - Update design.md D3's "820–1100" sentence to match.

### Non-blocking Suggestions

- `PipelineSpine.tsx` (346 lines) is still over the ~250 soft budget; the row-menu builder is the natural extraction.
- In `accentAudit.ts`, note that the default orange accent collides in hue with the warning token, so callers must use non-orange presets.
