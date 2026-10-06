## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `30ea19233006480833c813cb77e37fef2bbfc3db`, which sits on top of `679070dc`. The diff base `d9473814f16df0c54ef76117c00ce9c071297b2b` was resolved live. The primary review surface is the delta `679070dc..30ea1923`, plus a re-scan of the full change.

### Phase 1: Spec Review — PASS
Issues: none.

- The delta is limited to cycle 1's change requests and suggestions, plus the committed `evaluation-1.md`. It adds no new scope.
- C1–C5 are still honored.
- `NodeSnapshotRepository.scala`, `BinaryRefRepository.scala`, `ci.yml`, `playwright.config.ts` and V115 remain untouched.

### Phase 2: Code Review — PASS

**Gates.** I ran each of these myself in WORKTREE_PATH at 30ea1923:
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`: `Tests: succeeded 6015, failed 0`, "All tests passed", EXIT=0, 717 s.
  - There was no FirstRunRoutesSpec timeout; that spec ran and passed.
  - There was no "Java heap space" error.
  - The new trim test ran: "should delete exactly ONE excess payload per write …".
- `check:scala-quality`, `check:node-root-encoding` and its selftest, `check:schemas`, `check:openspec`, `format:check` and `lint` are all green.
- No `frontend/**` files changed.

**Cycle 1 change requests:**
1. **Inline FQNs are fixed.**
   - `NodePayloadFixtures.scala` now imports `java.sql.Timestamp` and calls `Timestamp.from(at)` at lines 74 and 85.
   - `NodePayloadWiringSpec.scala` imports `java.time.Instant` and calls `Instant.now()` at lines 135 and 142.
   - A regex scan of every added Scala line in `d9473814...HEAD` for `pkg.sub.Name` qualifiers outside `import` and `package` lines found zero hits. No new inline qualifier was introduced anywhere in the change.

**Cycle 1 suggestions, all addressed:**
- **Trim deletes one row: the new test goes red under mutation, which I reproduced myself.**
  - I created a throwaway detached worktree at 30ea1923 under the session scratchpad.
  - I mutated the step-node trim in `NodePayloadHistoryRepository.insertAndTrim` from `WHERE id = (… OFFSET $keep LIMIT 1)` to `WHERE id IN (… OFFSET $keep)`, which deletes every excess row.
  - I ran `nice -n 19 sbt "testOnly com.helio.services.pipelines.NodePayloadHistoryWriteSpec"`. Result: `should delete exactly ONE excess payload per write … *** FAILED ***`, with `10 was not equal to 13 (NodePayloadHistoryWriteSpec.scala:205)` and 12 passed, 1 failed.
  - The existing "keep only the beta cap's 10 newest" test stayed green under that mutation, which confirms the old test could not detect it.
  - I removed the throwaway worktree with `git worktree remove --force <exact path>`, and `git worktree list` shows no straggler.
- **The share token is now valid.** `NodePayloadWiringSpec` inserts a real `share_tokens` row: the SHA-256 hex of a random token, with no `expires_at` and no `revoked_at`. That matches `ShareTokenRepository.findActiveByHash` and `TokenHashing.sha256Hex`. The anonymous and token-only requests through the full tree both still assert 401 with no `"rows"` or `"label"` in the body.
- **`findById` has a checked decode.** It now matches `case arr: JsArray`. Any other shape throws an `IllegalStateException` naming the row id, replacing the unchecked `asInstanceOf`.
- **The `slick.dbio.DBIO` import is moved.** In `PipelineRunService.scala` it now sits after `org.slf4j` and before `spray.json`, out of the `com.helio` block.

### Phase 3: UI Review — N/A
Nothing in the delta since cycle 1 matches a Phase 3 trigger: the delta has no `frontend/**`, `schemas/**`, `ApiRoutes.scala` or `openspec/specs/**` changes. I did not start servers. Cycle 1's Phase 3 result (PASS) stands.

Shared dev DB: I created no rows this cycle. V116 was already applied in cycle 1 (installed_rank 116, checksum 561952068).

### Overall: PASS

### Non-blocking Suggestions
- `NodePayloadWiringSpec` hand-rolls the SHA-256 hex. Calling `TokenHashing.sha256Hex(shareToken)` would keep the test tied to production hashing if that ever changes.
- To prove the token is valid inside the test itself, the same token could be shown to return 200 on the public `/history` route.
