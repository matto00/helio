## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 blocker ("deprecated" contradiction) is genuinely resolved.**
   `grep -rn "deprecated" openspec/changes/panel-metric-binding/` now returns only two hits: `proposal.md:15-16`
   and `skeptic-design-1.md` (the prior round's own report, historical, not an operative artifact). `proposal.md`
   now reads: *"(A metric's `deprecated` flag is not checked here — out of scope per the ticket's literal AC,
   which names only ownership + V41; `MetricDefinition.deprecated` has no consumer anywhere yet.)"* — this
   matches `design.md` D5's algorithm (`None → 400; Some(m) → re-validate m.dataTypeId against V41` — no
   deprecated branch), `tasks.md` 4.2/T.2 (same two checks, no deprecated case), and
   `specs/panel-datatype-binding/spec.md`'s "create/update reject an unresolvable or non-pipeline-output
   metricId" requirement (three scenarios: foreign, nonexistent, re-bind-to-foreign — no deprecated scenario).
   All four artifacts now agree: `deprecated` is explicitly out of scope, stated once, contradicted nowhere.

2. **Ticket AC traceability re-checked against the now-current proposal.md.** Ticket AC3 ("A `metricId`
   referencing a non-owned or non-existent metric is rejected...") does not mention `deprecated` at all — the
   ticket's literal AC set supports proposal.md's "out of scope per the ticket's literal AC" framing; this
   isn't a scope-narrowing that contradicts the ticket, it's a correct reading of it.

3. **The two round-1 non-blocking tightenings verified as actually applied, not just claimed:**
   - `tasks.md` 4.3 now says "This touches every `new PanelService(...)` call site — expect ~10
     (`ApiRoutes.scala` plus test specs including `BoundPanelRoutesSpec`, `PanelServiceResolveBindingsSpec`,
     `PanelServiceScatterAggregationSpec`, `PanelServiceCompanionBindingGuardSpec`,
     `PanelServiceBuildAllForCreateSpec`, `PanelServiceBatchUpdateErrorSpec`) — mechanical, but budget for
     it" — matches round 1's finding, no longer undersold.
   - `design.md` D5 now says "follows `PanelService.rejectCompanionBinding`'s error style (400 `BadRequest`,
     not `MetricService`'s 422), but not its pass-through-on-unresolved behavior — where `rejectCompanionBinding`
     lets a foreign/nonexistent `dataTypeId` pass through unchanged (deferred to read-time clearing), AC3
     requires a foreign/nonexistent `metricId` to be actively **rejected**... so the new helper's control flow
     is the opposite for that case." I independently read `PanelService.scala:418-430`
     (`rejectCompanionBinding`) and confirmed this framing is now accurate: `case _ => Right(())` on the
     `dataTypeRepo.findByIdOwned` miss (i.e. it genuinely lets a foreign/nonexistent `dataTypeId` pass through
     unrejected) — the corrected sentence is a precise, not hand-wavy, description of the real divergence.
     I also confirmed `MetricService.scala` genuinely uses `ServiceError.UnprocessableEntity` (422) for its
     own `dataTypeId`/V41 validation (`MetricService.scala:68,119`), matching the "not `MetricService`'s 422"
     clause.

4. **Fresh independent ground-truth pass (not reproducing round 1's checks verbatim, but re-deriving the
   load-bearing claims from the current code):**
   - `MetricPanelConfig` (`backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`) is exactly
     `jsonFormat5` today with `decode`/`decodeCreate` matching the tolerant-decode pattern design.md/tasks.md
     describe extending — confirmed by direct read, not by trusting the design doc's paraphrase.
   - `PanelRepository.configColumnsOf`/`configColumnValuesOf` are genuinely 19-arity tuples right now
     (counted directly at `PanelRepository.scala:242-286`) — D2/tasks.md 1.3's "grow from 19 to 20, still
     under 22" claim holds.
   - `PanelRoutes.scala:71-79`: `GET /api/panels/:id/query` calls `panelService.findById` then
     `panel.buildQuery` directly with no `resolveSingleBinding`/cross-user-clearing step today — confirms
     tasks.md 5.3's flagged gap is real and the fix is necessary, not invented busywork.
   - `MetricDefinition`/`MetricFormat`/`MetricId` (`domain/model.scala:802-846`) have exactly the fields
     D4's materialization formula reads (`dataTypeId`, `measureField`, `aggregation: String`,
     `format.unit: Option[String]`), and `MetricAggregation.values` genuinely includes `"countDistinct"`
     (`model.scala:820`) — the D4 "frontend `agg` enum gap, pre-existing, not introduced here" claim is
     accurate, not a rationalization.
   - `DataTypeRepository.findByIdsOwned` exists with the batch/owner-filter/empty-short-circuit shape
     `MetricRepository.findByIdsOwned` (new, per D3/5.1) is asked to mirror; `MetricRepository` has no such
     method today — the new-method claim is accurate.
   - Latest Flyway migration on disk is `V75__metrics.sql` (`ls backend/.../db/migration | sort | tail`),
     confirming V76 is still free at this review's time — D2/1.1's "verify, don't assume" caveat remains
     correctly hedged (not stale).
   - No other new contradiction found across proposal/design/tasks/both spec deltas: precedence rule
     (`metricId` authoritative default, raw fields override, not mutually exclusive) is stated identically
     in proposal.md, design.md D4/D5, and the spec delta's dedicated requirement + two scenarios. Chart/Table
     materialization scope-narrowing (D4) is consistently flagged in proposal.md's Non-goals, design.md, and
     the spec delta's final scenario ("Chart panel with metricId set does not materialize a field mapping").
     No placeholders/TODOs/TBDs found in any of the six artifacts.

### Verdict: CONFIRM

Round 1's sole blocking issue (the `deprecated`-clause contradiction across proposal/design/tasks/spec) is
verifiably resolved — I independently re-derived this from the current file contents rather than trusting the
round-2 prompt's characterization. A fresh pass found no new contradictions, placeholders, or AC-to-task
coverage gaps, and every load-bearing technical claim in design.md/tasks.md (tuple arities, missing
`resolveSingleBinding` wiring on the `/query` route, `MetricDefinition`'s field shape, `rejectCompanionBinding`'s
actual pass-through behavior, `MetricService`'s actual 422 usage, the next-free migration number) checks out
against the real code, not just against the docs' own internal consistency. The plan is sound enough to
implement.

### Non-blocking notes

- (Carried forward from round 1, still true, still non-blocking) `PanelService.batchUpdate`
  (`PATCH /api/panels/batch`) never calls `rejectCompanionBinding` for `dataTypeId` today and the design
  doesn't wire `rejectUnresolvableMetric` into it either — this mirrors a pre-existing gap in the same path,
  not a regression, and AC3 is written against `create`/`update` specifically. Worth a one-line acknowledgment
  in tasks.md if the executor wants to preempt a "why didn't batchUpdate reject this" question later, but not
  required by the ticket as scoped.
