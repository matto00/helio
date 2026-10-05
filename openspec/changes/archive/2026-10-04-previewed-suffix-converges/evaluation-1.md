## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 6838276e4b74551293e565f3d603487e4047780c
Diff base (live-resolved via resolve-review-base.sh): eda4669e4b089d46bb4d9162f1a3d1ccf0ae3eaa

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (strip ALL trailing markers, converge to one): `PREVIEWED_SUFFIX_RE` is now `/(?: \(previewed\))+$/`
  (PatchSetReviewPage.tsx:218), applied by `baseTitle` at the only call site, `synthesizeDemoPatchSet`
  (PatchSetReviewPage.tsx:240). It is anchored, so a mid-title marker is untouched. There is no ReDoS risk:
  the repeated group is a fixed literal.
- AC2 (red, then green, then mutation red): I reproduced this myself in a throwaway detached worktree at the
  reviewed SHA, never touching the delivery worktree (details under Phase 2). The page-level demo-fixture probe
  fails for n=3 and n=5 on unmodified code, as design D2 requires. It is not just a pure-function check.
- AC3 (single-strip test updated): the old "down to just the last occurrence" test is replaced by a full-strip
  assertion, an N=0..5 convergence loop, and a mid-title-unchanged case (design D3).
- AC4 / C1 (frontend only): the diff touches only `frontend/src/features/patchSets/ui/*` and the change's openspec
  directory. There is no backend, migration, helio-mcp or e2e change.
- C2 (no stored-data fix): no data-touching code. I created no dev-DB fixtures and touched no rows.
- C3 (red before fix): satisfied, and independently confirmed.
- Tasks 1.1–3.1 are all ticked and match the diff. No scope creep. `skip_specs: true` is justified for a DEV-only fixture.
- I grepped for other writers of "(previewed)" in frontend/src, backend/src and helio-mcp/src. There are none;
  every other hit is prose in comments. This matches the ticket's premise validation.

### Phase 2: Code Review — PASS
Issues: none blocking

My own gate runs (nice -n 19, maxWorkers=2, in WORKTREE_PATH):
- `npm run lint`: exit 0, zero warnings
- `npm run format:check`: all files formatted
- `npm run typecheck`: exit 0
- `npm test`: root 36 suites / 353 tests passed; frontend 421 suites / 4380 tests passed. The known
  PanelCard.test.tsx:625 flake did not trigger.
- `npm --prefix frontend run build`: exit 0

Independent red/green/mutation, run in a throwaway `git worktree add --detach` at 6838276e under the session
scratchpad, with node_modules copied (not symlinked). Command:
`npx jest --maxWorkers=2 src/features/patchSets/ui/PatchSetReviewPage`
- GREEN at HEAD: 2 suites, 25/25 passed
- MUTATION (regex reverted to `/ \(previewed\)$/`): 7 failed, 18 passed. This matches red-green-evidence.md.
- RED (production file restored to base eda4669e, new tests kept): 7 failed, 18 passed. This matches red-green-evidence.md.
- I removed the throwaway worktree afterwards (`git worktree remove --force`). `git worktree list` no longer shows it.

Checklist:
- CONTRIBUTING: no inline FQNs; imports are grouped; the new test file is 115 lines, well within budget.
- DRY: the new test file duplicates some store/fixture setup from PatchSetReviewPage.test.tsx. This is justified:
  the file-local `jest.mock("config/env", { IS_DEV: true })` has to live in its own module. It follows the
  existing precedent `ProposalReviewPage.demoFixture.test.tsx`.
- Type safety: typed `Dashboard`/`Panel` fixtures and `jest.mocked`; no `any`.
- Tests: the page-level probe asserts on the actual payload sent to `previewPatchSet`, which is the real
  regression surface. A mutation proves it can fail.
- No dead code. The stale "unreachable under Jest" comment was corrected (task 2.1).

### Phase 3: UI Review — N/A
The `frontend/**` trigger matches literally, but the orchestrator delegated this decision to me, and I judged a
browser review unnecessary. The change is one regex constant plus comments in a DEV-only fixture's title
computation. No markup, styles or rendered component structure changed. The behaviour is covered at page level
by the new Jest probe, which renders `PatchSetReviewPage` through the demo path. I started no servers, created
no fixtures, and opened no browser.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- PatchSetReviewPage.tsx:211-217: the comment says the pattern "mirrors the same baseTitle/copyTitleRegex pattern
  `PanelMutationRepository` already uses". The backend `copyTitleRegex`
  (PanelMutationRepository.scala:24) strips a single " (copy N)" suffix, not a run. The analogy is now looser
  than the wording suggests. This sentence was already in the code before this change; consider softening it to
  "in the spirit of".
