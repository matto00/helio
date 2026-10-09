## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: b8dfdce3fcf5e068d80cda9fa95420da0f313e36 (PR #869, draft).
- Diff base, resolved live: b0ff8570999d3550607df0ec64f4fb6956d50f39.
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/ci-sbt-diag-tidyups/HEL-1362`.
- This cycle's delta (85f50fdb..b8dfdce3, two commits) touches:
  - the ci.yml comment;
  - the archived correction note;
  - files-modified.md;
  - the guard selftest;
  - two comment-only shell lines.

### Phase 1: Spec Review — PASS

Both cycle-1 change requests are closed. All six ticket items are now addressed. The cycle-1 findings on items 1 and
3-6 are unchanged, because this cycle's delta does not touch that code. The constraints still hold:

- **C1:** the cumulative ci.yml diff against base is still comment-only (3 `+` and 2 `-` lines, all `#`). No cache
  key, path or restore/save step changed, and no `timeout-minutes` changed.
- **C2:** proven on the PR's own CI runs.
- **C3:** no pattern matching was introduced.
- **C4:** no bypass.

### Phase 2: Code Review — PASS

**CR1 (timing): closed.** I re-measured with `gh api .../jobs/<id>`, using backend (0) from job start to the start of
"Compile and test":

| Run | Pre-step time |
| --- | --- |
| 37870529638 | 83 s |
| 37871617663 | 90 s |
| 37872469892 | 73 s |
| 37874061808 | 77 s (02:20:00Z -> 02:21:17Z) |
| 37874966856, HEAD (not cited in the comment) | 76 s (02:31:20Z -> 02:32:36Z) |

- The HEAD run is within the cited worst case.
- The selftest step took 41-46 s across these runs, and its `real` times were 40.8-45.4 s. The "41-46 s" range is
  accurate.
- The arithmetic in `ci.yml:241-242` is correct: 780 + 90 = 870 < 900, about 30 s to spare.
- The correction note in `ci-evidence.md` cites all four run ids with the right figures.
- The note now labels the 55 s main figure as predating the longer selftest, which took 25 s on that run (I confirmed
  this in cycle 1). The original measurement is left intact.

**CR2 (YAML exclusion can now fail): closed.** I repeated my cycle-1 mutation in a scratch copy, deleting
`!YAML_BLOCK_HEADER.test(line) &&` from `check-ci-sbt-no-pattern-kill.mjs:34`. The guard selftest now goes red (exit 1)
with these two failures:

- `FAIL YAML \`run: |\` header is its own logical line (not joined to the body)`
- `FAIL flagged YAML body line reports the body's line number`

With the guard unmutated, the selftest exits 0.

**Gates, re-run on HEAD:**

- `npm run lint`: clean.
- `npm run format:check`: clean.
- `npm run check:ci-sbt-guard`: `ok (4 files scanned)`.
- The guard selftest: 0 FAIL.
- `node scripts/ci-sbt.selftest.mjs`, run locally (JDK 21, `nice -n 19`): `all ci-sbt checks passed`.
- `bash -n` on the three shell scripts: ok.
- `openspec validate --strict`: valid.

**CI:**

- Runs 37874061808 (83d484f0) and 37874966856 (b8dfdce3 = HEAD) are both `completed success` on attempt 1. Every job is
  green, including ci-complete.
- HEAD backend (0), job 113641332986: the selftest passes all cases, including
  `(h) measured 5.42s, budget 6s` and `skipped` logged. It ends with `all ci-sbt checks passed`.
- HEAD frontend, job 113641332594: the guard is ok, and both new YAML `logicalLines` cases show `ok`.

**Other cycle-2 edits are comment-only:**

- The `ci-sbt-diag.sh` header note about `SECONDS` truncation (budget + <1 s). This is accurate.
- The re-wrapped comment in `e2e-backend.sh:14-15`.

Issues: none.

### Phase 3: UI Review — N/A

There is no UI-affecting change.

### Overall: PASS

### Non-blocking Suggestions

- `scripts/ci-sbt.selftest.mjs` is 282 lines, over the ~250-line soft budget. This is carried over from cycle 1.
