## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `9a6aeb66c0d071d464f47d876219d7a1f22c0ac8` against the live-resolved base `27a30bb97289040c44c8fae547d7b2fa8df8a208`.
Diff: `LateFinisherSpecBase.scala` (modified), `LateFinisherSeamIsolationSpec.scala` (new), plus openspec change artifacts.
No `frontend/**`, `backend/src/main/**`, `schemas/**` or `openspec/specs/**` files are in the diff (checked with `git diff --name-only`).

### Phase 1: Spec Review — PASS
- AC1 (hazard re-derived after HEL-1564): evidence.md D1 cites the base line numbers. I checked them against `git show 27a30bb97:.../LateFinisherSpecBase.scala`. `GatedRunRepo` read `terminalWritten` inside `.andThen`. `HookSnapshotRepo` read `nodeWrites` (a shared `val`, reset with `set(0)`), `foldDone` and `afterNodeWrite` inside `.flatMap`. `HookBackend` read `afterEngine` inside `.flatMap`. `HookOutputRepo` and `HookBinaryRepo` read their state at call start, so they are not affected. All of this is correct.
- AC2 (capture at call start): all five fields are bound to local vals at the top of the call. `nodeWrites` became a per-test `@volatile var` that holds a fresh `AtomicInteger`, so the counter can be captured too.
- AC3 (red-first under a forced ordering): each test holds the call on a promise the test completes itself. There are no sleeps or `eventually` calls (I grepped the new spec). The red output is recorded for all five tests.
- AC4 (mutation): all five single-capture mutations are recorded. I reproduced two of them myself (see Phase 2).
- AC5 (existing specs stay green, no production change): verified, 21/21 pass. The diff has no `backend/src/main` change.
- Constraints C1, C2 and C3 are honored. Every evidence claim cites test counts or failing test names.
- Minor scope addition: `resetSeams()` now also resets `binaryTarget` (before this change, `afterEach` never reset it). It is disclosed in evidence.md, it is test-only and harmless, and all existing specs still pass. Not blocking.

### Phase 2: Code Review — PASS
Fresh gate runs (all from the worktree's own `backend/`; both project-path lines name this worktree):
- `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly LateFinisherRunSpec LateFinisherDeleteAfterWonSpec LateFinisherSeamIsolationSpec"` (fully qualified names). Result: `Total number of tests run: 21`, `Suites: completed 3, aborted 0`, `Tests: succeeded 21, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0`.
- Mutation 1, reproduced: `written.trySuccess` -> `terminalWritten.trySuccess`. Result: `Total number of tests run: 5`, `succeeded 4, failed 1`. The failing test is "complete its own test's terminalWritten ... (GatedRunRepo)" at `LateFinisherSeamIsolationSpec.scala:43`. This matches the evidence.md row.
- Mutation 2, reproduced: `counter.incrementAndGet()` -> `nodeWrites.incrementAndGet()`. Result: `Total number of tests run: 5`, `succeeded 3, failed 2`. The failing tests are counter (`1 was not equal to 0`, l.75) and foldDone (l.105). This matches the evidence.md row, including the knock-on foldDone failure.
- The file was restored after each mutation from a scratch backup. `git status --short` is empty, so the tree is clean.
- `npm run check:scala-quality`: clean. The 249 soft warnings are pre-existing, and none of them is a LateFinisher file. `npm run check:test-temp-dir-hygiene`: clean. `npx prettier --check` on the change dir: clean.
- `sbt testFull` was not run. The orchestrator's binding rule scoped sbt to the LateFinisher specs. `LateFinisherSpecBase` is referenced only by the three LateFinisher specs (grep of `backend/src`), and no main code changed.

Code: capture-at-start is minimal and well commented. `resetSeams()` is the single definition, and `afterEach` calls it. Imports are explicit, with no inline FQNs. There is no dead code.

### Phase 3: UI Review — N/A
No trigger paths in the diff. I checked this against the diff itself, not taken from the brief.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `LateFinisherSeamIsolationSpec.scala:96`: `{ val p = Promise[Unit](); p.success(()); p }` could be `Promise.successful(())`.
- The counter test (l.68-76) asserts only that the NEW counter is 0. Capturing the old counter before `resetSeams()` and also asserting `old.get == 1` would make the test two-sided, matching the other tests.
- `LateFinisherSeamIsolationSpec.scala:57`: `HookBackend.execute(null, ..., null, null, null)` is safe because the stub ignores its arguments. A short comment saying so would help a future reader.
