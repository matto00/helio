## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Scope: the delta since skeptic-final-1 (CR1 create-time coverage, CR2 doc-comment correction),
plus independent re-verification of the backend gate at HEAD 20d95df4. Round 1's findings on
guard reachability, the connect-time chokepoint trace, the ContentSourceSupport refactor, and the
Decision 4 pinning deferral are relied upon; I saw nothing contradicting them.

### What I verified (with evidence)

1. **The delta is test/doc-only.** `git diff 4174a87f..HEAD --stat` touches only
   `SourceServiceSpec.scala`, `SqlConnectorEgressGuardSpec.scala` (comment), evidence transcripts,
   `evaluation-2.md`, `files-modified.md`, `skeptic-final-1.md`. No production source changed since
   round 1, so round 1's production-code findings still bind.

2. **CR1 — the new create-time coverage is real, and asserts non-persistence.**
   `SourceServiceSpec.scala:169-186` runs four cases (loopback 127.0.0.1, link-local
   169.254.169.254, RFC1918 10.0.0.5, IPv6 ULA fd00::1) through a *fake resolver only*
   (`resolverFor`) with the **real** `ContentSourceSupport.isBlockedAddress` denylist left intact —
   so the denylist itself is under test, not stubbed. Each case asserts all three of:
   `result shouldBe a[Left]`, the error is `ServiceError.BadRequest`, and
   `sourceCount() shouldBe before` where `sourceCount()` is a real repository read
   (`dataSourceRepo.findAll(owner, Page(0,1000)).total`) after a real `TRUNCATE data_sources`.
   That is a genuine persistence assertion, not a restatement of the Left.

3. **CR1 — the mutation transcript's red is red for the right reason.**
   `evidence/task-5.2-mutation-check-RED.txt`: with only `createSql`'s own `checkConfigEgress`
   call site neutralised, exactly the 4 new tests fail, and each failure payload is a
   `Right(CreateSourceResponse(SqlSourceResponse("<real uuid>", "Blocked", ...)))` carrying
   `fetchError = Some("Egress refused: ...")` from the untouched connect-time guard. That is
   precisely AC1's forbidden outcome — row persisted, caller gets a 200-shaped success — and not a
   timeout / missing-driver / fixture artifact. The paired GREEN-restored transcript exists. Note
   also that the mutant demonstrably *does* insert a row (real generated id), so the
   `sourceCount()` assertion is failable too, not vacuous.

4. **CR1 — the guard's position in `createSql` matches the claim.**
   `SourceService.scala:58-88`: `checkConfigEgress(..., failOnUnresolvable = false)` is evaluated
   *before* `dataSourceRepo.insert`; the `Left` branch returns without touching the repo. The code
   structure and the test agree.

5. **CR2 — the false doc comment is corrected and now accurate.**
   `SqlConnectorEgressGuardSpec.scala:17-23` now says task 5 is covered *at the pure-function level
   ONLY* here and attributes the `SourceService.createSql` rejection/non-persistence proof to the
   new `SourceServiceSpec` block. I read both files; the attribution matches reality.

6. **Gates re-run by me, at HEAD, output read.**
   - `sbt testOnly SourceServiceSpec SqlConnectorEgressGuardSpec ContentSourceSupportSpec` →
     68 tests, 3 suites, 0 failed.
   - `sbt test` (full backend) → **3878 tests, 255 suites, 0 failed, 0 canceled, 0 ignored**, 271 s.
   This independently reproduces evaluation-2's summary rather than trusting it.

7. **Spec/AC trace.** AC1 ("cannot be created… nothing persisted") → item 2/3 above and
   `specs/sql-database-connector/spec.md` scenario 1. AC2 (every operation guarded) → the
   `SqlConnectorDriver.connect` chokepoint (`SqlConnectorDriver.scala:97-107`), verified in round 1
   and unchanged. AC3 (pin *or* documented residual risk) → design.md Decision 4 states the
   inability to pin and the residual DNS-rebinding TOCTOU in full; taken as satisfied, consistent
   with round 1.

### Verdict: CONFIRM

Both round-1 change requests are addressed in substance, not cosmetically: the create-time guard
now has coverage that a mutation demonstrably turns red for the correct reason, and the misleading
comment is fixed. The full backend suite is green under my own run. This is shippable as a security
fix.

### Non-blocking notes

- design.md's own closing paragraph obliges the **PR body** to name a concrete follow-up ticket for
  the per-dialect socket-factory pin. `HEL-998` now exists but appears nowhere in the change dir or
  the code (`grep -rn HEL-998` → no hits). Make sure the PR body actually names it, and consider a
  one-line residual-risk pointer in `SqlConnectorDriver.connect`'s doc comment
  (`SqlConnectorDriver.scala:93-96`), which currently documents the guard but not the unpinned
  residual window.
- The comment on the positive test (`SourceServiceSpec.scala:190-196`) is garbled — it discusses a
  `localhost`/`admitLocalhostSql` combination the test does not use, then says it is out of scope.
  It reads as a half-edited draft; trim it to the one sentence that matters (this asserts the
  create-time gate does not reject a permitted host).
- That positive test performs a real JDBC connect attempt against 93.184.216.34. It is fast here,
  but in a network-restricted CI sandbox it can absorb the pgjdbc connect timeout (~10 s). Bounded,
  not a flake risk, but worth knowing if suite time creeps.
