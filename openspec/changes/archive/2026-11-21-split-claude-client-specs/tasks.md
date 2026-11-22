## Standing Constraints

- [C1] Full `sbt testFull` proof runs use the exact-partition shards (`HELIO_TEST_SHARD_INDEX`/`HELIO_TEST_SHARD_COUNT`), the same COUNT before and after, never package-glob shards.
- [C2] No method that logs leaves `ClaudeClient` (`logHop`, `executeTool`, `toContentBlock`); new main files declare no logger.

## 1. Baseline (commit before moving any code)

- [x] 1.1 Enumerate the affected spec set (design D3.1) into `evidence/spec-set.txt`; run it on the lane DB in sub-600 s shards; commit per-suite counts and sorted full test names per suite (`.txt`).
- [x] 1.2 Run full `sbt testFull` in exact-partition shards (C1), each under 600 s, on the lane DB; commit each shard's totals and the sum (`evidence/baseline-testfull.txt`).

## 2. Main split (no test file touched)

- [x] 2.1 Create `ClaudeRequestBuilder.scala` and `ClaudeBlockCodec.scala` per design D1, moving methods verbatim; `ClaudeClient` keeps the public surface, the loop and every method that logs (incl. `toContentBlock`, C2); record `grep -n "log\."` before/after.
- [x] 2.2 Compile; run the affected spec set; commit the after-record with identical per-suite counts and the verbatim-move check (design D3.5).

## 3. Spec split (no assertion touched)

- [x] 3.1 Split `ClaudeClientSpec` per design D2 with a shared test-support file.
- [x] 3.2 Split `AssistantServiceSpec` per design D2 with a shared test-support file.
- [x] 3.3 Split `AssistantConversationRoutesSpec` per design D2 with a shared DB fixture support trait, lifecycle unchanged.
- [x] 3.4 Run the affected spec set; commit the after-record, the empty sorted-name diff, the per-name count table and the redistribution table, and the test-body verbatim check.

## 4. Final verification

- [x] 4.1 Full `sbt testFull` in the same shards; commit totals; sum equals baseline.
- [x] 4.2 `wc -l` of every touched/new file committed; any file over ~250 has its reason recorded in `pr-notes.md`.
- [x] 4.3 `npm run check:scala-quality` (or the hook) clean; `git diff --stat "$BASE_SHA"...HEAD` (BASE_SHA from `resolve-review-base.sh`) shows only backend `infrastructure/ai`, the three spec areas and the change dir.
