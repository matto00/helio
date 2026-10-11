## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `16b526f41818cde26474763aac981cf7c9eb8f9f`. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=feature/duration-format-type/HEL-1308`. `resolve-review-base.sh` returned `5986340c5fbe17cc6ea64618d53fcce2b9fad6ae`, the merge-base. After `git fetch`, origin/main is `5a53d24b9`, which is two commits ahead of it.

### What I verified (with evidence)

**1. The previous REFUTE item (P6 in the PR body) is resolved, not just reworded.**
- `gh pr view 940 --json body` was read live. P6 now says: "the suffix is now **hidden** whenever the format is `duration` or `durationMs`, on the metric value, collection items, the editor preview and the history baseline text ... The stored `unit` config is left untouched."
- P1-P5 and P7 are each marked "(approved)".
- The ruling id `approve-hide-duration-unit-suffix` is cited.
- `diff` against `evidence/pr-body.md` shows only a trailing-newline difference.

**2. Every product call in the PR body matches what ships.**
- P6 matches the code:
  - `MetricRenderer.tsx:170`: `data?.unit && !isDurationFormat(format)`
  - `MetricRenderer.tsx:74`: `metricBaselineText` drops `shownUnit` for duration
- I enumerated the `.unit` sinks myself in non-test `frontend/src`. There are only `MetricOutputPanel.tsx:111,117`, `CollectionRenderer.tsx:40` (which renders through MetricRenderer) and the editor `configPatch.ts`/`outputConfigTypes.ts`. There is no other display sink.
- P7 matches: the diff adds no value validator, and schema descriptions document the values.
- P1-P5 match the formatter and tests verified in skeptic-final-2 on this same code.

**3. No session link or trailer.**
- `gh pr view 940 --json body | grep -iE 'claude\.ai|session'` found no match (exit 1).
- `git log --format=%B 5986340c5..HEAD | grep -iE 'claude\.ai|Claude-Session'` found no match (exit 1).

**4. Tests at this head (run fresh, nice 19, 2 workers, MemAvailable 52 GB).**
- `npx jest --testPathPatterns='formatDuration|duration'` matched the whole worktree path, so it ran the full frontend suite: 531 suites passed, 5723 tests passed, 19 snapshots passed.

**5. Mergeability against current main: FAILS (stable, reproduced).**
- `gh pr view 940` reports `mergeable: CONFLICTING` and `mergeStateStatus: DIRTY`. CI on the old head is 17 SUCCESS and 1 SKIPPED.
- Origin/main gained two commits after the branch's last merge (b92f447c1, from 5986340c5):
  - `02dc11abd` HEL-1306 Chart reference lines and bands (2026-10-11T11:54:57-07:00)
  - `5a53d24b9` HEL-1483 (12:10:17)
- I reproduced the conflict locally with `git merge-tree --write-tree --name-only HEAD origin/main` (exit 1). This is read-only and does not touch the worktree:
  - `CONFLICT (content): backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala`. Both sides edited the last line of `KeysDoc`. HEAD appends `OutputFormatVocabulary.Doc`; main inserts `${ChartReferenceMarks.Doc}`.
  - `CONFLICT (content): helio-mcp/src/tools/outputs.ts`. Both sides edited the end of the keys-doc string. HEAD appends `FORMAT_VOCABULARY_DOC`; main adds the `referenceLines`/`referenceBands` paragraph.
  - Five more files auto-merged: `OutputKindFields.tsx`, `outputConfigTypes.ts` and the three Output request schemas. I inspected the schema auto-merge (`git diff origin/main <tree> -- schemas/outputs/create-output-request.schema.json`) and it looks clean.
- The PR body's own "Risks" section predicted this exact collision with HEL-1306.
- This is a fact about main, not about the work's correctness. But HEAD `16b526f41` cannot ship as it stands. Any merge needs a new resolved head, and the two conflicts are in exactly the doc strings this change's seam tests pin with exact equality: `DurationFormatSeamSpec` (KeysDoc and schema descriptions), `OutputConfigValidationSpec`, and helio-mcp `durationFormatSeam.test.ts`. Those must be re-run on the resolved tree.

**6. The earlier merge of 5986340c5 (b92f447c1).**
- It was verified on this same code in skeptic-final-2: the HEL-1441 normaliser leaves `duration`/`durationMs` strings and `unit` unchanged, and that guard passes.
- The full frontend suite still passes at this head (item 4).

**7. Red/guard evidence, ACs, and DESIGN.md on the running app.**
- I did not repeat these. The code is byte-identical to the head skeptic-final-2 and evaluation-3 verified live (head `16b526f41` in both, and `git log` shows no commit since).
- I deliberately did not do a live spot-check this round. The verdict below requires a new head, and a running-app pass on `16b526f41` would certify a commit that cannot be merged. The live pass must be done on the resolved head, as listed in the change requests.

### Verdict: REFUTE

Category: mechanical. The product calls, the owner ruling and the PR body are now correct. The head under review conflicts with current origin/main, so it does not ship.

### Change Requests

1. **Merge current origin/main (`5a53d24b9` or later) into the branch and resolve the two conflicts by keeping both sides.**
   - In `OutputConfigValidation.scala` KeysDoc, keep main's `${ChartReferenceMarks.Doc}` sentence, then `" Chart styling ... appearance.chart. " + OutputFormatVocabulary.Doc`.
   - In `helio-mcp/src/tools/outputs.ts`, keep main's `referenceLines`/`referenceBands` paragraph, then `"A key already stored on an Output may be re-sent unchanged. " + FORMAT_VOCABULARY_DOC`.
   - Keep the spacing exact: the seam fixture asserts the doc text with exact equality.
2. **On the resolved head, re-run and paste the results of:**
   - `DurationFormatSeamSpec`, `OutputConfigValidationSpec` and HEL-1306's own KeysDoc/reference-mark specs (`sbt testFull`, or at least those specs)
   - helio-mcp jest, including `durationFormatSeam.test.ts` and HEL-1306's outputs-doc tests
   - frontend lint, typecheck and jest
3. **Update the PR body's gate counts** (jest 5713 -> the current numbers, helio-mcp, sbt) and its "Branch is merged with origin/main ..." line to the new merge SHA. Push, and confirm `mergeStateStatus` is CLEAN with CI green on the new head.
4. **On the new head, run a running-app spot-check:**
   - a duration metric with `unit: "s"` shows no suffix
   - duration together with conditional formats
   - light and dark
   - 1440 and 375

   HEL-1306 auto-merged into `OutputKindFields.tsx`, the same editor file that carries the Duration options.

### Non-blocking notes
- The non-blocking notes from skeptic-final-2 still stand: there is no hint under Unit that it is hidden for duration, and the select labels differ ("Duration" vs "Duration (s)"). The PR body now lists them honestly.
- No mtime-ordering evidence was used. Every claim rests on command output, `git merge-tree` conflict text and line citations.
