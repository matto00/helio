## Standing Constraints

- [C1] Frontend only: no backend, migration, helio-mcp, or e2e-harness code change.
- [C2] No stored-data fix: never modify the dev-DB row 93f894fc-4335-4403-9e2a-c8fbcddd0f21 or its output.
- [C3] Red before fix: the probe must be run and observed failing on unmodified code, then green, then a mutation red.

### Tests (red first)

- [x] 1.1 Add sibling `PatchSetReviewPage.demoFixture.test.tsx` (file-local `config/env` mock `IS_DEV: true`, per `ProposalReviewPage.demoFixture.test.tsx`): compounded first-panel title -> previewPatchSet receives exactly one marker; record RED on unmodified code
- [x] 1.2 Update the existing single-strip `baseTitle` test to full-strip, loop N=0..5 markers -> exactly one after re-append, plus a mid-title-marker-unchanged case (design D3); fix the F-002 test comments

### Frontend

- [x] 2.1 Change `PREVIEWED_SUFFIX_RE` to strip the whole trailing run (design D1) and update its comment plus the now-false "unreachable under Jest" comment
- [x] 2.2 Re-run the probe GREEN; run a mutation (revert the regex exactly to `/ \(previewed\)$/`) and record RED; restore

### Verification

- [x] 3.1 Run frontend gates: lint, typecheck, format:check, full Jest (nice -n 19, maxWorkers=2)
