## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/alert-evaluation-engine/spec.md`, `specs/alert-event-persistence/spec.md`) in full.
- Verified every predecessor-code claim against the actual on-disk files (not the plan's
  narrative):
  - `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala` —
    `findActiveByRule` (line 121-124, filters `state =!= "resolved"`) and
    `upsertFiringInternal` (line 137-180) exist exactly as described; both are
    `withSystemContext`/privileged with doc comments explicitly reserved for this ticket.
  - `backend/src/main/scala/com/helio/infrastructure/AlertRuleRepository.scala` —
    `listEnabledByDataTypeInternal` (line 108-111) exists exactly as described.
  - `backend/src/main/scala/com/helio/domain/AlertEventStateMachine.scala` — confirmed the
    legal-edge table matches the design's description: `Resolve` legal only from `Firing`
    (line 43-44) and `Acknowledged` (line 46-47); every other `(state, action)` pair falls
    through to the `Left(Conflict)` catch-all (line 95-96) — **including `(Snoozed, Resolve)`,
    which is not special-cased anywhere in the state machine.**
  - `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala` — `type Row = Map[String,
    Any]` (line 16) and `toDouble(v: Any): Option[Double]` (line 64-73, string coercion via
    `s.toDoubleOption`) confirm the design's "no JsValue round-trip needed" claim.
  - `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — `onRunSuccess`
    begins at line 304 (design.md's cited line number is exact); the `recoverWith { case _ =>
    Future.successful(()) }` discipline the design cites appears at lines 239 and 299 as
    claimed; `binaryRefRepo`'s null-checked, independent-`Future`-inside-the-`for` pattern
    (lines 327-330, 336-342) is the exact shape the design proposes mirroring for
    `alertEvaluationService`.
  - `backend/src/main/scala/com/helio/app/Main.scala` (lines 48-131) and
    `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (lines 24-140) — confirmed the
    "Gap found during planning" claim is real: `Main.scala` constructs `alertRuleRepo` (line
    63) but never constructs an `AlertEventRepository`, and its `ApiRoutes(...)` call (lines
    105-131) passes only `alertRuleRepo = alertRuleRepo`, leaving `ApiRoutes`'s
    `alertEventRepo: AlertEventRepository = null` param (line 82) at its default. `/api/alerts`
    and this ticket's evaluation engine are indeed unreachable in production today. Fixing
    this in-scope is justified.
  - `backend/src/main/scala/com/helio/domain/model.scala` — `Comparator` (line 412-439,
    `fromString`/`asString` for `gt/gte/lt/lte/eq/neq`), `Severity`, `AlertRule`, `AlertEvent`,
    `AlertEventAction` (including `ReFire`) all match the design's descriptions.
- Cross-checked every ticket acceptance criterion against `tasks.md`'s task list — all five
  ACs trace to a specific task (1.1/2.x for the evaluation+resolve mechanics, 3.1-3.3 for the
  hook and wiring fix, 4.1-4.7 for tests). No AC is left uncovered by any task, and no task
  goes meaningfully beyond the ticket's stated scope (the `Main.scala`/`ApiRoutes` wiring fix
  is explicitly justified and non-behavior-changing elsewhere, per design.md's Risks section).
- No `TODO`/`TBD`/hand-waved decisions found in `design.md`'s Decisions section — every
  parameter shape, extraction rule, and wiring change is concretely specified with a rationale.

### Verdict: REFUTE

Two concrete, self-contradictory or mathematically wrong specifications were found. Both are
cheap to fix now and expensive to discover after an evaluator scores a test suite written
against them.

### Change Requests

1. **Comparator-matrix scenario is mathematically wrong for `lte`** —
   `openspec/changes/alert-evaluation-engine/specs/alert-evaluation-engine/spec.md:63-66`
   (the "Comparator matrix" scenario under "Threshold comparator evaluation"). With extracted
   value `10` and `threshold = 10`, the scenario states the rule "does not breach for `c = gt`,
   `c = lt`, `c = lte`, or `c = neq`". But `lte` means `value <= threshold`, and `10 <= 10` is
   `true` — the rule **should** breach for `lte` at equality, exactly as it does for `gte` and
   `eq`. Only `gt`, `lt`, and `neq` should be non-breaching at `value == threshold`. As written,
   this scenario is the literal spec that `tasks.md:44` ("comparator matrix (all six
   comparators)") and test task `4.3` would be implemented and tested against — an
   implementer following it faithfully would ship (and test-lock) a broken `lte` comparator
   that never fires when the metric exactly equals the threshold, a real functional defect in
   the one baseline condition kind this ticket ships. Fix the scenario text to state the rule
   breaches for `gte`, `eq`, **and `lte`**, and does not breach for `gt`, `lt`, `neq`.

2. **`resolveInternal`'s behavior for an active `Snoozed` event is undefined and contradicts
   both the state machine and the repository's own read predicate** —
   `openspec/changes/alert-evaluation-engine/design.md:59-64` (the "Auto-resolve on clear"
   Decision) and `openspec/changes/alert-evaluation-engine/specs/alert-event-persistence/spec.md:3-10`
   (the "Privileged internal resolve" requirement) and `tasks.md:3-5` (task 1.1). The design
   text asserts `Snoozed` events are "filtered out by `findActiveByRule`'s `state !=
   'resolved'` predicate" — this is factually false against the actual code
   (`AlertEventRepository.scala:123`: `r.state =!= "resolved"` matches `firing`,
   `acknowledged`, **and** `snoozed` rows; only `resolved` is excluded). The design separately
   states the *intent* that a snoozed event should be "intentionally left firing/snoozed... never
   force-resolved by the engine" — but neither the spec requirement's literal text nor task 1.1
   special-cases `Snoozed` at all: both simply say "look up the active event via
   `findActiveByRule`; if found, route through `transition(existing, Resolve)`... persist... return
   `Some(resolved)`." Per `AlertEventStateMachine.scala:89-97`, `(Snoozed, Resolve)` is not a
   legal edge — `transition` returns `Left(Conflict)` for it, which the spec's literal
   "persist... return `Some(resolved)`" text does not account for. Test task `4.1` only lists
   "active firing resolves, active acknowledged resolves, no active event is a no-op" — there is
   no test case, and no defined behavior, for "active event is snoozed." This is a genuinely
   reachable path (a user snoozes an alert; the next run's condition clears while it is still
   snoozed) that the design's own stated intent says should be a no-op, but the literal spec as
   written would either throw/log an "unreachable" exception on every such evaluation (if the
   implementer copies `upsertFiringInternal`'s `DBIO.failed(IllegalStateException(...))` pattern
   for the `Left` branch, mislabeling a genuinely reachable case as unreachable) or silently
   swallow a real state-machine rejection with no defined return value. Resolve before
   implementation: either (a) have `resolveInternal` check `existing.state` and no-op
   (return `None` or `Some(existing)` — pick one, define it) when the active event is `Snoozed`,
   or (b) have `AlertEvaluationService` skip calling `resolveInternal` when the active event's
   state is `Snoozed`. Update the spec requirement text, `design.md`'s Decision, and add an
   explicit `Snoozed` scenario to both `specs/alert-event-persistence/spec.md` and task `4.1`.

### Non-blocking notes

- The design's "Sum (not average)" choice for column-aggregate metrics is well-reasoned and
  explicitly scoped as a self-approved baseline decision — no objection.
- The zero-rows-skip policy for non-`"*"` metrics is sound and explicitly distinguished from
  missing-data detection (correctly deferred out of scope).
- `Comparator.fromString` returns `Either[String, Comparator]` (not `Option`) —
  `design.md`/`tasks.md` say "reusing `Comparator.fromString`" without specifying the `Left`
  (malformed condition) handling path explicitly, but this is adequately covered by the
  generic per-rule `recover { case NonFatal(e) => ... }` isolation described in
  `design.md:65-72` and exercised by test task `4.5` — not a blocking gap, just flagging that
  a malformed `comparator` string is expected to surface as a caught exception at that layer.
