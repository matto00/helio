## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: b94bcd052360ba4e78808140e98fb25e64d2c9a1 (base 77f46a5df981ea34efa10bae0c1fd8a50f1ceb05, resolved live).

### Phase 1: Spec Review — FAIL

Passing:
- AC1 (red-first measurement on both reproducers, peak <= 192 MB after): both reproducers measured red-first under
  `-Xmx768m`, SerialGC, `taskset -c 0`. `fewrows-utf16-200` real is red with spray marshalling (executor: 230.4 / 413.6 MB;
  my own 2-repeat spot check: 360.4 / 169.2 MB real, 147.0 / 147.0 MB dry). After the fix it is green (executor: max 109.4 MB
  over 5 repeats; mine: 99.9 / 81.8 MB real, 95.8 / 99.1 MB dry). `rowwidth-at-limit` stays <= 192 MB both before and after
  (red-first max 155.9 MB, green max 158.9 MB). Full-spec green max over all shapes is 182.4 MB (`just-under-light@2600000`
  dry), so it is inside the bound with a 9.6 MB margin.
- **Premise finding, not a defect:** `rowwidth-at-limit` is not red under spray marshalling on the certified rig. Its body
  is only 16 MB (50,000 rows), so the render's transient (about 3x the body) stays below the run's own walk peak, which
  already dominates (`none`-mode baseline 152.1 / 137.3 MB real). The executor cannot make it red without changing the
  shape. The design's D4 stop condition ("neither exceeds") was not triggered, because `fewrows-utf16-200` is red. The
  ticket's assumption that both reproducers spike past the share was half wrong. This finding has to be recorded in a
  durable artifact (CR 2).
- AC2 (mutation-checked guard): G1 (comma drop and key-escape mutations: 4 and 2 tests red), G2 (run route and both apply
  routes reverted to the default marshaller: red on `chunks should not be empty`), and G3 (shared marshaller reverted:
  fewrows real 360.4 MB, red). The recorded outputs are in `.concertino/scratch/HEL-1693/mutation-*.txt`. My own spray-mode
  run reproduces the G3 red independently.
- AC3 (consumers unchanged): verified live (see Phase 3 note). A dry run on the real route returns
  `Transfer-Encoding: chunked`, `Content-Type: application/json` and no `Content-Length`. The body is compact JSON that
  parses to the same field set (`blocked, rowCount, rows, runId, sourceRowCount, sourceTruncated, stepRowCounts,
  truncatedReads`). CORS headers are still added, and the Vite proxy returns 200. The error path (422) is unchanged: a
  strict body with `Content-Length`. No client reads `Content-Length`: the helio-mcp `httpClient.ts:338` uses
  `response.json()`, and the frontend uses axios.
- C1 is honored: `RunPathHeapSpec` stream mode calls `RunResponseMarshalling.chunkedJson`, the same object the three
  routes call. C2 is honored: no field is capped, dropped or renamed, and G1 holds the bytes equal to `compactPrint`.
- There is no scope creep. The three routes changed are exactly the success paths of run, apply-proposal and combined
  apply.

Issues:
- `tasks.md` 3.4 is still unticked ("sbt testFull, helio-mcp tests, frontend jest green; HEL-1660/1679 guards green").
  testFull evidence exists (`testfull.summary.txt`), but no helio-mcp or frontend jest result is recorded (CR 3).
- The red/green evidence and the rowwidth premise finding exist only in `.concertino/scratch/HEL-1693/`, which is swept
  after merge. No change artifact records the measurement, although the AC is a measurement and the HEL-1679 precedent
  is an archived `measurements.md`. `proposal.md` "Why" still says the render "is expected to push a manual run past the
  share" on both reproducers, and that is now known to be true for only one (CR 2).

### Phase 2: Code Review — FAIL

Gates (run by me, fresh, in WORKTREE_PATH; backend-only change):
- `sbt testFull` (under the sbt lock, nice 19): `Tests: succeeded 9414, failed 0, canceled 5`, hel1468-guard
  `failed=0 aborted=0 unreadable=0`, exit 0.
- `npm run check:scala-quality`: clean (soft size warnings only; `RunPathHeapSpec.scala` grows to 361 lines, over the
  soft budget of 250, which is non-blocking).
- `git diff --check`: clean. `check-openspec-hygiene.mjs`: clean.
- Frontend gates: not triggered (no `frontend/**` change).

Review:
- The printer is correct. It is iterative (an explicit stack, so deep nesting cannot overflow), and it flushes only after
  a whole element. Keys and scalars go through spray's `CompactPrinter`, and `JsObject.fields` is iterated in the same
  Map order spray uses. The last piece is never empty. `hasNext`/`next` are consistent.
- Behavior on other paths:
  - Every error status is decided inside `ServiceResponse.run` before the entity exists, so errors are unchanged.
  - No `encodeResponse`, `toStrictEntity` or response-wide `mapResponse*` sits in the main route tree.
  - `TopLevelErrorHandlers.scala:64` matches only strict `text/plain`, so it is unaffected.
  - The only behavioral difference is timing. The render now happens after the response headers, so pekko's
    `request-timeout` no longer covers render time, and a throw mid-stream would truncate the connection instead of
    returning a 500. Printing an already-built `JsValue` cannot realistically throw. This is acceptable.
- Tests are meaningful. G2 asserts chunking, byte equality with compact rendering, round-trip parsing and a piece bound
  on a 6,000-row fixture. G1 covers adversarial strings (lone and reversed surrogates, control characters, a large value)
  at several piece sizes.

Issues:
- **CONTRIBUTING.md "Imports & Qualifiers"** ("never inline a fully-qualified name when an `import` would do"; line 337:
  "Follow the Imports & Qualifiers rule strictly"). It is violated in
  `backend/src/main/scala/com/helio/api/routes/RunResponseMarshalling.scala:45`, `:51` and `:67`, where
  `java.lang.StringBuilder` is written out inline 3 times. An import does the job here, and the repo has precedent:
  `import java.lang.{Double => JDouble}` (`domain/history/JsSemantics.scala:5`) and
  `import java.lang.{Math => JMath}` (`OutputSummaryReducer.scala:8`). The mechanical checker's prefix list does not
  include `java.lang.`, which is why the gate passed, but the rule itself applies.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The no-UI-change claim
was still checked live against the running backend (ports 7125/10032, started and stopped through the canonical
scripts). A dry run on the real route returns a chunked `application/json` body that parses and is compact JSON. CORS
headers are present, and the request succeeds through the Vite proxy. The 422 error path still returns a strict body.

### Overall: FAIL

### Change Requests
1. `backend/src/main/scala/com/helio/api/routes/RunResponseMarshalling.scala:45,51,67`: replace the 3 inline
   `java.lang.StringBuilder` with a top-of-file `import java.lang.{StringBuilder => JStringBuilder}` and use
   `JStringBuilder`. This follows CONTRIBUTING.md "Imports & Qualifiers" and matches the precedent in `JsSemantics.scala:5`.
2. Add `openspec/changes/bound-manual-run-response/measurements.md` so the AC evidence survives the post-merge scratch
   sweep. It should hold:
   - the method (`-Xmx768m`, SerialGC, `taskset -c 0`, repeats, per-piece sampling every 8th piece plus the background
     sampler);
   - the red table (spray: fewrows real 230.4/413.6 MB etc., rowwidth max 155.9 MB) and the `none` baseline;
   - the green tables (reproducers max 158.9 MB; full spec max 182.4 MB, `just-under-light@2600000` dry);
   - the G1/G2/G3 mutation red outputs (short excerpts);
   - the premise finding that `rowwidth-at-limit` was not red because its 16 MB body's render transient stays below its
     own walk peak.
   Also change `proposal.md` "Why" so it no longer says both reproducers are expected to exceed the share: point to the
   measured result instead.
3. `tasks.md` 3.4: run the helio-mcp tests and the frontend jest suite (`HELIO_JEST_MAX_WORKERS=2`), or record why they
   are N/A for a backend-only, byte-identical change. Then tick 3.4.

### Non-blocking Suggestions
- `RunResponseMarshalling.scala:48,58`: `CompactPrinter(scalar)` allocates a String per scalar and key, then copies it
  into the piece. `CompactPrinter.print(value, sb)` (spray's public `JsonPrinter.print(JsValue, java.lang.StringBuilder)`)
  writes into the builder directly, with identical bytes. It saves one copy of the widest value (up to about 4 MB at
  `MaxStringChars`) and an allocation per cell.
- `RunPathHeapSpec.scala:86`: `renderSystem` is never terminated. Add an `afterAll` that terminates it.
- `RunResponseChunkedRoutesSpec.scala:50`: the piece bound `PieceChars * 3 + 1024` is loose. A comment explaining the 3x
  factor (UTF-8 bytes per char for the fixture's characters) would help.
- Follow-up candidate already named in the proposal: a row cap needs an owner ruling. Also note that the chunked
  transfer takes these responses out from under Cloud Run's 32 MiB non-streamed response cap. A 53 MB body like
  fewrows-utf16-200 would previously have been refused at the edge in production and now gets through. That is benign,
  but it is a production-observable change worth one line in the PR body.
