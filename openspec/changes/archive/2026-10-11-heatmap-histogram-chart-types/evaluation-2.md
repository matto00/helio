## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `8ff998eab665f6a7415857a252e18f91e1a1c973`. The base was resolved live as `a29a7e5ce` (origin/main). This cycle's delta is `8b032560f..8ff998eab`.
Everything in evaluation-1.md that this delta does not touch still stands. Fresh evidence for this cycle is in `.concertino/runs/HEL-1311/evidence/eval-2/`: `c2-probe-log.txt` and `c2-bins-invalid-save-blocked.png`.

### Phase 1: Spec Review — PASS

- **CR-1 (bin count): fixed.** The flow is:
  1. `HistogramBinCountField` reports `onInvalidChange`.
  2. `useOutputKindState` holds `binCountInvalid`.
  3. `OutputEditorFooter` gets `saveBlocked` (only for kind `chart`) and disables Save.
  - An unmount cleanup clears the flag, so switching away from Histogram never leaves Save stuck.
  - Red evidence (`red-cycle2-bincount-save.txt`): both new tests failed against the cycle-1 code ("Received element is not disabled").
- **CR-2 (panel appearance test): fixed.** `ApiRoutesSpec` now PATCHes `/api/panels/:id` with `heatmap` and `histogram` (200, stored) and with `area` (400, the body lists all six `ChartTypes.All`). Red by mutation, with `histogram` dropped from `ChartTypes.All`, is recorded in `red-cycle2-panel-appearance.txt` (400 ≠ 200).
- **CR-3 (design.md): fixed.** D4, D6 and D7 now describe what was built:
  - D4: the two-stop ramp with end labels, the regex resolver, and `HEATMAP_COMPACT_*`.
  - D6: `onChartReady` / `useHeatmapDefaultCursor`, with the hook guard dropped.
  - D7: `HistogramBinCountField`, and Save is blocked on an invalid draft.
- files-modified.md records the cycle-2 changes.
- CONSTRAINTS C1–C5 are still honoured. The new commit has no session link or `Claude-Session` trailer.

### Phase 2: Code Review — PASS

Gates I ran fresh on `8ff998eab` in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run check:schemas` | exit 0 (schema-drift green) |
| `npm --prefix frontend test` | 514 suites / 5357 tests / 19 snapshots passed |
| `npm --prefix frontend run build` | exit 0 |
| Backend, targeted (`sbt testOnly`, `-J-Xmx3g`, nice 19, MemAvailable ~54 GB) | 238 tests passed, 0 failed, 6 suites |

The backend specs run were `ApiRoutesSpec`, `OutputConfigValidationSpec`, `OutputHeatmapHistogramSpec`, `OutputConfigKeyValidationSpec`, `ChartTypesSchemaGuardSpec` and `OutputSummaryReducerSpec`.

I did not re-run full `sbt testFull`. The backend delta is a rename of a method-local `val` (`scatterCheck` to `nonAggregatingCheck`, checked by the compiler, with no behaviour change) plus one new test case. Every suite that touches either one is in the targeted set. The full suite was green on `8b032560f` in cycle 1 (6673 passed).

Code notes:
- The wiring is minimal and typed.
- `onInvalidChange` is a stable `useState` setter, so the cleanup effect does not churn.
- The panel test uses a `divider` panel to reach the shared `validateChartType` appearance path. That is acceptable: the validation does not depend on panel type.
- No new DESIGN.md surface was added. Save uses the existing disabled button state.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on 6743/9650 and `assert-phase` passed. I stopped them by exact PID afterwards and both ports are free. A fresh throwaway user was used. Results of the live check (`c2-probe-log.txt`):

| Step | Save button | Stored `binCount` |
| --- | --- | --- |
| Enter 12 and Save | enabled | 12 |
| Edit to "1" | **disabled**, role=alert shown | — |
| Force-click the blocked Save | still disabled | still 12 |
| Switch the chart type to Bar while the draft is invalid | re-enabled | — |
| Cancel, reopen, enter 7, Save | enabled | 7 |

The only console errors were the pre-existing `GET /api/pipelines/:id/schedule` 404 (no schedule set, not in this diff).

The cycle-1 Phase 3 results (themes, breakpoints, overlay, History, cursor, clicks) were not touched by this delta. Its frontend changes are limited to the editor's bin-count and Save wiring.

### Overall: PASS

### Non-blocking Suggestions

- These cycle-1 suggestions still stand:
  - "Field field" accessible name in `ChartSlotFields.tsx`.
  - Note the compile-only mutation A of the frontend guard in the PR.
  - State the mutation-after-implementation ordering of some frontend tests in the PR.
- Residue: probe user `9fbb4180-cf95-4021-828f-d7ceab2d4a3c` remains, because there is no user-delete API. Its dashboard, pipeline and source were deleted by exact id (204).
