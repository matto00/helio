## Skeptic Report - design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Time sources complete: grep of both classes shows exactly Instant.now() at ConnectorCompletionService.scala:86,102 and ConnectorCompletionTokenRepository.scala:48,84,97 - matches design.md's list (mintSupersedingPrior, consume, findLiveByConnector). No other time source in the expiry path.
- Latency-sensitive tests complete: grep for Thread.sleep/ofMillis in ConnectorCompletionServiceSpec finds exactly the three 50 ms tests (lines 256, 308, 341); no other 50 ms usage elsewhere in connector specs. Test at line 230 (supersede) uses 60 min expiry, not at risk.
- Hypothesis plausible from code: test 2 asserts complete() succeeds on a 50 ms re-mint after several DB round trips.
- Real SQL predicate kept: design D1/D2 passes the same clock to repo.consume (predicate `expiresAt > now`) and to mintToken; expiry still evaluated by Postgres on persisted timestamps. D3 mutation proofs (consume bypassing clock, resolveValidToken ignoring clock, predicate deletion) cover this.
- Source compatibility: constructors are `ConnectorCompletionTokenRepository(ctx)(implicit ec)` and a defaulted-param service; 9 call sites (ApiRoutes:704/709, SourceServiceSpec:66-67, spec fixtures) compile unchanged with a defaulted `clock`. Existing `Clock`/`SystemClock` in domain/util/Clock.scala and FakeClock-per-spec convention confirmed.
- D0 probe gate adequate under systematic-debugging: probe before fix, run/failure counts, exact failing assertion, deterministic mechanism probe, explicit STOP/ESCALATE on mismatch, honest handling of non-reproduction.
- Security semantics: only the source of "now" becomes injectable, default SystemClock; consume predicate, validity check, refusal shape, 60 min/24 h bounds untouched. No escalation warranted; D4 correctly reserves escalation for a product-bug branch.
- ACs covered: probe+rate (1.1-1.3), injected clock not lengthened window (2.x/3.1), >=20 green runs (3.3), 3-fork recommendation (3.5). CI files untouched (stated non-goal). MISTAKES.md:213 does cite this flake, so the note update is real and in scope.
- No TODO/TBD placeholders; no contradictions between proposal/design/tasks.

### Verdict: CONFIRM

### Non-blocking notes
- Fake clock should start at a real Instant.now() as planned; note Postgres stores microseconds while Instant.now() can carry more, so advance well past (not by exactly) the expiry in tests to avoid truncation edge cases.
- Test 1 currently asserts `readAsLive.isValid(Instant.now())`; the rewrite must use the fake clock there too (D2 implies it; make it explicit).
- 3.3 should state the contended setup precisely (forks/load PIDs) so pre- and post-fix runs are comparable; tasks.md mentions it only by reference.
- The fork-recommendation should say that only this spec was fixed and other specs were not swept (already planned in D5).
