# Files Modified — HEL-830

- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css` — snapped 2 off-scale `6px` gaps to `--space-1` (4px)
- `frontend/src/features/dashboards/ui/DashboardList.css` — snapped `30px`→`--space-7`, `6px`→`--space-2`, `7px`→`--space-2` (badge/pill padding, filter-input padding)
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.appearance.css` — snapped 4× `6px` gaps to `--space-1`, `14px` padding-top to `--space-4` (matches sibling section-divider recipe)
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.binding.css` — snapped `14px` gap to `--space-4`, 2× `7px 10px` input padding to `--space-2 --space-3`, `6px` badge padding to `--space-2`, `6px` select padding to `--space-1 --space-2`, `7px` metric-deprecated padding to `--space-2`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.css` — snapped `10px` banner padding to `--space-3`, `5px` button padding to `--space-1`
- `frontend/src/features/panels/ui/grid/PanelGrid.css` — snapped `7px` invalid-badge padding to `--space-2`
- `frontend/src/features/panels/ui/renderers/TimelineRenderer.css` — snapped `5px` margin-top to `--space-1`
- `frontend/src/features/pipelines/ui/CreatePipelineModal.css` — snapped `14px` form-stack gap to `--space-4`
- `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.css` — snapped `5px` gap to `--space-1`
- `frontend/src/features/pipelines/ui/OutputsRail.css` — snapped `14px` padding to `--space-4` (coupled shared-left-edge cluster), updated the HEL-1022 comment's `14px` reference to `16px`
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — snapped `14px`→`--space-4` (×2), `6px`→`--space-2` (×2, badge padding)
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — snapped all 50 remaining literals (46 line-level edits) across the file: the `14px` cluster (step-card-header/body, add-tail-row margin) to `--space-4`, `60px` empty-state padding to `--space-10`, and per-context 5/6/7/10px sites per design.md's policy table; updated inline comments for every deviation from mathematically-nearest
- `frontend/src/features/pipelines/ui/PipelinesPage.css` — snapped `10px` table-cell padding to `--space-2`, `5px` gap to `--space-1`, `4px 10px` button padding to `--space-1 --space-2`
- `frontend/src/features/pipelines/ui/RunHistoryModal.css` — snapped `6px` list gap to `--space-2`, `10px` row padding to `--space-3`, `6px` row-gap to `--space-1`, `10px` error-banner padding to `--space-3`
- `frontend/src/features/settings/ui/AgentMemoryList.css` — snapped `10px` table-cell padding to `--space-2`
- `frontend/src/features/sources/ui/AddSourceModal.css` — snapped `14px` form gap to `--space-4`, `5px`→`--space-1`, `6px`→`--space-1` (type-toggle), `6px`→`--space-1` vertical (fields-table th), `4px 6px`→`--space-1 --space-2` (cell input/select)
- `frontend/src/features/sources/ui/SourceDetailPanel.css` — snapped `10px`→`--space-2` (title-row gap), `6px`→`--space-1` (×2), `10px`→`--space-2` (delete-btn padding), `6px 10px`→`--space-2 --space-3` (schema th), `5px 10px`→`--space-1 --space-3` (schema td), `10px`→`--space-3` (empty-schema padding)
- `frontend/src/features/sources/ui/SourceListTable.css` — snapped `10px` table-cell padding to `--space-2`
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — regenerated `SPACING_BASELINE` from scratch (102 off-scale entries → 10 remaining, all within the ≤4px optical-tweak allowance HEL-830 doesn't target); confirmed RED (temporarily reverted one snap) then GREEN per design.md's regeneration procedure

## Not modified (verification/evidence only, not committed)

- Touch-target measurement and before/after screenshot capture used two temporary, uncommitted Playwright specs (`e2e/hel830-touch-target-measure.spec.ts`, `e2e/hel830-screenshots.spec.ts`) to unblock dev-server rendering. Both were deleted before the CSS commit — neither is part of the diff.
- Evidence artifacts (screenshots, measurement logs) live under `.concertino/runs/HEL-830/evidence/screenshots/`, not in the repo tree proper.

## Correction (2026-09-10, driver-caught): the RotateCcwClock "fix" was reverted — its premise was false

An earlier cycle of this ticket introduced an unrelated commit changing `RotateCcwClock` → `RotateCcwIcon` in `RunHistoryModal.tsx`/`AuditHistorySection.tsx`, believing `RotateCcwClock` was not exported by the installed `lucide-react` and was blocking `npm run typecheck`/`build`/7 Jest suites on `main` itself. **That premise was false and the fix has been reverted — both files are back to `origin/main`'s `RotateCcwClock` import/usage, unchanged, at all four sites.**

Root cause of the false premise: the worktree's `frontend/node_modules/lucide-react` was installed at `1.14.0`, 26 minor versions stale relative to `package.json`/`package-lock.json`'s pinned `^1.40.0` — a local dependency-tree drift, not a `main` defect. `RotateCcwClock` is a real, canonical export in `lucide-react@1.40.0` (verified via `npm pack lucide-react@1.40.0` + grepping the shipped `.d.ts`), and it is a semantically distinct glyph from `RotateCcwIcon` (a clock-with-history-arrow vs. a generic counter-clockwise arrow) — the erroneous substitution would have silently swapped the history icon for a generic undo icon on the two surfaces where history is the subject ("No audit events yet", the run-history empty state).

After `npm ci` synced the installed tree to the lockfile's `1.40.0`, `npm run typecheck` (and lint/format/test) are green with `RotateCcwClock` unchanged — confirming CI (which always does a clean lockfile install) was never actually broken by this; PR #623 (HEL-443, the commit this ticket branched from) passed every CI check including `ci-complete`. **Every local gate run during this ticket's earlier cycles ran against that stale dependency tree** — this does not invalidate the CSS spacing work (which never touched dependencies), but "local typecheck/build/Jest" during those cycles was not measuring the same thing CI measures. The gates above were re-run post-`npm ci`, post-revert, and are clean.
