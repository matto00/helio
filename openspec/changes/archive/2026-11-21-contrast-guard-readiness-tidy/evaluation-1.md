## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD d3e34a6760e29c443f63afa02f944cd39dfeb059 against base 787a283e996288551590a9e9825bd6ff339a2b0a
(resolved live with resolve-review-base.sh). Diff: 4 e2e files (+51/-8) plus the change dir. No `frontend/**` or
`backend/**` file changed.

### Phase 1: Spec Review — PASS
- Item 1 (readiness wait at 1440): `awaitSampleRefreshReady` (state-surface-contrast-guard.ts:529-539) waits with
  web-first `toBeVisible` and `toBeEnabled`, called in the 1440 `pipeline-detail` readiness branch (:935). The narrow
  `awaitReady` uses the same helper (narrow.ts:209), so the two cannot drift (D1). D2 (:995-1008) asserts the button
  is present exactly once, was stamped, and is in `mainSampledDocIds` (the probed set, not just covered), and logs a
  `[HEL-1806 guard]` line.
- Item 2 (stale comment): the header now names both part files. `grep state-surface-contrast-guard-narrow.spec.ts e2e/`
  returns 0 hits.
- Item 3 (widths by value): `narrowWidths(...values)` (narrow.ts:60-72) throws unless each named width appears
  exactly once. Part files call `narrowWidths(1100, 768)` and `narrowWidths(390)`. `NARROW_WIDTHS` contents and order
  are unchanged.
- AC1 (red by mutation, green on main): I reproduced it myself (see Phase 2).
- AC2 (same checks before and after): I compared the committed baseline `01-baseline-all-five.txt` (tree 787a283e9)
  with my own fresh green run on HEAD. Passed-test titles, with file:line and duration stripped and sorted, are
  identical (40 = 40, `diff` empty). The 84 per-view `visible ..., sampled N` lines are identical (`diff` empty).
  `/pipelines/:id` is 19 visible and 19 sampled in both themes before and after. Neither baseline nor green contains a
  failed test. The executor's `coverage-comparison.md` matches this.
- The tasks are all checked and match the diff. There is no scope creep: no app code, CSS, exemption, cap or shard
  weight changed. The spec delta matches the behaviour. `CONSTRAINTS: []`, so no constraints were promoted.

### Phase 2: Code Review — PASS
Gates, run fresh by me on HEAD. All Playwright runs used the lane-private DB `helio_hel1806` as user `matt` with no
password; I confirmed this by connecting with `psql -w`, not by reading any .env. The backend had `ANTHROPIC_API_KEY`
set empty. Every run used 2 workers, one batch at a time.
- `npm run lint`: 0 warnings. `npm run format:check`: clean. `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- `npm test` and the frontend build: not required, because no `frontend/**` file changed. `sbt testFull`: not
  required, because no `backend/**` file changed.
- All five guard files, full runs on HEAD:
  - routes-dense + routes-light: 16 passed.
  - overlays-chrome + narrow-1100-768 + narrow-390: 24 passed.
  - Total 40/40. The `[HEL-1806 guard] ... probed at 1440px` line appears for both dark and light (doc id 22).
- I re-applied the M1 mutation myself by deleting both `@media (hover: hover)` blocks that hold the
  `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)` rules (PipelineSpine.css:441-452).
  routes-dense then ran 1 failed / 7 passed. The failure was the dark `pipeline-detail` cell:
  `[dark] /pipelines/:id :: button "" aria="Refresh sample of HEL-866 Guard Source" [ui-icon-btn] (#6) (hover) — ratio=1.0301171241280085`.
  The light cell stayed green, as expected. I reverted with `git checkout`. `git diff -- frontend` is 0 bytes and
  `git status` is clean.
- The committed M3 and M4 evidence is consistent with the design:
  - M3: with the wait removed and the sample delayed, the button was disabled at stamp time, and both cells failed on
    D2 with `"Refresh sample of HEL-866 Guard Source" was stamped`.
  - M4: M3 + M1 with D2 removed passed silently, which reproduces how HEL-1628 escaped.
- The `06-width-by-value-checks.txt` evidence shows that reordering the matrix keeps identical `--list` titles, and
  that naming width 1101 fails with `narrowWidths: width 1101px must appear exactly once in NARROW_WIDTHS, found 0`.
- Code quality: no `any`, no dead code, and no TODO. The helper is shared rather than duplicated. Assertion messages
  name the button. There are no inline FQNs and the imports are correct.

### Phase 3: UI Review — N/A
None of the triggers matched: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed.
The change is e2e only, and its behaviour was exercised directly through the guard runs above. As briefed, I did not
use the MCP browser.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `sampleRefreshName` (state-surface-contrast-guard.ts:530) is a zero-argument function over a constant. A
  `const SAMPLE_REFRESH_NAME = \`Refresh sample of ${SOURCE_NAME}\`` would read more simply.
- The new helper block sits between `SOURCE_NAME` and the HEL-1805 `CONNECTOR_NAME` comment, with no blank line
  before that comment. Leaving a blank line would keep the HEL-1805 paragraph visually attached to its constant.

Evaluator scratch logs (not committed): /home/matt/Development/helio/.concertino/scratch/HEL-1806/eval-green-a.txt,
eval-green-b.txt, eval-red-m1.txt. Servers were stopped with stop-servers.sh, and ports 7238 and 10145 are free.
