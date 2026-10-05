## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 6838276e4b74551293e565f3d603487e4047780c
Diff base (resolved live with resolve-review-base.sh, main/origin): eda4669e4b089d46bb4d9162f1a3d1ccf0ae3eaa
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/previewed-suffix-converges/hel-1154`

### What I verified (with evidence)

- **Scope (AC4 / C1 / C2).** `git diff --stat BASE...HEAD` touches only three files under
  `frontend/src/features/patchSets/ui/` plus the change's openspec directory. There are no backend, migration,
  helio-mcp or e2e changes and no data-touching code. I did not touch the dev DB and created no fixtures.
- **Premise.** I grepped `frontend/src`, `backend/src`, `helio-mcp/src` and `e2e` for `previewed)`. Outside the
  new and updated tests, the only writer is `` `${title} (previewed)` `` in `synthesizeDemoPatchSet`
  (PatchSetReviewPage.tsx:248), which is fed by `baseTitle(firstPanel.title)` at line 240. This matches the
  restated ticket.
- **AC1 (strip all trailing markers, converge to one).** `PREVIEWED_SUFFIX_RE = /(?: \(previewed\))+$/`
  (PatchSetReviewPage.tsx:218). It is anchored at the end, so a marker in the middle of a title is kept, and a
  test asserts this. The repeated group is a fixed literal, so there is no catastrophic-backtracking risk.
- **AC2 (red, green, mutation red), reproduced by me.** I used a throwaway detached worktree at 6838276e under
  the session scratchpad, with node_modules symlinked, and ran
  `nice -n 19 npx jest --maxWorkers=2 src/features/patchSets/ui/PatchSetReviewPage`:
  - GREEN at HEAD: `Tests: 25 passed, 25 total`
  - RED (production file restored to eda4669e, new tests kept): `7 failed, 18 passed`. The page-level
    demo-fixture probe fails for n=3 and n=5, so the real `synthesizeDemoPatchSet` → `previewPatchSet` payload
    path is exercised, not only the pure function. The baseTitle tests also fail for "whole trailing run" and
    n=2..5.
  - MUTATION (regex reverted exactly to `/ \(previewed\)$/`): `7 failed, 18 passed`, the same 7 tests
  - GREEN again after restoring: `25 passed`
  I removed the scratch worktree by exact path (`git worktree remove --force`; `git worktree list` shows 0 hits).
  The reviewed worktree was never modified.
- **AC3.** The old test "strips a stacked suffix down to just the last occurrence" was replaced by
  `baseTitle("Revenue (previewed) (previewed)") → "Revenue"`, an N=0..5 convergence loop, and a mid-title case
  (PatchSetReviewPage.test.tsx:466-491).
- **Gates I ran myself in WORKTREE_PATH (nice -n 19, 2 workers).**
  - `npm run typecheck`: exit 0
  - eslint `--max-warnings=0` on the changed files: exit 0
  - prettier `--check` on the changed .tsx files: clean. The openspec .md files are excluded by the root
    `.prettierignore` (`openspec`), so the warnings I saw when running from `frontend/` do not apply.
  - `check-openspec-hygiene`: clean
  - Full frontend Jest: `Test Suites: 421 passed, 421 total / Tests: 4380 passed, 4380 total`. The
    PanelCard.test.tsx:625 flake did not trigger.
- **Debugging law.** The root cause is recorded in ticket.md: the F-002 regex stripped one marker, not a run. A
  regression test exists, and it is shown to fail on the unfixed code and under the mutation.
- **UI judgment.** No markup, styles, tokens or component structure changed. The only rendered effect is the
  title string inside a DEV-only demo patch set, and the page-level Jest probe covers that. There is no visual
  surface to judge, so I started no servers or browser. This is a deliberate skip, not an omission.

### Verdict: CONFIRM

### Non-blocking notes

- PatchSetReviewPage.tsx:211-217: the comment says this "mirrors" `PanelMutationRepository`'s
  baseTitle/copyTitleRegex. The backend regex strips a single " (copy N)" suffix, so the analogy is looser than
  the wording claims. The evaluator noted this too. Cosmetic only.
- The 5x dev-DB row (panel 93f894fc-…) is left as evidence, as ruled. A fresh demo Accept on it would now
  rewrite it to one marker.
