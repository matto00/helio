## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/alert-evaluation-engine/spec.md`, `specs/alert-event-persistence/spec.md`), and
  `skeptic-design-1.md` (as a claim to verify, not fact) in full.

**Round-1 item 1 (lte comparator math) — independently verified fixed.**
`specs/alert-evaluation-engine/spec.md:63-66` ("Comparator matrix" scenario) now reads: value
`10`, threshold `10` → breaches for `gte`, `eq`, **and `lte`** (all true at equality); does not
breach for `gt`, `lt`, `neq`. I checked the math myself: `10 <= 10` is `true`, so `lte` must
breach at equality — this is now mathematically correct. `design.md` does not restate the matrix
(it lives only in the spec delta), so there is no place left where the old wrong text could
resurface.

**Round-1 item 2 (resolveInternal vs. Snoozed) — independently verified fixed and consistent.**
Read the actual code, not the artifacts' narrative:
- `backend/src/main/scala/com/helio/infrastructure/AlertEventRepository.scala:121-124` —
  `findActiveByRule`'s predicate is `r.state =!= "resolved"`, confirmed to match `firing`,
  `acknowledged`, **and** `snoozed` rows (only `resolved` excluded). Matches round 1's finding.
- `backend/src/main/scala/com/helio/domain/AlertEventStateMachine.scala:33-97` — confirmed
  `Resolve` is legal only from `(Firing, Resolve)` (line 43-44) and `(Acknowledged, Resolve)`
  (line 46-47); `(Snoozed, Resolve)` falls through to the `case (state, _) => Left(Conflict)`
  catch-all (line 95-96), exactly as round 1 found — `resolveInternal` cannot blindly call
  `transition` on every active row.
- `design.md:52-74` ("Auto-resolve on clear") now explicitly branches: `Firing`/`Acknowledged` →
  route through `transition(..., Resolve)`, persist, `Some(resolved)`; `Snoozed` → explicit no-op,
  `None`, no write, with a stated rationale (don't defeat a user's snooze). No active event → `None`,
  no write.
- `specs/alert-event-persistence/spec.md:3-31` — the "Privileged internal resolve" requirement
  text and its four scenarios (firing resolves, acknowledged resolves, **snoozed left untouched /
  returns `None`**, no active event no-op) now match `design.md` exactly and match the actual
  state-machine legality I verified in code.
- `tasks.md:3-8` (task 1.1) explicitly says "`snoozed` → do NOT call `transition` (illegal from
  `Snoozed`); leave the row unmodified, return `None`" and `tasks.md:42-44` (task 4.1) lists a
  dedicated "active snoozed is left untouched and returns `None` (no illegal transition attempted)"
  test case.

All three artifacts (design.md, both spec deltas, tasks.md) are now internally consistent with
each other and with the actual `AlertEventStateMachine`/`AlertEventRepository` code on disk.
Round-1 items 1 and 2 are both correctly and durably fixed — no regressions, no partial fixes.

**Predecessor-code claims re-verified against on-disk source (not narrative):**
- `backend/src/main/scala/com/helio/infrastructure/AlertRuleRepository.scala:108` —
  `listEnabledByDataTypeInternal` exists as described.
- `backend/src/main/scala/com/helio/domain/model.scala:412-439` — `Comparator` (`gt/gte/lt/lte/
  eq/neq`, `fromString`/`asString`) matches design's description exactly; `AlertRule` (line
  442-452) has `ownerId`, `targetDataTypeId`, `metric`, `condition`, `severity` as claimed.
- `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:16` (`type Row = Map[String,
  Any]`) and `:64-73` (`toDouble(v: Any): Option[Double]`, with `case s: String =>
  s.toDoubleOption`) confirm the "no JsValue round-trip" claim — and also confirm `toDouble`
  coerces numeric-looking **strings**, not just native numeric types (see Change Request below).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — `onRunSuccess` at line
  304 (exact); `recoverWith { case _ => Future.successful(()) }` at lines 239 and 299 (exact,
  re-grepped both line numbers); `binaryRefRepo`'s nullable-param/independent-`Future` pattern at
  lines 42-52/327-330 is the exact shape being mirrored.
- `backend/src/main/scala/com/helio/app/Main.scala:63,105-131` and
  `backend/src/main/scala/com/helio/api/ApiRoutes.scala:77-140` — confirmed the wiring gap is
  still present exactly as described (this is expected — it's pre-implementation; `Main.scala`
  constructs `alertRuleRepo` but not `alertEventRepo`, and its `ApiRoutes(...)` call still omits
  `alertEventRepo`). Fixing this in-scope remains justified.
- `backend/src/main/scala/com/helio/services/AlertRuleService.scala:138-154` —
  `validateCondition` confirms `condition.comparator`/`condition.threshold` are the real JSON
  keys the evaluation engine will read, matching design/spec text.

Cross-checked every ticket acceptance criterion against `tasks.md` again — all five ACs still
trace to a specific task. No `TODO`/`TBD`/hand-waved decisions found (grep for
TODO/TBD/placeholder/figure-out across design/proposal/tasks/specs returned no genuine hits).

### Verdict: REFUTE

Both round-1 defects are correctly and durably fixed. A full adversarial pass, however, surfaced
one new, previously-undiscussed contract ambiguity in the metric-extraction Decision that the
ticket explicitly calls out but the design silently overrides without acknowledgment — cheap to
close now, before an implementer or test-writer has to guess at it.

### Change Requests

1. **Metric-extraction numeric coercion silently diverges from the ticket's explicit
   "consistent with `inferFieldType`" clause, and the divergence is never acknowledged or
   justified anywhere in `design.md`/spec deltas/`tasks.md`.**
   `openspec/changes/alert-evaluation-engine/ticket.md:18` states: "Baseline condition: threshold
   comparators `gt|gte|lt|lte|eq|neq` vs `threshold`. Numeric coercion consistent with
   `inferFieldType` in `PipelineRunService`." I checked `inferFieldType`
   (`backend/src/main/scala/com/helio/services/PipelineRunService.scala:382-388`): it maps
   `Boolean → "boolean"`, `Int|Long → "integer"`, whole-number `Double → "integer"`,
   `Float|Double → "double"`, and **everything else (including every `String`, numeric-looking or
   not) → `"string"`** — i.e. `inferFieldType`'s notion of "numeric" never includes `String`
   values, full stop.

   `design.md:40-51` ("Metric extraction" Decision) instead specifies coercion via
   `PipelineRowJson.toDouble`, which I also checked
   (`backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:64-73`): its `String` case is
   `case s: String => s.toDoubleOption` — it **does** treat a numeric-looking string (e.g.
   `"42"`) as a valid numeric value, unlike `inferFieldType`. This is a real, reachable divergence
   in this codebase: this project's own history has un-cast CSV pipeline output landing as
   string-typed row values (a documented gotcha), so a rule's `metric` field genuinely can be a
   string like `"42"` in a real row set.

   Nowhere in `design.md`, either spec delta, or `tasks.md` is `inferFieldType` mentioned, or is
   this divergence from the ticket's literal text acknowledged, discussed, or justified. This
   means an implementer following `design.md`'s "Decisions" section will ship a coercion policy
   that is measurably different from what `ticket.md` explicitly asked for — a numeric-looking
   string will breach or clear a threshold under the design's `toDouble` policy, but would never
   have counted as numeric under `inferFieldType`'s policy. Neither the "Comparator matrix" test
   scenario (spec.md:63-66) nor test task `4.2`/`4.3` (`tasks.md:45-49`) pins down which policy is
   intended for the *scalar* (single-row) case — the only string-coercion scenario that exists
   (`spec.md:49-52`, "Column-aggregate extraction sums numeric values, skipping non-numeric") only
   demonstrates that a **non**-numeric string (`"n/a"`) is skipped; it never demonstrates whether
   a numeric-looking string (`"42"`) is coerced or skipped, in either the scalar or aggregate
   path.

   Resolve before implementation: either (a) `design.md`'s Metric extraction Decision explicitly
   states that it is intentionally deviating from the ticket's `inferFieldType`-consistency clause
   in favor of reusing `PipelineRowJson.toDouble`'s more permissive string-coercion behavior, with
   a one-line rationale (e.g. "reuses the codebase's one established numeric-coercion primitive
   rather than reusing a type-*labeling* function that has no coercion semantics of its own"), or
   (b) the design is changed to reject/skip string-typed metric values to match `inferFieldType`'s
   stricter policy. Whichever is chosen, add one scenario to
   `specs/alert-evaluation-engine/spec.md` (alongside the existing "Column-aggregate extraction...
   skipping non-numeric" scenario) that pins down the intended behavior for a numeric-looking
   string value (e.g. `metric = "amount"`, single row, `amount = "42"` → extracted value `42` or
   the rule is skipped — pick one and state it), and reference it from test task `4.2` so the
   evaluator has something concrete to check the implementation against.

### Non-blocking notes

- Related to Change Request 1 but lower severity, not blocking: neither `design.md` nor
  `specs/alert-evaluation-engine/spec.md` states what happens when the **single-row scalar** path
  (`rows.size == 1`) encounters a metric field that is missing from the row or whose value
  `PipelineRowJson.toDouble` returns `None` for (vs. the aggregate path, which has an explicit
  "skip non-numeric" scenario, and the zero-rows path, which has an explicit "skip the rule"
  scenario). In practice this is likely covered by the generic per-rule
  `recover { case NonFatal(e) => log.error(...); () }` isolation `design.md:75-82` already
  describes ("a coercion failure logs and is skipped") — so it is not undefined, just
  under-specified as its own scenario, and the resulting behavior (an ERROR-level log per missing
  field, rather than a silent skip like the zero-rows case) may be noisier than intended. Worth a
  one-line scenario addition alongside the fix for Change Request 1, but not blocking on its own.
- `Comparator.fromString` returning `Either[String, Comparator]` (not `Option`) is still not
  explicitly addressed in `design.md`/`tasks.md`'s prose beyond the generic per-rule `recover`
  discipline — reconfirmed this is adequately covered (same as round 1's note), not a new issue.
- The `onRunSuccess` hook-placement wording ("after `rowsUpsert` inside the for-comprehension,
  added as one more independent `Future`... does not gate `updateMeta`/`updateRun`... runs
  concurrently") is slightly imprecise phrasing — the vals in `onRunSuccess` are all created
  eagerly before the `for`-comprehension (Scala `Future`s start on creation), so "after
  `rowsUpsert`" describes source-code position, not execution ordering; execution is genuinely
  concurrent with `binaryRefsUpsert`, matching the existing pattern exactly. Functionally correct
  (the AC "evaluation runs against the exact rows just written" is satisfied because
  `resultRows`/`jsRows` are captured in memory before any of these `Future`s are created, not
  because of temporal ordering vs. the DB write) — flagging only as an imprecise-wording nit, not
  a defect.
