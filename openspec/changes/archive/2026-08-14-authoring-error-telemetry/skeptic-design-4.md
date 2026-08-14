## Skeptic Report — design gate (round 2 of this fold-in re-run, skeptic-design-4.md)

Cold spawn, no memory of round 1. Scope: cold re-review of the fold-in revision only
(`ticket.md`/`proposal.md`/`tasks.md` §6, tasks 6.1/6.2) — HEL-401's original scope (already
implemented, evaluated, skeptic-CONFIRMed at final gate x2, archived, PR #330) was not
re-litigated. Round 1's report (`skeptic-design-3.md`) was read only as a claim to verify, not
as ground truth — everything below was independently re-derived.

### What I verified (with evidence)

1. **Round 1's specific finding.** Read `skeptic-design-3.md`: REFUTE on the grounds that
   `succeedWithTelemetry`/`succeedStreamEvent` take the whole `AttemptOutcome` case class, which
   is `private` and nested inside `DashboardAuthoringService` — moving them verbatim into a
   sibling file would fail to compile ("private class escapes its defining scope").

2. **The actual current source** (`backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala`,
   438 lines): confirmed `AttemptOutcome` at line 86 is exactly
   `private final case class AttemptOutcome(proposal: DashboardProposal, warnings: Vector[String], finalResponseText: String, tokens: TokenUsage)`
   — plain `private`, nested in the class, matching round 1's citation verbatim (line number
   included). Confirmed the 4 named helpers at lines 286–306:
   - `failWithTelemetry`/`failStreamEvent` take `err: AuthoringError` (public — `AuthoringError.scala`
     confirms it's a top-level, non-private case class with public fields `kind`/`serviceError`/`tokensUsed`).
   - `succeedWithTelemetry`/`succeedStreamEvent` take `outcome: AttemptOutcome` and reference only
     `outcome.proposal` (x2), `outcome.warnings`, `outcome.tokens` — **never `outcome.finalResponseText`**.

3. **tasks.md 6.1 as revised**: now specifies the 4 helpers move into a new sibling object (e.g.
   `AuthoringOutcomeHelpers`, explicitly NOT merged into `AuthoringTelemetry` itself, with a stated
   reason — preserving its doc-commented pure-log-emission scope), and that
   `succeedWithTelemetry`/`succeedStreamEvent` take `proposal`/`warnings`/`tokens` as separate
   parameters instead of the case class, citing the exact same file:line (`DashboardAuthoringService.scala:86`)
   round 1 cited. Cross-checked against the real usage above: the 3 named fields (`proposal`,
   `warnings`, `tokens`) are precisely and only what's actually consumed — `finalResponseText` is
   correctly omitted, not overlooked. This is a real fix, not just a restated problem: it resolves
   the compile-time defect by construction (primitive/public-typed parameters replace the private
   case class), matching round 1's own explicitly-preferred option (b) over widening
   `AttemptOutcome`'s visibility (option (a)).

4. **tasks.md 6.2**: read the real `AuthoringTelemetrySpec.scala`
   (`backend/src/test/scala/com/helio/api/routes/`). Confirmed the buffered "generated" test
   (lines 302–330) and the streaming "generated" test (lines 396–421) currently assert only
   presence — `obj.fields.keySet should contain("authoringRequestId")` (line 314) and
   `terminal.head._2.fields.keySet should contain("authoringRequestId")` (line 410) — never
   equality against the telemetry line's own `authoringRequestId` field, even though both tests
   already capture the telemetry line into `lines` via `linesFor(read, modelId)`. The gap task 6.2
   describes is real and precisely located. Also confirmed `AuthoringTelemetry.emitGenerated`
   (`AuthoringTelemetry.scala:43-65`) does include `"authoringRequestId" -> authoringRequestId` in
   its emitted fields, and `succeedWithTelemetry`/`succeedStreamEvent` mint exactly one
   `authoringRequestId` and reuse it for both the telemetry call and the constructed response/SSE
   event (`DashboardAuthoringService.scala:291-306`) — so the correlation the new assertion checks
   is already true in shipped behavior; task 6.2 is a test-coverage addition, not a behavior
   change, correctly leaving `design.md` untouched.

5. **Softened line-count language**: `ticket.md`/`proposal.md` now read "closer to (not reliably
   under...)" instead of "back under." Sanity-checked the arithmetic: `wc -l` shows 438 current
   lines; removing the 4 named helpers (~18-21 lines including blank lines, excluding
   `totalTokensOf` which is not moved) lands around 417-420 — consistent with the stated "~415-420"
   and still over CONTRIBUTING.md's actual stated threshold (`CONTRIBUTING.md:24`: "~400 lines...
   propose a split," confirmed informational-only at `CONTRIBUTING.md:123`). Not an overstated
   claim.

6. **AC/task consistency**: `ticket.md`'s AC list — items 8 and 9 (`grep -n "^- \["`) are exactly
   the two fold-in ACs tasks.md 6.1/6.2 target (`AC8`/`AC9` references in tasks.md line up with
   the literal 8th/9th checkbox). Cross-checked both fold-in items against `evaluation-1.md`'s
   actual "Non-blocking Suggestions" section (lines 225-243) — transcribed faithfully, no scope
   drift beyond what was triaged (both are literally the two listed suggestions, nothing added).

7. **`openspec change validate authoring-error-telemetry --strict`** — clean ("Change
   'authoring-error-telemetry' is valid").

8. `private[services]` precedent round 1 cited as the rejected alternative — spot-checked and
   confirmed real (`AlertEvaluationService.scala:39/56/65`, `DashboardAuthoringParsing.scala:35`,
   `PanelService.scala:199/251`).

### A gap the revision still leaves implicit (not blocking — see reasoning)

All 4 helpers, as they exist today, also reference `claudeClient.modelId`
(`DashboardAuthoringService.scala:287,293,298,304`) — `claudeClient` is a plain constructor
parameter of `DashboardAuthoringService` (no `val`), so it is *not* accessible from a sibling
object outside the class, exactly the same category of "instance state becomes unreachable once
the function leaves the class" problem round 1 caught for `AttemptOutcome`. tasks.md 6.1's
revision addresses the `AttemptOutcome` parameter but is silent on `modelId`; read completely
literally, the described signature (`proposal`/`warnings`/`tokens` + the pre-existing
`err`/`goal`/`mdcSnapshot` params) would still fail to compile on `claudeClient.modelId` being
out of scope.

I am **not** treating this as blocking, for a materially different reason than round 1's finding:
unlike the `AttemptOutcome` case (which had ≥3 legitimately different "behavior-preserving"
resolutions — widen visibility, restructure params, or leave two helpers inline — an actual design
fork worth a gate decision), there is exactly one sane fix here (thread `modelId: String` as an
explicit parameter), and the convention is already established at the call site one layer down:
`AuthoringTelemetry.emitGenerated`/`emitFailed` (the functions these helpers call into) already
declare `modelId: String` as a plain parameter. Any implementer hitting `not found: value
claudeClient` at `sbt compile` has one obvious mechanical fix to make, not a judgment call. This
doesn't rise to "materially ambiguous" — the standard this round's brief asks me to check against
— so I'm surfacing it as a heads-up rather than a Change Request that would force a third
round-trip over something with zero design ambiguity.

### Verdict: CONFIRM

Round 1's actual blocking finding (a real compile-time defect from a private-type parameter) is
now correctly and precisely resolved, grounded in the real field names/types/usages of the real
source file, and matches round 1's own stated preferred resolution. Task 6.2 is precise, grounded
in the real test file, and correctly requires no design.md change (verified the correlation it
tests is already true in shipped code). ticket.md/proposal.md/tasks.md §6 are internally
consistent with each other and with evaluation-1.md's actual triaged suggestions — no scope drift,
no placeholders, no missing contract updates (none are needed — no wire-shape change in this
fold-in). `openspec change validate --strict` is clean.

### Non-blocking notes

- See "A gap the revision still leaves implicit" above: tasks.md 6.1 doesn't mention that
  `claudeClient.modelId` also needs to be threaded as an explicit parameter into the moved
  helpers (mirroring the `modelId: String` parameter `AuthoringTelemetry.emitGenerated`/`emitFailed`
  already take). Worth a one-line addition to 6.1 so the executor doesn't have to rediscover this
  at `sbt compile` time, but not a blocking ambiguity — there is exactly one obvious fix.
- Same note applies mechanically to `AuthoringTelemetry.emitGenerated`/`emitFailed`'s
  `(implicit ec: ExecutionContextExecutor)` parameter — the moved helpers will need to declare it
  too (or otherwise have it in scope) for those calls to resolve; trivial if the sibling object's
  functions carry the same implicit parameter, which Scala will then thread automatically from
  `DashboardAuthoringService`'s own class-level implicit `ec` at each call site.
