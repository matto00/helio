## Standing Constraints

## 1. Baseline capture

- [x] 1.1 Before editing, capture the pre-change raw hit list (every banned-form, non-root-qualified, non-comment line, pre-exemption) and violation list for the 3 Scala target files and `helio-mcp/src` using the current scripts' regexes; save under the session scratchpad (not the repo). Verify: 6 Scala raw hits (NodeSnapshotRepository 130/178/202, BinaryRefRepository 49/108/128), 1 TS raw hit (context.ts:222), 0 violations.

## 2. Scala guard

- [x] 2.1 In `scripts/check-node-root-encoding.mjs`, replace `KNOWN_UNFIXED_LINES`/`KNOWN_ROOT_QUALIFIED_LINES` with content-keyed entries `{file, scope, arm, text, count, reason}` per design.md D1, preserving the existing proof comments (drop only the line-number remap notes, replacing them with one note on why keying changed). Verify: `npm run check:node-root-encoding` prints clean on the unmodified tree.
- [x] 2.2 Implement scope + arm tracking (D3), grouping by `(file, scope, arm, normalisedText)`, surplus → violations, shortfall → stale failure returned in the same array (D2, D4); missing target file with entries → stale (D4); `scanTextForViolations(relPath, text, exemptions?)`. Update the header COVERAGE comment to describe content keying and the anti-resemblance rule. Verify via 3.x.

## 3. Scala selftest

- [x] 3.1 Rewrite `scripts/check-node-root-encoding.selftest.mjs` per design.md D5: keep synthetic regex cases; add real-file baseline, (a) line-shift green, (b) new unexempted hit red, (b') same-scope duplicate red, (b'') other-scope duplicate red, (c) removed exemption red, stale entry red, whitespace re-alignment green, arm-widening red at selectQuery and overwriteRowsAction, missing-file stale, leading-`/* */`-comment hit red — covering both NodeSnapshotRepository and BinaryRefRepository. Verify: `npm run check:node-root-encoding:selftest` passes, and each red case asserts violation content (file + text), not just count.
- [x] 3.2 Mutation-prove the selftest with EVERY row of design.md D5's mutation table (line-keying, count bound off, scope dropped, stale check off, arm dropped): apply each scanner mutation, run the selftest, confirm the named cases FAIL, restore with exact-path `git checkout -- scripts/check-node-root-encoding.mjs`. Record each red output in the executor's handoff.

## 4. TypeScript sibling

- [x] 4.1 Apply the same keying to `scripts/check-node-root-encoding.ts.mjs`'s `KNOWN_ROOT_QUALIFIED_LINES` (scope = enclosing `function` name, `buildOutputSummariesByPipeline`). After the scan, evaluate every table entry whose `file` was not scanned via `scanTextForViolations(file, "")` so it reports stale (design.md D4). Verify: `npm run check:node-root-encoding:ts` clean.
- [x] 4.2 Update `scripts/check-node-root-encoding.ts.selftest.mjs` case (d) and add line-shift green / duplicate red / removed-exemption red / stale red / missing-file stale / leading-`/* */`-comment hit red cases. Verify: `npm run check:node-root-encoding:ts:selftest` passes; mutation-prove it with the line-keying, count-bound and stale-check-off mutations (restore by exact-path checkout).

## 5. Parity and gates

- [x] 5.1 Re-run the 1.1 capture with the new scripts on the same tree; diff against the baseline — raw hits and violations identical. Remove scratch files by exact path.
- [x] 5.2 Real-tree mutations (applied to a scratch copy or reverted by exact `git checkout -- <file>`): insert lines at top of NodeSnapshotRepository.scala → `npm run check:node-root-encoding` exits 0; add a new standalone hit → exits 1 naming it. Confirm `git status` clean after. Re-run both selftests after `npm run format:check`/any prettier write to confirm exemption-table text literals were not rewrapped into a mismatch.
- [x] 5.3 Run `npm run lint` and `npm run format:check` (both cover `scripts/*.mjs`), and confirm no Scala/TS source under `backend/` or `helio-mcp/` changed (`git diff --stat` shows only the four scripts + openspec change).
