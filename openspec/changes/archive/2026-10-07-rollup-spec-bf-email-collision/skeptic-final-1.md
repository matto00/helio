## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e7e0dba9a4e3ad0d83eb5bb0c3e54168edfb1ba7`. The base was resolved live with `resolve-review-base.sh`, which returned `0d28f43f036f0bfed63216c406572dca83a3dece` (exit 0). The spawn-cwd guard returned READY. There are no UI changes, so I skipped the design step and did not start any servers or a browser.

### What I verified (with evidence)

**Branch diff (`git diff BASE...HEAD`)**
- There is one code file: `backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala`, with 24 lines changed.
- The rest of the diff is change-dir artifacts: `.openspec.yaml`, proposal, design, tasks, ticket, files-modified, and skeptic-design-1/2.
- There is no production code, no migration, no V114 edit, and no stray files.
- `files-modified.md` matches the diff.
- The `*.log` files are gitignored (`.gitignore:27`), so none of them ship.

**Harness unchanged**
- `git diff --quiet BASE HEAD -- backend/src/test/scala/com/helio/testsupport/ProductTelemetryDbHarness.scala` returned HARNESS_IDENTICAL.

**Owner ruling**
- `.concertino/runs/HEL-1360/events.jsonl` contains `escalation.answered` with `answer: proceed-with-restated-scope` and `answer_source: human`.

**What the code does**
- The backfill fixture emails are now `'bf' || g || '@backfill.invalid'`. The cleanup DELETE and `otherUsers` both select `%@backfill.invalid`. No `bf%@t.local` selector remains.
- A decoy user `bf222222-…@t.local` is inserted before the `created_at` UPDATE.
- The survivor check (an exact-id count of userA, userB and the decoy, which must equal 3) runs after the backfill cleanup and only when the body completed. The decoy is then deleted by id in an outer `finally`.
- The assertion `countEvents("signup_completed") shouldBe 400 + otherUsers` is unchanged and is still an exact equality.

**Fresh sbt runs.** All used `cd backend && nice -n 19 sbt "testOnly com.helio.services.telemetry.ProductEventRollupServiceSpec"`, were run sequentially, and reported `Total number of tests run: 7` every time:

1. **HEAD as committed.** Exit 0, `Tests: succeeded 7, failed 0`. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1360/evidence/openspec/changes/rollup-spec-bf-email-collision/skeptic-final-run-head.log`
2. **HEAD with harness userA forced to `bf111111-1111-4111-8111-111111111111`** (temporary, harness line 35). Exit 0, `succeeded 7, failed 0`. This is the "passes after" half of AC1. Ref: `.../skeptic-final-forced-green.log`
3. **Pre-fix spec (`git show BASE:<spec>`) with the same forced UUID.** Exit 1, `403 was not equal to 402 (ProductEventRollupServiceSpec.scala:85)`, 6 passed and 1 failed. This is the "fails before" half of AC1, and the exact ticket symptom. Ref: `.../skeptic-final-red-prefix.log`
4. **Mutation: a full revert of Decision 1 on HEAD.** The fixture email and both selectors went back to `bf…@t.local`; the decoy and the guard were kept; the harness was not forced. Exit 1.
   - Test 5 failed with `404 was not equal to 403 (ProductEventRollupServiceSpec.scala:99)`. Line 99 of the post-fix file is the same `countEvents("signup_completed") shouldBe 400 + otherUsers` assertion that sat at :85 before the fix; the fix shifted it down by 14 lines. I confirmed this with `sed -n 99p`.
   - Tests 6 and 7 failed with `2 was not equal to 3 (…:85)`. That is the survivor guard, so the AC3 guard can be failed by mutation.
   - Ref: `.../skeptic-final-mutation.log`
- After each mutation I restored the files with `git checkout --`. Tracked files are clean at the same HEAD (`git diff --quiet HEAD` returned TRACKED_CLEAN). The only untracked file is the evaluator's `evaluation-1.md`, which is pre-existing.

**Executor logs (claims)**
- `red-forced-bf.log`, `red-survivor.log`, `green-forced-bf.log`, `green-final.log` and `mutation-full-revert.log` agree with what I reproduced.

### Acceptance criteria trace
- **AC1 (forced-bf fails 403 vs 402 before, passes after):** runs 3 and 2 above.
- **AC2 (no tolerance loosened):** the diff does not touch any `shouldBe` expected value. `400 + otherUsers` is still exact, and so is the `SUM` at the `400L + otherUsers` assertion.
- **AC3 (cleanup no longer deletes harness users):** the cleanup selector is now the reserved `.invalid` domain, which no `<uuid>@t.local` email can match. The permanent survivor guard checks this, and run 4 shows the guard fails when the old selector is restored.

### Verdict: CONFIRM

### Non-blocking notes
- The decoy INSERT, the UPDATE and the 400-row INSERT all run before the outer `try`. If the UPDATE or the bulk INSERT threw, the decoy would leak. That would be no worse than the pre-existing leak of the bf users in the same situation, and it is very unlikely.
- tasks.md 3.3 and design.md cite ":85" for the mutation's failure. In the post-fix file that assertion is at :99, and :85 is now the survivor check. The behaviour is correct; only the line citation in the artifacts is stale.
