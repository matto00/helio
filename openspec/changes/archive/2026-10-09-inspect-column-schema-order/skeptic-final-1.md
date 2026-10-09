## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: d78613d19a6db031b0865abce19bd7092fdf56d2. Base resolved live with resolve-review-base.sh: 68af567556efdf014314028e9d5bd266923f6570.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/inspect-column-schema-order/HEL-1394`.
- **Scope ruling, checked at the source rather than taken from the brief:** `/home/matt/Development/helio/.concertino/runs/HEL-1394/events.jsonl` line 20 is `escalation.answered`, with `answer=ship-frontend-and-file-backend-followup`, `answer_source=human`, `resolution_channel=chat` and `escalation_id=HEL-1394-1791544000160-b74b22`. That id matches the `escalation.raised` on line 19. HEL-1443 exists in Linear (Backlog). It covers the backend schema sort (`SchemaInferenceEngine` `sortBy(_._1)`, `PipelineRunSucceededWrites`) and the `TableRenderer.deriveKeys` fallback, so it is not a duplicate.
- **Diff** (`git diff 68af5675...HEAD`): 15 files. The source changes are `inspectColumnOrder.ts` (new), `PanelInspectView.tsx` (+9), `usePanelCardInspect.ts` (+10) and `chartClickSelection.ts` (+4). The rest is tests and openspec artifacts. There are no backend changes.
- **AC tracing:**
  - **AC1 (ordering contract):** `inspectColumnKeys` emits the present `columnOrder` keys first, then the schema names, then the leftover keys. `PanelInspectView.tsx` passes `columns={gridColumns}` to `DataGrid`, so DataGrid's natural-sort `deriveColumns` (DataGrid.tsx:396) no longer runs when a hint exists.
    - Both mounts are covered. `PanelCard.tsx` passes the single `chartInspectConfig` from `usePanelCardInspect` to its own `PanelInspectView` and to `PanelFullscreenOverlay`, which renders `PanelInspectView` at line 262.
    - Under Owner Ruling 2, the visible effect is deferred to HEL-1443. Evaluator screenshot `eval-shots/03-inspect-grid-dark.png`, which I viewed, still shows `amount_usd, category, date, merchant`. That matches the alphabetical stored schema, as the ruling describes.
  - **AC2 (both row paths):** both paths feed one `gridRows` memo, and `gridColumns` is derived from it. Tests "orders raw-row…" and "orders aggregate-group…" assert the exact header order `date, category, merchant, amount_usd`.
  - **AC3 (no column hidden):** `rest = rowKeys.filter(!emitted)` is natural-sorted and appended, so no key is dropped. Stale `columnOrder`/schema keys are skipped through the `present` set. The tests "never drops a row key", "skips stale…" and "puts columnOrder ahead… still shows every column" cover this.
  - **AC4 (no new fetch):** the hint is built inside the existing `useMemo` over `output` from `useOutputMeta`. There is no new call.
  - **AC5 (red-first unit tests):** the four required cases are present in `inspectColumnOrder.test.ts`. They are red against pre-change code by construction:
    - Before the change, `PanelInspectView` passed no `columns`, so `deriveColumns` natural-sorts to `amount_usd, category, date, merchant`. That differs from the asserted `date, category, merchant, amount_usd`.
    - Before the change, `ChartInspectConfig` had no `columnOrderHint`, so the hook test's `toEqual({schema: [...]})` would fail on `undefined`.
    - I did not run a mutation, because I do not modify code. This red claim rests on reading the code.
- **Constraints:**
  - **C1:** met. The tests use the ticket's example and assert the exact header order on both paths.
  - **C2:** met. The hook test asserts the real values derived from a mocked Output, `schema: ["date","category","merchant","amount_usd"]` and `columnOrder: ["merchant"]`. The helper ignores non-string entries through a `typeof` guard, which the test `[ "b","b",3,null,"a" ] -> ["b","a"]` covers.
  - **C3:** a PR-time obligation. The orchestrator must honour it.
- **Gates, re-run fresh by me at d78613d1** (`nice -n 19`; `free -g` showed 36 GB available):
  - The 3 HEL-1394 Jest suites (`--maxWorkers=3`): 3 suites and 26 tests passed, exit 0.
  - `npm run typecheck`: exit 0.
  - ESLint (`--max-warnings=0`) on the changed files: exit 0.
  - Prettier check on the changed files: "All matched files use Prettier code style!", exit 0.
  - I relied on the evaluator's pasted full-suite run in evaluation-2.md (497 suites, 5183 tests passed, exit 0).
- **UI/design judgment:**
  - The change adds no visual surface. It passes only `{key}` `ColumnDef`s to the same shared `DataGrid`. These are equivalent to what `deriveColumns` produces, so header text, formatting, tokens and theming are unchanged.
  - I viewed the evaluator's dark Inspect screenshot. The grid renders cleanly and is consistent with the existing Inspect modal.
  - I did not start the dev servers. The live order is identical to before by ruling until HEL-1443, and nothing styling-related changed, so a fresh capture would add no evidence.
  - None of my conclusions depend on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- `ticket.md` (the Owner Ruling 2 section) and `tasks.md` (C3, and task 2.5 ticked) are **uncommitted** in the worktree, and `evaluation-1.md`/`evaluation-2.md` are untracked. The committed HEAD that I reviewed does not yet carry Owner Ruling 2. Commit these before squash or PR, so the record that justifies the deferred AC1 ships with the change.
- C3: the PR body must state plainly that the change is invisible until HEL-1443 lands.
- `utils/chartClickSelection.ts` now imports a type from `features/panels/ui/inspectColumnOrder`. This is a utils-to-feature-UI dependency. It is type-only, so harmless, but `features/panels/types/` would be the cleaner home (the evaluator flagged this too).
