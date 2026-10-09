## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 85f50fdb129803ac4122745e0c785eb74940c587 (PR #869, draft). Diff base resolved live:
b0ff8570999d3550607df0ec64f4fb6956d50f39 (origin/main). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=task/ci-sbt-diag-tidyups/HEL-1362`.

### Phase 1: Spec Review — FAIL

The ticket's items 1, 3, 4, 5 and 6 are closed, and I checked each against the code and CI. Item 2 (the stale timing
note) is not closed: the new comment is already contradicted by this PR's own CI runs (see Phase 2, issue 1).
Item-by-item:

- Item 1, the guard. `scripts/check-ci-sbt-no-pattern-kill.mjs` now folds lines into logical lines. I proved the join
  tests are real by mutation: with joining disabled (`continues = false`), 6 checks go red. The YAML exclusion is
  NOT protected by any test (Phase 2, issue 2).
- Item 3, the message. `ci_sbt_capture` now returns 0, 2 or 1, and both callers map these to distinct messages
  (`scripts/ci-sbt.sh:67-72`, `scripts/e2e-backend.sh:39-44`).
- Item 4, the budget. `_diag_timeout` now counts the kill grace inside its cap, the post-SIGQUIT sleep is clamped,
  and a candidate is skipped when less than 3 s remain.
- Item 5, the logs. Two logs were `git rm`'d, and their byte counts match exactly (see below). The control evidence
  is kept: 136,032 B (`du -ab`).
- Item 6, the thin-client lever. It is removed. `git grep` finds no remaining consumer of `--mode`, `active.json`,
  `E2E_SBT_SERVER_FLAG`, `SERVER_FLAG` or `_diag_socket_owner` outside the selftest's own "lever is gone" case. The
  remaining "thin client" mentions are history: ci.yml:244/248 (HEL-1018/1273 notes), MISTAKES.md, and
  e2e-backend.sh:7.

Other checks:

- Tasks are all marked done.
- `openspec validate ci-sbt-diag-tidyups --strict` reports valid.
- The spec delta matches the implementation: rc 0/2/1, the 1 s total tolerance, the static guard over continued
  lines, and no thin-client mode.
- No scope creep was found.
- CONSTRAINTS:
  - C1 holds. The ci.yml diff is comment-only: 3 `+` and 2 `-` lines, all `#`. No cache key, path, restore/save step
    or `timeout-minutes` changed.
  - C2 holds: proven on the PR's CI runs.
  - C3 holds. There is no pattern matching. The selftest finds JVMs through `/proc/<p>/stat` pgrp plus the exe check,
    and signals only the recorded `-gid`.
  - C4: no bypass was disclosed or seen.

### Phase 2: Code Review — FAIL

Gates I ran myself on HEAD:

- No `frontend/**` or `backend/**` files changed, so the frontend and backend gate triggers do not fire. I still ran
  these:
  - `npm run lint`: clean.
  - `npm run format:check`: clean.
  - `npm run check:ci-sbt-guard`: `ok (4 files scanned)`.
  - The guard selftest: all ok.
  - `node scripts/ci-sbt.selftest.mjs` (locally, JDK 21, `nice -n 19`): `all ci-sbt checks passed`, with
    `(h) measured 4.62s, budget 6s`.
  - `bash -n` on the three shell scripts: ok.
- CI, checked through `gh` rather than taken from the handoff. Runs 37870529638 (a5e5a845), 37871617663 (9ed3fa45)
  and 37872469892 (85f50fdb = HEAD) are all `completed success`, attempt 1, with every job green, including
  ci-complete.
- backend (0) "Selftest sbt hang diagnostics" in all three runs (jobs 113627330552, 113630785666, 113633436798):
  - All `ok`, ending `all ci-sbt checks passed`.
  - That includes (a), the real deadline with a real jcmd `Full thread dump`, plus (e), (f), (g) and both (h) cases.
  - (h) measured 5.06 s, 5.44 s and 4.48 s against a 6 s budget.
- frontend jobs (113627330549, 113633436505): `check-ci-sbt-no-pattern-kill: ok (4 files scanned)`. All 9 new `(split)`
  cases are `ok`, as is `real tree is clean`.
- Budget test mutation (task 2.2/2.3, evaluator check 4). I copied the scripts to a scratch dir and swapped in the base
  (b0ff8570) `scripts/lib/ci-sbt-diag.sh`. The selftest went red:
  - `FAIL (h) capture finished within budget+1s (measured 10.62s, budget 6s)`
  - `FAIL (h) candidates ... skipped`
  - (f) and (g) also failed.

  The test times only the `ci_sbt_capture` call: the calling bash takes `date +%s.%N` stamps, and node
  `performance.now()` is the outer wall clock. It does not use the lib's `SECONDS`. It sets up 4 verified JVMs and a
  jcmd that hangs and ignores TERM. This matches D4 and is a genuine regression test.
- Correction note (evaluator check 6), verified with `git cat-file -s`: 2,266,058 B and 3,203,939 B at both b0ff8570
  and d71f646cb, 5,469,997 B in total. Both files exist in the d71f646cb tree. The run ids are correct. The note says
  "They are not hang evidence (no real hang occurred)". It calls nothing hang evidence. Accurate.

Issues:

1. **The timing comment is wrong on its own PR's evidence** (ticket item 2; D2 "quote the LARGER" figure).
   `.github/workflows/ci.yml:241-242` says:
   - "up to 83 s";
   - "incl. the ~30 s selftest";
   - "55 s on a main push";
   - "= 863 s ... about 37 s to spare".

   What I measured with `gh api .../jobs/<id>`, backend (0), from job start to the start of "Compile and test":
   - run 37870529638: **83 s**;
   - run 37871617663: **90 s** (01:49:25Z -> 01:50:55Z);
   - run 37872469892: **73 s**.

   The selftest step took 41 s, 46 s and 43 s (`real 0m40.757s`, `0m45.389s`, `0m42.622s`), not about 30 s. The 55 s
   main figure (run 37869010952) was measured with the PRE-change selftest, which took 25 s that run
   (01:17:26 -> 01:17:51). After this PR merges, main's selftest grows by about 17-20 s, so a main push will be
   roughly 73 s, not 55 s.

   The bound still holds: 780 + 90 = 870 < 900, about 30 s spare. But the comment's figures are already false. Fixing
   exactly this kind of stale figure is the point of ticket item 2.

   The archived correction note (`ci-evidence.md`, the HEL-1362 Correction paragraph) is literally accurate per run.
   It inherits the same understated "about 37 s to spare" and the pre-change 55 s main figure.
2. **No test protects the YAML block-header exclusion** (D1; skeptic-design-2's non-blocking note; evaluator check 1).
   The YAML pair exists in `scripts/check-ci-sbt-no-pattern-kill.selftest.mjs` (lines 39-42, 51-52), but both negatives
   pass trivially.
   - `"  - run: |\n      grep y file"` and `"key: |\n  ps x\n  grep y"` cannot match any RULE even when the header
     IS joined. `run: | grep y file` has no `ps\s`, and `key: | ps x` stops there because `ps x` does not continue.
   - The YAML positive case flags once whether or not the header is joined.
   - Mutation: I removed `!YAML_BLOCK_HEADER.test(line) &&` from `check-ci-sbt-no-pattern-kill.mjs:34`. The selftest
     still exits 0 with 23/23 ok, and the real-tree guard still passes.

   So D1's stated decision is currently unproven. Its rationale is skeptic-design-1 item 5: 20 of 30 joins in ci.yml
   were these headers.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. The spec delta lives under
`openspec/changes/`, and there is no UI surface.

### Overall: FAIL

### Change Requests

1. Re-state the timing comment from all of this PR's runs. Do it in `.github/workflows/ci.yml:241-242` (comment-only,
   C1) and in the matching sentences of the correction paragraph in
   `openspec/changes/archive/2026-10-07-ci-sbt-hang-diagnostics/ci-evidence.md`.
   - Use the measured maximum, 90 s (run 37871617663, PR shape).
   - Give the arithmetic: 780 + 90 = 870 s < 900 s, about 30 s to spare.
   - Give the selftest as about 40-45 s, not "~30 s".
   - Either drop the "55 s on a main push" figure or label it as measured before HEL-1362, with the old 25 s
     selftest. Do not present it as what main will see after merge.
   - Cite all three run ids (37870529638 = 83 s, 37871617663 = 90 s, 37872469892 = 73 s) in the correction note.
   - Update files-modified.md's "CI proof" figures to match.
2. Make the YAML block-header exclusion failable in
   `scripts/check-ci-sbt-no-pattern-kill.selftest.mjs`.
   - Add a case that asserts on `logicalLines` directly (it is already exported). For example,
     `logicalLines("  - run: |\n      ps -ef | grep x")` must give two logical lines, with the header on line 1 and
     its text unjoined. Alternatively, assert a flagged body line reports the BODY's physical line number (`x:2:`),
     not the header's (`x:1:`).
   - Show it red by deleting `!YAML_BLOCK_HEADER.test(line) &&` at `check-ci-sbt-no-pattern-kill.mjs:34`, and record
     that red in files-modified.md.

### Non-blocking Suggestions

- `scripts/ci-sbt.selftest.mjs` is now 282 lines, over CONTRIBUTING.md's ~250-line soft budget. Consider moving
  (f)-(h) into a helper module if it grows further.
- Budget precision: `_diag_remaining` uses whole-second `SECONDS`, so the ceiling is budget + under 1 s (a fixed
  sub-second offset, not cumulative). This is within the spec's 1 s total tolerance and is caught by (h). A one-line
  comment saying the tolerance comes from `SECONDS` truncation would make the "HARD ceiling" header exact.
- `scripts/e2e-backend.sh:14`: the rewritten comment line is much longer than its neighbours. Re-wrap it to match.
- design.md's Risks bullet (skeptic-design-2's note 1) was reworded. It is fine as it stands.
