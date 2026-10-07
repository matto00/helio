## Standing Constraints

- [C1] The regex-escape helper lives inline at / immediately before the URL assertion; the spec diff touches only that assertion site.
- [C2] The probe ignores title-less context-options events when choosing the one distinct title, and says so in a comment.

## 1. Tests

### Tests

- [x] 1.1 Replace the `.endsWith`/`toBe(true)` assertion in `e2e/hel1260-orphan-owner-repair.spec.ts` with an
  end-anchored, id-escaped `toMatch`; verify `git diff` touches only that assertion and `npm run check:e2e-types` passes
- [x] 1.2 Demonstrate the red: temporarily mutate the expected path, run the orphan test once, capture the failure
  output showing the actual URL; revert and record the transcript in verification.md
- [x] 1.3 Run the full hel1260 spec (4 tests, `--workers` ≤ 3, `nice -n 19`, `--trace on`) green on lane-private ports;
  keep the output dir for 1.4
- [x] 1.4 Inspect one produced trace.zip to confirm the field carrying the test title; record it in verification.md
- [x] 1.5 Rework `probe-check-isolation.py` per design Decision 2 (exactly one distinct context-options title; file
  segment check; last ` › ` segment prefix-match; else problem) and add the archival header; run it on 1.3's output dir
  and verify it classifies all 4 traces correctly with 0 bad
- [x] 1.6 Verify synthetic trace copies with (a) no title and (b) two conflicting titles are each reported as a problem
- [x] 1.7 Run `npm run check:openspec` and the pre-commit chain; commit
