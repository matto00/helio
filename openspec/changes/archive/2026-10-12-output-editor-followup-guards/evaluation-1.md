## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 084a97eb5f5edc534f9507c5ff24cc7c5732a751. Base (live-resolved): b71af7072ef6e7e7603c097c3e18276d4f18b318.
All evaluator transcripts are in `.concertino/runs/HEL-1510/evidence/eval-1-*` and `evidence/eval-probe/` (main checkout run dir).

### Phase 1: Spec Review — PASS
- AC1: `ChartDisplayFields.tsx` no longer prepends a second clear option; the scatter selects use the caller's
  `fieldOptions` (which already lead with "— None —" via `aggColumnOptions()`). The only production caller is
  `OutputKindFields.tsx:176` (grep-confirmed), so no other path loses its clear option. New
  `OutputEditorSheet.scatterPickers.test.tsx` opens both pickers through the real editor. Reproduced red myself by
  restoring the base `ChartDisplayFields.tsx` (2 failed: `["— None —","— None —"]`), then restored; green at HEAD.
  Running app (1100px): both pickers list `["— None —", id, <86-char>, amount, status]`.
- AC2: `RestApiForm.test.tsx` mock has `reset: jest.fn()` and no cast; return type annotation checks it. Reproduced red:
  deleting the `reset` line makes `npm run typecheck` fail with TS2741 "Property 'reset' is missing"; restored, green.
- AC3: `e2e/hel1510-output-editor-table-overflow.spec.ts` meets every listed assertion (86-char name asserted, 1100px,
  rect-based control right edges vs card content box, modal body scrollWidth <= clientWidth, name width > 0 + title).
  CSS-source guard deleted. `scripts/e2e-shard.mjs` gives unlisted discovered specs the median weight, so it is scheduled.
- Tasks all checked and match the diff; planning artifacts/spec delta match the implementation.
- CONSTRAINTS C1-C5 honored: C1 red transcripts exist and I reproduced each; C2 no `eslint-disable` added (diff grep: 0),
  no hook bypass; C3 spec registers a throwaway `@example.test` user, cleaned by the registry teardown; C4 reproduced
  (below); C5 I ran the spec myself (below).

### Phase 2: Code Review — PASS
Gates (fresh, in WORKTREE_PATH): `npm run lint` 0, `npm run format:check` 0, `npm test` (root 48 suites/454 tests +
frontend 569 suites/6218 tests, all pass), `npm --prefix frontend run build` 0, `npm run typecheck` 0,
`check:e2e-types` 0, `check:e2e-user-cleanup` clean, `check:e2e-evidence-paths` clean. Targeted jest
(scatterPickers, ChartDisplayFields, RestApiForm): 3 suites / 18 tests pass.

E2E spec, run myself headless against my own servers (6942/9849, worktree cwd confirmed):
- HEAD: 1 passed (`eval-1-e2e-green-head.txt`).
- C4: `git show d6aef6c46 -- .../TableDisplayFields.css | git apply -R` -> FAIL on the overflow assertion, 10 controls
  past the card (e.g. `ui-select__trigger right=1083.8 limit=872.2`, move buttons right=1067.0)
  (`eval-1-e2e-RED-css-reverted.txt`, diff in `eval-1-css-revert.diff`); `git checkout --` the file -> 1 passed
  (`eval-1-e2e-GREEN-css-restored.txt`). `git status` clean afterward.

No mechanical CONTRIBUTING/DESIGN violations found. No CSS/token changes in this diff. The `as unknown as Step[]` in the
new jest test mirrors the existing `OutputEditorSheet.labels.test.tsx:61` fixture and is not covered by AC2.

### Phase 3: UI Review — PASS
Headless probe as throwaway users (all `@example.test`, ids checked via `/api/auth/me`, e.g.
cc0d92eb-37f3-4904-ad43-9021b276a9c7 and 68115e54-6f72-45ce-bb08-0153042621ad; deleted by registry teardown):
- Table Output editor with the 86-char column, measuring the max control right edge vs the card content right edge
  and the modal body scroll: 1440 light 1041.8/1041.8, sw=cw 718; 1100 light 872/872; 1100 dark 871.7/871.7; 768
  705.3/705.3; 375 318.0 vs 317.9 (inside the 0.5 tolerance), sw=cw 335; document never scrolls sideways. Screenshots
  are in `evidence/eval-probe/table-*.png`.
- Scatter pickers: opened from the keyboard (focus, Enter), "— None —" listed once, ArrowDown+Enter selects. No
  duplicate-key console error. Other console output during the flow: a 404 on `GET /api/pipelines/:id/schedule` (no
  schedule set) and ECharts zero-size warnings. Both are unrelated to this diff.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `OutputEditorSheet.scatterPickers.test.tsx`: in the base-red run the count assertion fails before the duplicate-key
  `console.error` filter runs, so that filter is never shown red by itself. Consider asserting it first, or recording a
  run where it fails alone.
- The scatterPickers test copies the httpClient/dialog mock setup from `OutputEditorSheet.labels.test.tsx`. A shared
  harness helper would cut that duplication. This predates the change.
- Observation (could not attribute): in my first, longer probe run, after five reload/theme cycles the pipeline page
  once showed "Outputs (0)" while the API listed 2 outputs, and the probe timed out. Reruns did not reproduce it. The new
  spec does a single navigation and passed in all 3 of my runs. This may be worth a look if the spec flakes in CI.
- Planner Note follow-up still stands: on the Output editor path, `isBound` is always true.
