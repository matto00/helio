## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
(`specs/alert-evaluation-engine/spec.md`, `specs/alert-event-persistence/spec.md`), and
`skeptic-design-1.md`/`skeptic-design-2.md` (as claims to verify, not fact) in full, cold.

**Round-2 item (numeric coercion policy divergence) — independently verified fixed, and durably
so.**

- Read `PipelineRunService.scala:382-388` (`inferFieldType`) myself: `Boolean → "boolean"`,
  `Int|Long → "integer"`, whole-number `Double → "integer"`, `Float|Double → "double"`, and the
  catch-all `case _ => "string"` — confirmed every `String`, numeric-looking or not, falls to
  `"string"`, never a numeric type. Matches `design.md:44-45`'s claim exactly, including the exact
  line numbers cited (382-388, re-grepped: `def inferFieldType` is at line 382).
- Read `PipelineRowJson.scala:64-73` (`toDouble`) myself: `case s: String => s.toDoubleOption` —
  confirmed it *does* coerce numeric-looking strings (e.g. `"42"` → `Some(42.0)`), unlike
  `inferFieldType`. Line numbers cited in `design.md:46` (`PipelineRowJson.scala:64-73`) are exact
  (`def toDouble` is at line 64).
- `design.md:41-60` ("Numeric coercion policy") now explicitly: (a) quotes the ticket's literal
  clause (`ticket.md:18`), (b) states the measured difference between `inferFieldType` and
  `toDouble` with the checked line numbers, (c) commits to a dedicated `numericValue(v: Any):
  Option[Double]` helper — `Int`/`Long`/`Float`/`Double`/`BigDecimal → Some`, everything else
  (including every `String`) `→ None` — explicitly *not* `toDouble`, (d) states the rationale
  (ticket names `inferFieldType` explicitly; this codebase has documented un-cast-CSV-string
  pipeline output as a real, reachable case), and (e) states the consequence plainly (an alert on
  an un-cast string column never fires until a `cast` step runs — intentional, not a gap).
- `specs/alert-evaluation-engine/spec.md:27-38` (Metric extraction requirement) now states the
  `inferFieldType`-consistent policy explicitly, and adds **both** requested scenarios:
  - Scalar path: "Single-row scalar extraction skips a numeric-looking string, not coerced"
    (`spec.md:53-58`) — `errorCount = "12"` (String) → no value extracted, rule skipped, `"12"`
    never parsed to `12`.
  - Aggregate path: "Column-aggregate extraction skips a numeric-looking string in one row"
    (`spec.md:65-69`) — `amount` values `10, "20", 5` → extracted value `15` (the `"20"` string row
    skipped entirely, not coerced and not treated as `0`).
  Both scenarios are new since round 2's report (round 2 confirmed only the non-numeric-string
  `"n/a"` aggregate scenario existed; the numeric-looking-string case was the gap). Both are now
  present and pin the intended behavior unambiguously in both paths, as round 2's Change Request
  demanded.
- `tasks.md:14-20` (task 2.2) and `tasks.md:49-52` (task 4.2) both explicitly reference the
  `numericValue` helper (not `toDouble`), state it is "deliberately NOT `PipelineRowJson.toDouble`,
  which would parse numeric-looking strings," and task 4.2 explicitly lists "a numeric-looking
  `String` skipped/not-coerced in both the single-row scalar and multi-row aggregate paths" as a
  required test case.
- `design.md`'s Planner Notes (`design.md:164-169`) and Risks (`design.md:136-143`) both
  additionally acknowledge this is a deliberate, ticket-literal choice with a stated discoverability
  trade-off, not a silently-introduced gap.

This closes round 2's Change Request completely: the policy is explicit, justified, matches
`ticket.md:18`'s literal instruction, matches the actual `inferFieldType` behavior I independently
verified in code, and is pinned by scenarios in both the scalar and aggregate paths, referenced
from the corresponding test tasks.

**Round-1 items (lte comparator math; resolveInternal/Snoozed contradiction) — reconfirmed still
fixed, no regression.**
- `specs/alert-evaluation-engine/spec.md:80-83` ("Comparator matrix"): value `10`, threshold `10`
  → breaches for `gte`, `eq`, `lte` (all true at equality) — `10 <= 10` is `true`, mathematically
  correct.
- `AlertEventRepository.scala:121-124` (`findActiveByRule`, `state =!= "resolved"`, matches
  `firing`/`acknowledged`/`snoozed`) and `AlertEventStateMachine.scala:33-97` (confirmed `Resolve`
  legal only from `Firing`/`Acknowledged`, the `Snoozed` case falls to the `case (state, _) =>
  Left(Conflict)` catch-all — read the actual match arms, lines 33-56 shown, snoozed→resolve is
  absent from the legal-edges list) both still match `design.md:75-93`'s explicit three-way branch
  (`Firing`/`Acknowledged` → transition+persist, `Snoozed` → no-op/`None`, no active event →
  no-op/`None`), and `specs/alert-event-persistence/spec.md:3-31` and `tasks.md:3-8`/`46-48` are
  still consistent with both the design and the actual code.

**Predecessor-code claims (HEL-447/HEL-455) re-verified against on-disk source:**
- `AlertRuleRepository.scala:108-112` — `listEnabledByDataTypeInternal` exists exactly as
  described (`withSystemContext`, filters `targetDataTypeId` + `enabled === true`).
- `AlertEventRepository.scala:121-124` (`findActiveByRule`), `:137-178` (`upsertFiringInternal`,
  ReFire-on-existing / insert-firing-on-none, `IllegalStateException` guard on unreachable transition
  failure), `:185-191` (private `updateAction`, the shared persistence helper `resolveInternal` will
  also use per design) — all match design's description.
- `model.scala:412-458` — `Comparator` (`Gt/Gte/Lt/Lte/Eq/Neq`, `fromString: Either[String,
  Comparator]`) and `AlertRule` (`ownerId`, `targetDataTypeId`, `metric: String`, `condition:
  JsValue`, `severity: Severity`) match design/spec text exactly.
- `AlertRuleService.scala:134-150` (`validateCondition`) confirms `condition.comparator`/
  `condition.threshold` are the real JSON keys, matching design/spec.
- `AlertEventService.scala:41-47` — the existing user-facing `resolve(id: AlertEventId, user:
  AuthenticatedUser)` requires an `AuthenticatedUser` and keys by `AlertEventId`, confirming the
  new privileged `resolveInternal(ruleId: AlertRuleId)` (no user, keyed by rule) is genuinely a new,
  non-redundant method needed for this background path — not a duplicate of existing capability.
- `PipelineRunService.scala:304` (exact) — `onRunSuccess`; `:42-53` — nullable-default constructor
  params including `binaryRefRepo: BinaryRefRepository = null`; `:313-337` — all step `Future`s
  (`schemaUpsert`, `rowsUpsert`, `binaryRefsUpsert`, `updateMeta`, `updateRun`) are created as
  eagerly-evaluated `val`s *before* the `for`-comprehension, confirming (as round 2 concluded) that
  the planned evaluation hook genuinely runs concurrently with `updateMeta`/`updateRun`'s underlying
  work regardless of its position in the `for`'s bind chain — not a new issue.
- `Main.scala:63,130` and `ApiRoutes.scala:16,77-82,136-140` — confirmed the wiring gap is real and
  unchanged: `Main.scala` constructs `alertRuleRepo` but never `alertEventRepo`, and its
  `ApiRoutes(...)` call passes only `alertRuleRepo`; `ApiRoutes`'s `alertEventRepo` param still
  defaults to `null`. Fixing this in-scope remains justified and unchanged from round 2.
- `V61__alert_events.sql` — table/RLS/index shape matches design's assumptions (no schema change
  needed for this ticket); no unique constraint enforces single-active-event-per-rule at the DB
  level (app-level dedup only, via `findActiveByRule` read-then-write), which is a pre-existing
  HEL-455 characteristic already accepted in the Risks section, not a new gap.

**Full adversarial pass (round 3, not limited to prior items):**
- Grepped `TODO`/`TBD`/`figure out`/`placeholder` across `design.md`, `proposal.md`, `tasks.md`,
  and both spec deltas — zero genuine hits (only matches are inside the skeptic report files
  themselves, which are expected).
- Traced all five ticket acceptance criteria (`ticket.md:25-29`) to specific tasks: dedup/resolve →
  `tasks.md` 4.4; failed-run-no-events + eval-exception-isolation → 4.6/4.5; scalar+aggregate ×
  six comparators → 4.3; "evaluation runs against exact rows just written, no stale re-read" →
  structurally guaranteed by `AlertEvaluationService`'s constructor taking only
  `AlertRuleRepository`+`AlertEventRepository` (task 2.1, no `DataTypeRowRepository` — it has no way
  to re-query even if it wanted to) plus `onRunSuccess` passing `resultRows` directly (task 3.1);
  `sbt test` green → 4.7. No AC left untraced.
- No scope drift found: the only work outside the ticket's literal text (`Main.scala`/`ApiRoutes`
  wiring fix) is explicitly flagged, justified, and scoped to the minimum needed for this ticket's
  own runtime to function in production — consistent across `proposal.md` Impact,
  `design.md` Risks/Planner Notes, and `tasks.md` 3.2/3.3.
- No missing contract updates: no schema change is needed (V60/V61 already exist) and this is a
  backend-only change with no `frontend/` impact, so `DESIGN.md` is not binding here.
- Checked for ambiguity in task 2.5 ("on successfully-extracted non-breach with an active event:
  call resolveInternal") against `resolveInternal`'s own internal no-active-event no-op — confirmed
  non-contradictory: calling `resolveInternal` unconditionally on any non-breach is safe because the
  method already handles "no active event" internally (returns `None`, no write) per its own spec;
  the task wording is just descriptive of the common case, not a precondition the caller must
  itself check.

### Verdict: CONFIRM

Round 1's two defects and round 2's one defect are all durably fixed with no regressions. The
round-2 numeric-coercion gap is now closed completely: the policy is explicit, justified against
the ticket's literal text, matches the actual `inferFieldType`/`toDouble` behavior I verified
independently in code, and is pinned by scenarios in both the single-row scalar and multi-row
aggregate paths, referenced from the corresponding test tasks (2.2, 4.2). A full adversarial pass
found no new placeholders, contradictions, ambiguity, scope drift, or missing contract updates.
The design is sound enough to implement.

### Non-blocking notes

- None new this round. Round 2's two non-blocking notes (scalar-path missing-field wording, and the
  `onRunSuccess` hook-placement phrasing) are both now effectively addressed: `design.md:63-65`
  explicitly states "`None` (missing field, or a non-numeric-typed value...) means no value to
  extract, and the rule is skipped," and the hook-placement concurrency question was already
  correctly resolved as a non-issue in round 2's own analysis (eager `val` creation means all steps
  run concurrently regardless of `for`-comprehension bind order).
