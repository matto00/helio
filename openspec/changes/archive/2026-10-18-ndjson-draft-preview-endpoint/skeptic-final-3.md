## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `fddd4537b942af3506aef76e9c8d55dfbc57533f`. I resolved the base live with `resolve-review-base.sh` (exit 0): `9a76db1e5a1c16e92e6fc27e0ccfaab8a3a512b2`, which is origin/main as expected. The full branch diff is 99 files, +8082/-127. The C9 delta (`git diff b34af435e fddd4537b`) touches:
- `DraftPreviewGate`, `DraftPreviewService` and `DraftPreviewRoutes`
- `PivotStep` and the `StringBudget`/`Limits`/`Config` docs
- the new `DraftPreviewWalkSlotSpec`
- one `HeapSpec` shape and one `StringBudgetSpec` case
- CLAUDE.md and the openspec artifacts

Spawn guard: `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.

I modified no tracked file. Mutations were applied by `run.sh` and restored from byte copies. Each restore was checked with `sha256sum -c` (OK for all three files after each mutation), and `git status --short` was empty afterwards. sbt ran `testOnly` only, under the sbtfull flock, with `nice -n 19` and `-Xmx3g`. Load average was 3.8 to 6. No server or DB process is left running; `ps` shows nothing for HEL-1630.

Evidence: `E = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/scratch/HEL-1630/skeptic-final-3/` (persisted). It holds `summary.txt`, `green.log`, and `m1-…`, `m2-…`, `m3-….log`.

### What I verified (with evidence)

**C9 item 1: slots are held until the walk's Future completes. Resolved.**

How the slot is now released:
- `Permit.walkStarted()` is the first line of `walk` (`DraftPreviewService.scala:137`).
- The only release once a walk has started is `finally slot.onWalkEnded()`, inside the walk Future's `onComplete` (`:212-221`), after `finish()` and the outcome log.
- Both stream-termination callbacks now call `releaseUnlessWalking()`:
  - the inner one at `DraftPreviewService.scala:113`;
  - the outer one at `DraftPreviewRoutes.scala:107`.
- The grace timer (`Routes:99`) still calls a full `release()`, but only when it wins the `Pending -> Expired` CAS. When that happens the lazy factory loses its CAS and returns `Source.empty`, so no walk can start. If the factory wins, the timer is a no-op.
- So **a walk starting just before expiry is safe**: exactly one CAS winner.
- **No double release:** `release()` is still `getAndSet(Released)`, which is idempotent, and every post-start stream callback is a no-op.
- The `cancelled` flag is still set at stream termination (`:112`), so the walk still stops at the next boundary.

Test runs:
- **Green:** `E/green.log` passed 90 tests, 0 failed, across 12 specs:
  - WalkSlot, ResetLeak, Abort, ReadingPool, Admission, StringBudget
  - LimiterAuth, Rls, Stream, Caps, Planner, EngineDraftSeam
- **Re-run:** WalkSlot alone passed again, 1/1. That is stable over two runs.

My own mutations (C3):
- **M1:** `releaseUnlessWalking` changed to always `release()`, which is the pre-C9 behaviour. Result: **red**, `200 was not equal to 429 (DraftPreviewWalkSlotSpec.scala:66)`. This matches the executor's `red-c9-walk-slot.log`.
- **M2:** `finally slot.onWalkEnded()` changed to `finally ()`. Result: **red**, `429 was not equal to 200 (DraftPreviewWalkSlotSpec.scala:71)`. So the spec also pins the walk-end release itself, not only the hold.
  - In the same run `DraftPreviewResetLeakSpec` stayed **green**. A walk that never started is still released by the stream/grace path, so round 1's leak has not come back.

**C9 item 2: pivot column names are charged against `ctx.stringBudget`. Resolved.**
- `PivotStep.scala:122`: `budget.foreach(_.chargeValue(colName))` runs per output column name. The budget is `None` for runs and the saved preview, because the 2-argument overload delegates with `None`.
- **M3:** I deleted that line. Result: **red**, `Expected exception StepConfigError ... (StringBudgetSpec.scala:131)` in `E/m3-pivot-uncharged.log`.
- The executor's 768 MB heap proof is also valid:
  - red: `"step execution failed" did not include "Draft preview text limit" (DraftPreviewHeapSpec.scala:275)`, with `-Xmx768m` and `maxMemory MB: 768` in the log;
  - green: 22/22.

**Merge resolution is sound.**
- The only paths both sides changed since merge-base `4429d46` are `ApiRoutes.scala` and `CLAUDE.md`.
- `ApiRoutes`: HEL-1648 only adds `pipelineRepo, pipelineStepRepo` to `SourceSampleService`. It is merged verbatim, and the draft-preview wiring is untouched.
- `CLAUDE.md`: the HEL-1648 `/sample` line was taken from main, and the draft-preview line was kept.
- Per file, the `+/-` lines of `git diff e2fb7aa72 b34af435e` match `git diff 4429d46 9a76db1e5` for all 339 files, so main came in exactly with nothing dropped.
- **Access rules coexist correctly:**
  - HEL-1648 gives an owner or editor of pipeline P (never a viewer) the ability to sample P's sources.
  - Draft-preview stays owner-or-editor (C1) and never reads sources (C2). The two are consistent: the client fetches samples, and draft-preview evaluates only frames it is given.
  - `callerRole` lives only in the analyze protocol and reads. It does not touch the draft-preview access path.

**ACs and C1-C9 on the merged tree.**
- The executor's full suite `green-c9-sbt-testFull.log` reports 9328 passed, 0 failed, 4 canceled. The 4 canceled are opt-in `HELIO_MEASURE` specs.
- That log is content-authenticated as the C9 + merge tree, with no reliance on mtime. It contains:
  - `DraftPreviewWalkSlotSpec:` (line 63012), which exists only at this head;
  - the pivot-fan-out shape at 2.5 MB with the text-limit error;
  - `SourceScopedSampleRoutesSpec:`, which arrived with the HEL-1648 merge.
- Frontend jest: 731 suites and 9132 tests passed (`green-c9-npm-test.log`).
- AC traces:
  - **AC1** (line order, no source read): Stream and EngineDraftSeam specs.
  - **AC2** (own bucket, 121st request 429, scoped PAT refused, CSRF): LimiterAuth spec.
  - **AC3** (server observes the abort): Abort spec.
  - **AC4** (send floor during a drag): `draftPreviewDrag.test.ts`.
  - **AC5** (no AI calls): seam spec.
  - **AC6** (viewer 403, editor under RLS, revoked grant refused): Rls and Admission specs.
  - **AC7** (`unavailable` lines): Planner and Stream specs.
  - **AC8** (schemas, seam tests, 413, rows not logged): Caps spec and `draftPreview.contract.test.ts`.
  - I ran the backend ones myself (`E/green.log`). They are unchanged since round 2's traces apart from the slot release.
- The spec delta (`spec.md` lines 156-161) and CLAUDE.md ("the request's in-flight slot is held until that walk has ended") now match the code. The heap bound still holds: 74.5 MB max over eleven shapes, floor(192 / 74.5) = 2.

**Drag behaviour with superseded requests holding their slots is acceptable.**
- `draftPreviewScheduler.ts:102-104` treats `429` as rate-limited, not as an error. It holds for `Retry-After` (1 s) and then sends the latest pending state.
- So the final state of a drag is always sent eventually. During a drag over a slow node, previews are only as frequent as that node allows, which is exactly the bound C5/C6 buys.
- The draft caps (20,000 rows per node, text budgets) bound ordinary node time.

**UI:** no views changed. Frontend changes are services, types and the README only, so I did not start any servers.

### Verdict: CONFIRM

### Non-blocking notes
1. **A runaway node now holds its slots indefinitely (follow-up recommended).** This follows directly from C9 and is correct accounting, but it is worth a ticket.
   - `stringops` `extractRegex` (`StringOpsStep.scala:165`) and `assert` `regex` compile user patterns with `java.util.regex`.
   - I measured `^(.*a){12}$` growing super-linearly: 25, 13, 42 and 124 ms at 18, 20, 22 and 24 chars (jshell, Java 21). That puts a few hundred characters at hours.
   - Before C9, pekko's idle-timeout or Cloud Run's request timeout would close the stream and free the slot (though the thread kept spinning).
   - Now one user's two such requests hold both running slots on an instance until the regex returns, so draft-preview is down for every user on that instance.
   - CPU exposure through this endpoint is lower than before (2 threads per instance, not unbounded), and the run and saved-preview paths already carry the same ReDoS exposure.
   - Suggested follow-up: an interruptible/time-boxed `CharSequence` for user regexes, or a regex complexity guard.
2. **A fatal throwable can leak a slot.**
   - If a fatal throwable (OOM) escapes outside per-node evaluation — `executeTree`'s synchronous call is guarded only by `NonFatal` at `:202`, and `run.map`'s `rowsLine`/`emit` likewise — the Future never completes, and the slot stays held permanently.
   - Per-node OOMs are already caught as step errors (evaluation-5), so this is narrow. It is adjacent to HEL-1660.
3. **Two doc comments are stale** and still say the slot comes back when the stream ends:
   - the class doc at `DraftPreviewRoutes.scala:53` ("The slot is held until the response stream ends");
   - `DraftPreviewGate.scala:25-26` ("the response stream calls it on termination").
4. **Round 2's notes 1, 3 and 4 still stand:**
   - a silent empty 200 after grace expiry;
   - FIN versus RST abort visibility, worth an e2e check in (e);
   - the reading slot taken before access, and 413 for `EntityStreamException`.
