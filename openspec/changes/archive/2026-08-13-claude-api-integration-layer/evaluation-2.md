## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `46dd0f42` "HEL-390 Fold-in: recover mid-stream SSE connection drops (design.md D9)",
on top of cycle 1's `d287cc99` (PASS, `evaluation-1.md`; PR #326 open). This is a coordinator-
approved fold-in scope addition, reviewed on its own merits per the resume instruction — cycle 1's
PASS stands and is not re-litigated here.

Scope of this cycle's diff (code): `backend/src/main/scala/com/helio/ai/ClaudeSseAssembler.scala`,
`backend/src/test/scala/com/helio/ai/ClaudeStreamAssemblySpec.scala`. Plus the OpenSpec artifacts
(`ticket.md` new AC, `proposal.md` fold-in bullet, `design.md` D9, `tasks.md` section 7,
`specs/claude-api-client/spec.md` new requirement) and two fresh skeptic design-gate reports
(`skeptic-design-foldin-a-1.md` REFUTE, `-2.md` CONFIRM).

### Phase 1: Spec Review — PASS

- [x] New AC (ticket.md's fold-in AC 8) addressed explicitly: `ClaudeSseAssembler.assemble` now
  wraps its `Source` in `.recover`, converting a mid-stream byte-source failure into a terminal
  `ClaudeStreamEvent.Error(TransportFailure(...))` element followed by normal completion. Matches
  the new spec.md requirement ("Mid-stream connection failures surface as a typed error event") and
  its scenario verbatim.
- [x] No AC reinterpreted — `design.md` D9 is explicit and the code matches it exactly (placement
  inside `assemble`, not at `HttpClaudeTransport`'s call site; `HttpClaudeTransport.scala` is
  byte-for-byte unchanged in this commit, confirmed via `git diff d287cc99..46dd0f42 --
  .../HttpClaudeTransport.scala` — empty).
- [x] `tasks.md` section 7 (7.1–7.3) all marked done and match what's implemented — verified each
  against the diff.
- [x] No scope creep — diff is confined to the two files above plus the OpenSpec artifacts; no
  drive-by changes to `ClaudeClient`, `HttpClaudeTransport`, or any other file in `com.helio.ai`.
- [x] No regressions — full `sbt test` suite green (2540/2540, see Phase 2).
- [x] No API-contract/schema changes needed — still a library with no route consumer.
- [x] Planning artifacts reflect the implementation — `design.md` D9 and the fold-in design-gate's
  round-1 REFUTE → round-2 CONFIRM history (below) both correctly anticipated exactly the
  placement/test-reachability issue that would otherwise have shipped an untested fix; the shipped
  code matches the round-2-confirmed design precisely.

**Design-gate history sanity check:** Read both `skeptic-design-foldin-a-1.md` (REFUTE) and
`-2.md` (CONFIRM). Round 1 correctly identified that placing the `.recover` inline at
`HttpClaudeTransport.stream`'s call site (the fold-in's original proposal) would be untestable by
any existing spec file (`ClaudeStreamAssemblySpec` calls `ClaudeSseAssembler.assemble` directly, not
through `HttpClaudeTransport`; `ClaudeClientSpec` never touches the real `HttpClaudeTransport` at
all) — a real, correctly-diagnosed "green test that exercises nothing" trap. Round 2 confirmed the
revision (move the fix into `ClaudeSseAssembler.assemble` itself) closes that gap. The shipped code
matches the round-2-confirmed design exactly, and `ClaudeStreamAssemblySpec`'s new test does in fact
call `ClaudeSseAssembler.assemble` directly (confirmed by reading the test file) — so this design
gate's own concern is provably resolved in the implementation, not just on paper.

**Pre-commit bypass, re-verified for this cycle:** the commit again bypasses `check:openspec` with
`-n`, this time for "complete (23/23) but not archived." I re-ran `node
scripts/check-openspec-hygiene.mjs` fresh myself and reproduced that exact message. Same structural
reasoning as cycle 1 applies (archival is a Phase-3 orchestrator action performed in a separate
commit after evaluator sign-off — git history already shows this pattern for this exact change:
`d287cc99` → `f715f8d5 Archive claude-api-integration-layer change` → this fold-in reopens it and
will presumably be re-archived again post-review). Correctly called out in the commit body. Not a
swept-under-rug gate failure.

Issues: none.

### Phase 2: Code Review — PASS

**Gates — re-run fresh myself** (only `backend/**` changed this cycle; no `frontend/**`):

```
$ cd backend && sbt test
...
[info] Total number of tests run: 2540
[info] Suites: completed 155, aborted 0
[info] Tests: succeeded 2540, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 106 s
```
(2539 cycle-1 tests + 1 new fold-in test = 2540, matching the commit's claim exactly.)

```
$ node scripts/check-scala-quality.mjs
Scala code-quality check: clean (86 soft warning(s))   # identical pre-existing warning set; no new
                                                        # file in this diff crosses the size budget
                                                        # (ClaudeSseAssembler.scala: 41 lines,
                                                        # ClaudeStreamAssemblySpec.scala: 149 lines)
$ node scripts/check-openspec-hygiene.mjs
OpenSpec hygiene issues:
  - change "claude-api-integration-layer" is complete (23/23) but not archived — ...
```
(Second result reproduces the executor-reported, expected-at-this-phase failure, analyzed above.)

No inline FQNs in either changed file (grep-verified); both are top-of-file-import-only.

**Root-cause claim, independently verified (per the resume instruction's specific ask) — not just
trusted from the commit message.** I wrote a standalone Pekko Streams probe (run via `sbt console`
against this project's actual classpath and dependency versions; never written to any tracked file,
deleted from my scratch dir afterward — no repository file was modified for this) with three cases,
each run repeatedly:

1. **Raw `Source.single(x) ++ Source.failed(e)` → `Sink.seq`** (5 runs): every run produced
   `Failure(RuntimeException)` — `Sink.seq`'s materialized `Future` is all-or-nothing by contract,
   so this alone doesn't distinguish "lost element" from "Sink.seq's normal all-or-nothing
   semantics."
2. **The actually-relevant case — the *production* pipeline shape** (`Source.single(validFrame) ++
   Source.failed(e)` through `Framing.delimiter` + `.recover`, i.e. exactly what the *old*,
   rejected test fixture would have exercised) — 20 runs: **every single run** produced
   `Vector(RECOVERED:boom)` — the valid frame was lost, **100% of the time**, not intermittently.
3. **The fixture actually shipped** (`Source(List(1,2)).map { case 1 => validFrame; case _ =>
   throw ... }` through the identical `Framing.delimiter` + `.recover` pipeline) — 20 runs: **every
   single run** produced `Vector(HELLO, RECOVERED:boom)` — correct, strict ordering, 100% of the
   time.

**Conclusion:** the substantive claim is verified accurate — the rejected `Concat`-based fixture
would have shipped a test that could never demonstrate the fix (it deterministically loses the
first frame, so a test built on it would either always fail, or — worse — an implementer might
"fix" the *test* by asserting on the wrong (1-element) outcome, silently validating nothing), while
the shipped `.map`-based fixture reliably (not "happens to pass once") demonstrates strict,
correct ordering matching the real code path. One precision note, not a substantive inaccuracy:
the commit/comment language ("a demand/backpressure **race**... does not **reliably** deliver")
implies nondeterminism, but my probe shows this is fully deterministic in both directions (20/20
and 20/20, not flaky) — it's a deterministic difference in how `Concat`'s sub-source switchover
interacts with `Framing.delimiter`'s upstream-failure handling (which does not flush an
already-parsed-but-not-yet-fully-drained frame on failure the way it does on graceful completion
under `allowTruncation = true`), not literal nondeterministic racing. This doesn't change the
engineering conclusion or the fix's correctness — flagged as a non-blocking wording nitpick only.
Also worth noting: the `.map`-based fixture is arguably a *more* faithful model of a real
`HttpEntity.dataBytes` connection drop (a single continuous byte-stream failing mid-flight) than
the `Concat`-based one was — so this wasn't just "picking a fixture that happens to pass," it's
also a better simulation of the real failure mode this fix targets.

**Other mechanical/quality checks on the diff:**
- `.recover { case e: Throwable => ... }` (catch-all, not `NonFatal(e)`) — checked against this
  codebase's existing convention: every other `.recover` in `backend/src/main/scala` (e.g.
  `RestApiConnector.scala:100,125`, `BoundPanelService.scala`, `DataSourceService.scala`, etc.) uses
  the same untyped/`Throwable`-catching `case e =>` pattern, not `NonFatal`. Consistent with
  established codebase convention, not a new deviation introduced by this diff.
- Never logs the API key — `log.error("Claude streaming connection failed mid-stream", e)` logs only
  the exception, no key ever held by this object.
- No dead code, no leftover TODO/FIXME.
- Doc comment on `ClaudeSseAssembler` updated to describe the D9 behavior accurately and matches the
  shipped code exactly (placement, no-retry, key-never-logged).

Issues (blocking): none.

### Phase 3: UI Review — N/A

Still no `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` *implementation*
changes (only the change-scoped `openspec/changes/.../specs/claude-api-client/spec.md` delta and,
separately, the stale-until-next-archive `openspec/specs/claude-api-client/spec.md` synced copy from
cycle 1's archive — expected divergence given this fold-in hasn't been re-archived yet; not a code
defect, an archival-timing artifact the orchestrator's Phase 3 will reconcile). No route/consumer
wired in this cycle either.

### Overall: PASS

### Non-blocking Suggestions
- `ClaudeStreamAssemblySpec.scala:130-134`'s comment characterizes the `Concat`-based fixture's
  failure as "a demand/backpressure race" / "doesn't reliably deliver" — my probe shows this is
  fully deterministic (20/20 either way), not racy/intermittent. Consider tightening the wording to
  something like "does not deliver the first sub-source's already-buffered element before the
  second sub-source's failure reaches `Framing.delimiter`, which does not flush a pending frame on
  upstream failure the way it does on graceful completion" — more precise, same conclusion.
- (Carried over from evaluation-1.md, still applicable, still non-blocking) `ClaudeModels.scala:28`
  cites `design.md D4/D9` — now that a real D9 exists (this fold-in), that comment happens to be
  accidentally correct again, but only by coincidence (it originally referred to a D9 that didn't
  exist at the time). Worth double-checking that comment's intent still matches D9's actual content
  (D9 is about mid-stream SSE recovery, not about token-usage-from-API-not-estimate, which is what
  that comment is actually about) — it likely should just cite D4.
