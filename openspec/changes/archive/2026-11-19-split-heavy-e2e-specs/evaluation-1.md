## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `1cc57b1a1881357d15298c0b2ad0b60735be45d5` against base `3bf3590ec2cb2bf4b1478159a8cae832274becf6` (resolved live with `resolve-review-base.sh`). Section 5 (PR measurement) belongs to the orchestrator at Delivery and is not assessed here.

### Phase 1: Spec Review — FAIL

Verified independently:
- **AC1 (variance cause named before splitting):** `variance.md` names a cause for each of the three specs: a leg-wide uniform slowdown, with the whole test set moving together and other files on the same leg moving by the same factor. It names hel1608 as a stale row, and gives a slowest-leg driver table per run. I spot-checked hel1608: the main sums 96/84/79/103/86 have a median of 86, which matches the regenerated row.
- **Split without loss:** I re-derived both test lists myself. Base came from a throwaway detached worktree at 3bf3590ec (since removed); head came from the lane worktree. Both used `npx playwright test --list --reporter=json --project=dev`:
  - 932 tests on each side, 932 distinct `project | describe chain > title` keys, 0 multiset differences, `{"dev":932}` on both sides.
  - Per stem, the key sets are equal, and the part counts (25/21/21/23, 10/9/13, 15/15) match variance.md.
- **Body equality:** my own TypeScript-AST extraction of every `test()` call (title source, params and body, whitespace-normalised) gives 0 calls only in base and 0 only in new for all three specs. `expect` counts in the distinct bodies are 43=43, 72=72 and 64=64, the same as the executor's `proof.out.txt`.
- **Helpers moved verbatim:** every top-level helper statement matches except three, and all three are Prettier reflows caused by the added `export` (`setup`, `pickOption`, `AUTH`).
- **File-level config:** `test.describe.configure`, `test.setTimeout` and `test.use` are repeated exactly in each part.
- **Concurrency of the hel1733 parts:** the parts can now run at the same time, but they share no user labels. The duplicated label `desktop-<action0>` was already in base, and both of its uses sit in one serial part.
- **AC2 (table regenerated):** re-running `weights --list <my head list>` over the five scratch run directories reproduces `e2e/shard-weights.tsv` **byte for byte**. All five source runs are confirmed through the GitHub API as `main` / `push` / `success` / attempt 1 CI runs. hel1608 went from 8 to 86, the split parts are present, the old files are absent, and hel1786 is the only defaulted spec (it is listed).
- **Spec delta:** `attributeFile` follows the rule order in the delta (reported holder, then single holder, then ambiguity throws, then reported file still discovered, else drop). Without `--list` the old code path is unchanged.
- **Scope:** the diff touches only `e2e/**`, `scripts/e2e-shard*.mjs` and the change directory. There are no workflow, CD or release edits and no HEL-1781/HEL-1784 spec edits. All constraints C1 to C17 are honoured.

Issues:
1. **Task 2.3 is ticked but not done, and `files-modified.md` claims a change that is not in the commit.**
   - `frontend/src/features/home/ui/HomePage.css.test.ts:10` still reads ``the rendered-geometry proof is `e2e/hel1665-home-phone-stability.spec.ts` ``, which names a file the commit deletes.
   - The file is absent from `git diff --name-only 3bf3590ec...HEAD`, but `files-modified.md` line 20 says "comment names the new hel1665 spec parts".
   - A grep of every tracked file outside `openspec/changes/archive/` and this change finds no other stale reference. The only other hits are the part files' own "split from" provenance comments, which are correct.

### Phase 2: Code Review — PASS (gates); the one defect is in Phase 1

I ran these myself in `WORKTREE_PATH`. No changed file matches `frontend/**` or `backend/**`, so the listed npm and sbt gates do not strictly trigger; I ran the gates that cover the changed files instead:
- `node scripts/e2e-shard.selftest.mjs`: 28 cases passed, exit 0.
- `npm run check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths`: all clean (180 files).
- `check:e2e-prod-build-projects`: clean. `check:openspec`: clean.
- `eslint --max-warnings=0` on the changed `.ts`/`.mjs` files: exit 0. `prettier --check` on the changed files: clean.

Red-first and mutation evidence:
- `red-selftest.txt` shows the new cases failing against the unchanged tool, with real failures: `ENOENT scandir '--list'` and a deepEqual failure in `parseWeightsArgs`.
- `mutations.txt` records M1 to M9 and M8b, each with failing cases. M8's 0-fail entries were a broken mutation that the executor redid as M8b, which is red.
- I reproduced M2 myself in a scratchpad copy (removing the single-holder rule). The selftest goes red, exit 1, on "a test moved by a split".
- The gate-chain isolation transcript exists at `.concertino/gate-chain-isolation-evidence/scripts__e2e-shard.selftest.mjs.md`.

Code quality: the tool change is small, typed through JSDoc, and keeps the old no-`--list` path. An ambiguous move fails loudly, and every re-attribution and drop is printed on stderr. There is no dead code and no premature abstraction.

### Phase 3: UI Review — N/A

No UI-trigger paths changed: nothing under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: FAIL

### Change Requests
1. In `frontend/src/features/home/ui/HomePage.css.test.ts:10`, replace `` `e2e/hel1665-home-phone-stability.spec.ts` `` with a reference to the split parts, for example `` the `e2e/hel1665-home-phone-stability-*.spec.ts` parts ``. Re-wrap the comment so `prettier --check` passes. Then make `files-modified.md` match the actual commit, which is true once this change is in it.

### Non-blocking Suggestions
- The hel1665 parts write single-element loops (`for (const order of ["dashboards-first"] as Order[])`) to keep the test bodies byte-identical. That is fine for the proof. A one-line comment on why the loop is kept would stop a later reader from "simplifying" it.
- Environment note, not a code finding: while I was reviewing (about 09:50), `git status` in the lane worktree briefly showed every `helio-mcp/` file as deleted, then went clean again with HEAD unchanged. Directory mtimes under `docs/`, `notes/`, `openspec/` and `helio-mcp/` are 09:49-09:50, so another process was acting on this worktree at the same time. The orchestrator may want to confirm which agent that was.
