## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD `0246006654d51c03b41cf59391fee9b43fd14c99` (PR #1231). The diff base is the live review base `590474dcd1122e6625d3ddc7bc387599b028b3a3` from `resolve-review-base.sh main origin`, which exited 0. That is the same base as round 3, and `git merge-base 1395d572f origin/main` gives the same SHA, so the review base has not moved since the last CONFIRM.

Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/anchored-regex-cost-refinement/HEL-1807`.

This change has no UI, so the visual design step does not apply. I did not run Playwright, because the evaluator is running the e2e spec in parallel.

### What I verified (with evidence)

- **Branch shape.** `git log 590474dcd..HEAD` shows two commits: `f09c371f5` (the squash) and `024600665` (the archive).
- **The squash and archive add no content beyond what was announced.** I ran `git diff -M --name-status 1395d572f HEAD`, which compares the last CONFIRMed head with the current one:
  - **Moved byte-identical (`R100`):** every change-dir file.
  - **Deleted (`D`):** `files-modified.md`.
  - **Added (`A`):** `skeptic-final-3.md`, the round-3 report, now tracked.
  - **Modified (`M`):** `frontend/src/features/pipelines/evaluator/regexInputCost.test.ts`. This is the single comment line, changed from the pre-archive calibration path to the archive path.
  - **Modified (`M`):** `openspec/specs/pipeline-client-evaluator/spec.md`, the spec sync.
  - **Nothing else changed:** no other file under `frontend/`, `e2e/` or `shared-test-fixtures/`.
- **The spec sync is correct.**
  - The synced requirement block "Accepted regex patterns are declined on input too long for the main thread", extracted from `openspec/specs/pipeline-client-evaluator/spec.md`, is byte-identical (`diff` reports IDENTICAL) to the archived delta's `## MODIFIED Requirements` block.
  - The requirement count is 8 before and 8 after, so there are no duplicate or dropped requirements.
  - `## Purpose` holds a real sentence, not a placeholder. `grep TBD|TODO` finds nothing.
- **No dangling citation paths remain.**
  - `git grep "openspec/changes/anchored-regex-cost-refinement"` over `frontend`, `e2e` and `openspec/specs` returns no hits (rc=1).
  - All three in-code citations (`javaRegexCost.ts`, `regexInputCost.ts`, `regexInputCost.test.ts`) point at `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibration.md`. That file exists, and its date matches the archive directory, which settles round 3's last note.
- **The code has not changed since round 3's CONFIRM.**
  - I re-read the full `javaRegexCost.ts` and `regexInputCost.ts` diff against the base. It covers `startAnchored`, `anchoredCellWork` (min with the per-position charge), the anchored and unanchored branches of `boundAt`, and `testedBound` with the two-stage `workExceedsBudget`.
  - For an unanchored pattern, `boundAt` reduces to the HEL-1697 formula, so AC3's unanchored path is unchanged.
  - Rounds 1-3 rest on calibration and probe evidence, including round 3's reproduction of the worst Group H frame: 36-37 ms warm and 42.7 ms cold, under the 50 ms C2 ceiling. That evidence still applies, because the shipped source is byte-identical apart from the one comment.
- **Acceptance criteria:**
  - AC1: the calibration tables are committed in `calibration.md`, Groups A-H, plus `calibrate-anchored.mjs`.
  - AC2: `red-run.txt` is committed, and the anchored test is in `regexInputCost.test.ts` ("evaluates ^(.*)$ over 1,000 rows of 500-character cells on the client").
  - AC3: the unanchored path is unchanged, and HEL-1697's adversarial tests pass in the jest run below.
- **Parity corpus:** `git diff 590474dcd...HEAD -- shared-test-fixtures | wc -l` gives 0.
- **Fresh gates at HEAD `024600665`:**
  - Jest, evaluator folder (`--maxWorkers=3`, nice 19): 12 suites, 925 tests passed, exit 0.
  - `npm run typecheck`: exit 0.
  - `npm run lint` (`--max-warnings=0`): exit 0.
  - `prettier --check` on every changed frontend, e2e and spec file: "All matched files use Prettier code style!", exit 0.
  - Output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1807/sk4-{jest,tc,lint,fmt}.txt`.
- **Working tree.** The only untracked file is the expected `auditor-report.md`, and I committed nothing. HEAD was still `0246006654d51c03b41cf59391fee9b43fd14c99` after the gates.

### Verdict: CONFIRM

### Non-blocking notes

- Round 3's PR-body note still applies. Give the headroom together with its timing method: about 1.4x warm best-of-7, and about 1.17x for a single cold run (42.7 ms worst).
- The squash folded the red-first commit order into one commit. The C12 red-first evidence now rests on the committed `red-run.txt` and on the pre-squash history that rounds 1-3 recorded (`d3fb4618f` before `bd1c9412c`).
