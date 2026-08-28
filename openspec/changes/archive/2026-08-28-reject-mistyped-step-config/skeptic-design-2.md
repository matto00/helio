## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review. Every claim below was derived from the worktree tree, not from round 1's report or the
authors' narrative. Where I agree with round 1, I re-derived it independently.

### What I verified (with evidence)

**CR-1 (false sweep enumeration) — DISCHARGED.** I regenerated the enumeration myself over
`backend/src/main/scala/com/helio/domain/steps/` (24 `.scala` files = 23 step files + `StepCodecUtil.scala`,
plus `README.md`) by grepping every `case _ =>` / `getOrElse(` / `stringOr` / `intOr` / `.toOption` /
`collect {` in each file and reading the `decode(raw: String)` bodies of the ambiguous ones.
- Design Decision 6 now retracts the "exactly two files" claim explicitly, states the scoping criterion as
  *field-verified harm plus an explicit ticket bound* (not "nowhere else has the pattern"), and records the
  rest as known-remaining. That is the correction CR-1 asked for.
- Table row 1 (`Map.empty` after `Try(...).getOrElse`): `CastStep:23`, `RenameStep:23` — correct.
- Row 2 (`items.collect { case JsString(s) => s }` + `case _ => Vector.empty`): `SelectStep:20`,
  `GroupByStep:23`, `DedupeStep:28`, `FillNullStep:29`, `LookupStep:31`, `PivotStep:26`,
  `UnpivotStep:30,34` (×2), `WindowStep:38` — every entry verified present.
- Row 3 (per-element `Try(...).toOption` flatMap): `AggregateStep:39,44` (×2), `FilterStep:36`,
  `SortStep:30`, `WindowStep:42` — verified. `AssertStep` is listed here but is misclassified (see notes).
- Row 4 (`stringOr`/`intOr` default substitution): all 15 named files verified to call one of them.
- Row 5 (scalar `case _ => 0` / `=> None`): `LimitStep:21`, `ComputeStep:22-25` (`type`),
  `DateBucketStep:28-31` (`outputColumn`), `StringOpsStep:42-49`, `WindowStep:46,49` — verified.
- All 23 step files appear somewhere in the table; `StepCodecUtil.scala` is correctly the only decoder-less
  file. AC4, proposal.md and tasks 5.1/5.1a are consistent with the corrected finding.
- `GroupByStep:23,27` really is the severity the design claims: `{"groupBy":"region"}` → `Vector.empty`, and
  `stringOr(obj,"aggFunction","sum")` substitutes `sum`. Correctly flagged as the highest-severity follow-up.

**Decision 1 — confirmed.** `grep -c "new PipelineStep.Companion"` = 23, `Registry` has 23 entries. A
concrete `def validateRawConfig(raw: String): Option[String] = None` on the trait
(`domain/model/PipelineStep.scala:91-110`) leaves the other 21 anonymous instances compiling untouched.

**Decision 2 (400 vs 422) — confirmed.** `ServiceError.UnprocessableEntity` → `StatusCodes.UnprocessableEntity`
via `ServiceResponse`, body is the uniform `ErrorResponse(message)`, which `helio-mcp`'s `describeError`
renders readably. Unknown *type* stays 400, malformed JSON stays 400 through the unchanged decode `Failure`
branch. No existing status code moves.

**Decision 3 (accept-absent / reject-present) — confirmed against `CastConfig.decode`
(`domain/steps/CastStep.scala:20-27`).** The two swallow sites are exactly `case _` (non-object) and
`Try(...).getOrElse(Map.empty)` (object with a non-string value); the two rejection clauses cover both, and
an absent key is untouched. `StepCodecUtil` is `private[steps]` and both step files are in that package, so
the shared-helper placement compiles.

**Decision 4 (exactly five uncovered) — confirmed by re-derivation, not by trusting round 1.**
`PipelineAnalyzeService.scala` defines exactly 8 validators (lines 129/135/144/161/170/177/183/189).
`PipelineAnalyzeServiceSpec` covers the failure path for `stringops`, `fillnull` and `window` only (the
`window` case asserts `include("median")`, which is why a literal-`Unsupported` grep miscounts). The
remaining failure paths — `aggregate`, `groupby`, `pivot`, `union`, `join` — have no assertion anywhere.
Five, as stated; `window` is covered.

**Decision 7a (groupby/join dispatch gap) — confirmed.** `inferOutputSchema` (lines 202-227) dispatches 21
kinds; `"groupby"` and `"join"` appear in no arm and fall to `case unknown => Some(s"Unknown op: '$unknown'")`.
`validateStepConfig` runs first (line 71), so tasks 1.2/1.4's invalid-enum assertions are honest and the
valid-config negative is correctly declared unassertable for those two kinds. Task 1.3 correctly names line
126 and correctly warns off line 619 (`inferAssert`'s own join). Deferral is the right call.

**Satisfiability of tasks 1.2/1.3 — checked.** Each of the five validators reads a *string* field of a
typed config (`aggFunction`, `agg`, `mode`, `joinType`, `aggregations[].fn`), so an invalid value is
expressible through `pipelineStepRepo.insert`'s typed-config path that `PipelineAnalyzeRoutesSpec` already
uses. The multi-failure join is reachable via `validateWindow` (`function:"lag"`, no `field`, `offset:0` →
two problems) or two bad `aggregate` fns. Both tasks are satisfiable as written.

**CR-2 (wrong component attributed) — NOT DISCHARGED. The revision moved the claim off a component that
cannot satisfy it and onto a surface that also cannot satisfy it.** See CR-1 below.

### Verdict: REFUTE

One blocking change request. Round 1 raised CR-2 and the revision did not fix it — it relocated it. I am
saying that explicitly, as asked.

### Change Requests

1. **The raw-config-string contract does NOT hold on the stored-pipeline analyze route, so AC7, spec
   scenario "The analyze surface reports a key the typed decoder would discard", design Decision 5, and task
   2.1 are all unsatisfiable as now written.** Round 1 correctly showed `validateStepConfig` has no
   `cast`/`rename` case; the revision rebound the claim to "the analyze surface's observable
   `validationError`" via `GET /api/pipelines/:id/analyze`. That surface never sees the raw stored text:

   - `PipelineService.analyze` (`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:154-168`)
     builds each `PipelineStepInput` with **`config = PipelineStepConfigCodec.encode(s)`** — a re-encoding of
     the already-decoded typed step, not `row.config`.
   - `s` came from `pipelineStepRepo.listByPipelineInternal`
     (`infrastructure/persistence/pipelines/PipelineStepRepository.scala:148-151`), which maps every row
     through `rowToDomain` (line 258-261) → `PipelineStepConfigCodec.decode` → the **tolerant**
     `CastConfig.decode`.
   - `PipelineStepConfigCodec.encode` for `cast` is `config.asInstanceOf[CastConfig].toJson.compactPrint`
     (`domain/steps/CastStep.scala:82`). Its own scaladoc calls this "the analyze path's *re-encode for the
     stringly-typed analyze layer* round trip" (`api/protocols/pipelines/PipelineStepConfigCodec.scala:36-39`).

   Consequence, traced end to end: a row stored as `{"casts":[{"field":"x","to":"float"}]}` is decoded to
   `CastConfig(Map.empty)` and re-encoded to `{"casts":{}}`. `inferCast`
   (`domain/engine/PipelineAnalyzeService.scala:245-249`) then evaluates
   `json.fields("casts").convertTo[Map[String,String]]` on a *valid empty object*, succeeds, and returns
   **no** `validationError`. The step reports clean. So:
   - Design Decision 5's sentence "`PipelineAnalyzeService.analyze` passes `step.config: String` — the raw
     text" is true only of the analyze *service*; it is false of the analyze *route*, which is the surface
     AC7 and the spec scenario were just rebound to.
   - ticket.md's "Orchestrator premise-validation finding" paragraph ("a list-shaped `casts` … already
     surfaces today as the generic message `cast config error`") is false for a stored step, and it is
     asserted as independently confirmed. Standing requirement 2 applies to it.
   - Task 2.1's route assertion cannot be made to pass by any seeding method, including the raw-SQL insert
     it recommends — the round trip happens on read, after the insert. Task 2.2 then routes the executor to
     an escalation the design gate should have resolved.

   Required revisions:
   (a) There **is** a surface where the contract genuinely holds:
       `PipelineService.analyzeProposal` (`PipelineService.scala:251-257`) builds `PipelineStepInput` from
       `req.config.compactPrint` — the caller-supplied raw JSON, never round-tripped — and is exposed as
       `POST /api/pipelines/analyze-proposal` (`api/routes/pipelines/PipelineRoutes.scala:45-48`), with an
       existing route spec (`PipelineAnalyzeProposalRoutesSpec`). A `cast` step with a list-shaped `casts`
       is expressible there (proposal `config` is a passthrough `JsValue`) and *does* reach `inferCast`
       unmodified. Rebind AC7, the spec scenario and task 2.1 to that surface — a proposal-analyze request,
       not a stored pipeline — or state a concrete alternative, but do not leave them bound to
       `GET /api/pipelines/:id/analyze`.
   (b) Rewrite Decision 5 to say plainly that the stored-pipeline analyze route round-trips the config
       through the tolerant decoder and therefore **cannot** observe a dropped key, and that the raw-config
       property is a property of the *proposal* analyze path only. Retract the round-trip-blind sentence.
   (c) Correct the ticket's premise-validation paragraph inline (standing requirement 4), since it asserts
       the opposite of the code for the stored-step case.
   (d) State the consequence for the ticket's argument: because analyze cannot see a stored mistyped
       `cast`/`rename` config at all, the write-path 422 is not merely *better* than the analyze advisory —
       it is the **only** place the defect is detectable for a persisted step. Design Decision 5's
       "This does not make the write-path fix redundant" understates it; the reverse dependency the ticket
       assumed does not exist. Sections 1, 3, 4 and 5 of tasks.md are unaffected by this and remain sound.

### Non-blocking notes

- Decision 6's table lists `AssertStep` under "per-element `Try(...).toOption` swallow". It is not that
  shape: `AssertConfig.decode` (`domain/steps/AssertStep.scala:50-73`) uses `items.map(decodeRule)` with a
  non-object element degrading to an **all-defaults rule** rather than being dropped, plus
  `case _ => Vector.empty` for a non-array `rules` and two `stringOr` defaults. Same family, wrong row.
- `StringOpsStep.scala:49` (`fields` → `None` on a non-array) belongs in row 2's family as well; it appears
  only in rows 4 and 5. Neither omission changes Decision 6's conclusion.
- Decision 6 says "all 23 files in `domain/steps/`" and then "only `StepCodecUtil.scala` … has no decoder of
  its own". There are 23 *step* files plus `StepCodecUtil.scala` (24 `.scala` files). Reword to "all 24
  `.scala` files" so the count and the exclusion are consistent.
- `PipelineAnalyzeServiceSpec.scala:138` does cover `union`'s **pass** path (`mode:"byName"`, asserting no
  `validationError`). Decision 4's "uncovered" is about the failure path and is correct, but saying so
  explicitly would prevent a future reviewer re-litigating it.
- Task 1.2's "assert the message names the offending value and lists the supported values" matches all five
  validators' actual message text (lines 161-193). Good.
- Risks section's treatment of `addStep`'s indirect callers is now stated rather than assumed. Agreed with,
  and I re-checked `PipelineProposalService` and `BoundPanelService` propagate the `Left`.
