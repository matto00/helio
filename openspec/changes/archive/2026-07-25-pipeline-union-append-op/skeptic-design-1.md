## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **JoinStep.scala as template** — read
   `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala` in full. Confirmed: async
   `evaluate` signature, `ctx.dataSourceRepo.findByIdInternal(DataSourceId(...))` resolution,
   `"DataSource not found for join: " + rightDsId` error message shape, `leftRow ++ rightRow`
   combination style, tolerant `decode` defaulting `joinType -> "inner"`. design.md Decisions 1–5
   and 8 accurately mirror this file; tasks.md 1.1–1.3 cite the correct touch points.

2. **PipelineAnalyzeService dispatch** — read
   `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala:61-83`. Confirmed the
   exact passthrough case cited by design.md: `case "filter" | "limit" | "sort" | "dedupe" |
   "fillnull" => (inputSchema, None)`, and confirmed `"join"` has **no** case at all — it falls
   through to `case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`. Decision 6's claim
   that `union` needs its own dedicated case (not join's implicit fallback) to avoid a false
   `validationError` is accurate and correctly scoped (AC "no false validationError" is satisfiable
   as designed). tasks.md 2.3 and spec.md's passthrough requirement match.

3. **stepNarrowing.ts `OP_TYPES` / join exclusion mechanics** — read
   `frontend/src/features/pipelines/state/stepNarrowing.ts:68-196`. Confirmed `join` is excluded
   from `OP_TYPES`, has an internal `JOIN_OP_TYPE` lookup entry, a `defaultConfigFor` case, and a
   backend-loaded-step resolution fallback (`ps.type === "join" ? JOIN_OP_TYPE : ...`). tasks.md
   4.2's mirrored plan for `union`/`UNION_OP_TYPE` is mechanically sound and matches this pattern
   exactly.

4. **Flyway migration state** — ran `ls backend/src/main/resources/db/migration/ | sort`. Current
   max is `V70__add_stringops_op.sql`. Confirmed the drop/re-add full-accumulated-list pattern by
   reading that file. tasks.md 3.1 and 7.1 both contain explicit, distinct re-confirmation tasks
   (scheduling time and pre-delivery-push time) satisfying the merge-hazard instruction from the
   ticket's orchestrator notes.

5. **HEL-278 status and the actual current join ACL posture — this is where the design's central
   security rationale breaks down.** design.md's Decision 7 and Risk section, the ticket's
   Dependencies/rationale, and proposal.md's Non-goals all assert that `union` "inherits the
   identical exposure" to `join`'s "unscoped `findByIdInternal`" lookup, and cite HEL-278 as the
   still-open ticket tracking the fix. I pulled HEL-278 via Linear: **status = Done, completedAt
   2026-05-24**, merged via PR #171 / #173 ("HEL-278 Restrict JoinStep right-source to caller-owned
   data sources"). It is *not* an open gap — it already shipped, roughly two months before this
   ticket. Its scope was explicitly: "Pre-flight ACL: when a pipeline step is created or updated
   with a JoinStep, validate the right `dataSourceId` is owned by the caller... Runtime resolution:
   keep `findByIdInternal` at evaluation time."

   I then read `backend/src/main/scala/com/helio/services/PipelineService.scala:252-301` (`addStep`)
   and `:304-373` (`updateStep`). Both contain a `joinCheckF` pre-flight block:
   ```scala
   val joinCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
     case jc: JoinConfig =>
       dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
         case None    => Left(ServiceError.NotFound(s"Data source not found: ${jc.rightDataSourceId}"))
         case Some(_) => Right(())
       }
     case _ => Future.successful(Right(()))
   }
   ```
   This confirms: **`join`'s right-source is already scoped to caller-owned data sources at step
   creation/update time** (`findByIdOwned`), and only the runtime `evaluate()` path (already
   ACL-checked at authoring time) still uses the privileged `findByIdInternal`. The
   `stepNarrowing.ts:68-70` comment ("re-expose when HEL-278 is resolved") is itself stale —
   pre-existing code the design correctly cites for its *mechanics* but incorrectly cites for its
   *rationale*, since it copies the stale premise as its own justification without checking
   HEL-278's actual status.

   The critical consequence: tasks.md has **no task** to add a symmetric pre-flight ACL check for
   `UnionConfig.otherDataSourceId` in `PipelineService.addStep`/`updateStep`. The `case _ =>
   Future.successful(Right(()))` fallback means a newly-created `UnionConfig` will silently skip
   the check entirely. So as designed, `union` will ship with **strictly weaker** ACL scoping than
   `join` currently has — not "identical exposure to join" as design.md Decision 7 and the Risk
   section claim, and not the symmetric posture the ticket's Dependencies/Out-of-scope line implies
   ("Loosening `join`'s or `union`'s privileged cross-user source resolution (tracked by HEL-278)" —
   phrased as if both are equally open today, which is false for `join`).

   This is a factual, ground-truth-checkable error in the design's premise, not a stylistic nit: any
   authenticated user could create a `union` step against any other user's `DataSourceId` (guessed
   or enumerated) with **zero** pre-flight check, whereas the equivalent `join` attack was already
   closed off. The picker-exclusion (Decision 7) is a reasonable *additional* mitigation but does
   not substitute for the pre-flight ACL check — `union` is still reachable via direct API/MCP
   construction (which the design itself acknowledges in Decision 7's last sentence), exactly the
   path `join`'s pre-flight check protects today.

### Verdict: REFUTE

### Change Requests

1. **Correct the factual premise about HEL-278 and close the ACL gap.** design.md's Decision 7 and
   Risk section, and proposal.md's Non-goals, must be revised: HEL-278 is **Done** (completed
   2026-05-24), and it already added a pre-flight `findByIdOwned` ACL check for `JoinConfig`'s
   `rightDataSourceId` in `PipelineService.addStep` (`PipelineService.scala:266-275`) and
   `updateStep` (`PipelineService.scala:341-357`). The design must either:
   - (preferred) Add a task (new tasks.md item, e.g. "2.6") to add a symmetric
     `case uc: UnionConfig => dataSourceRepo.findByIdOwned(DataSourceId(uc.otherDataSourceId),
     user)...` pre-flight check to both `addStep` and `updateStep`, mirroring the shipped `join`
     pattern exactly — this is what "mirroring `JoinStep`" should mean given the current state of
     the codebase, and it is the only way `union`'s exposure is actually "identical to `join`'s" as
     claimed; or
   - Explicitly and correctly document (not misdescribe) that `union` is being shipped with
     *weaker* protection than the current `join`, with an honest justification for why that
     asymmetry is acceptable for this change (e.g. explicit spinoff ticket + owner sign-off), rather
     than the current text which asserts a false parity.
   Either path requires updating design.md Decision 7, the Risk section, proposal.md's Non-goals
   line, and — if the pre-flight check is added — `ticket.md`'s AC #1 wording ("pipeline ACL is the
   gate") no longer accurately describes the full picture and should be corrected to mention the
   source-level ownership check too.

2. **Impact/task list gap.** proposal.md's Impact section lists `service/PipelineService.scala` only
   in the context of `toAnalyzeStepResponse` (tasks.md 2.5). If Change Request 1 is resolved by
   adding the pre-flight check, tasks.md needs an explicit task for the `addStep`/`updateStep`
   changes (not folded silently into 2.5, which is about the analyze-response mapping, a different
   code path).

3. **Test coverage gap that follows from #1.** tasks.md 6.1 covers execute-time errors
   (missing/unresolvable source, unsupported mode) but has no task for a creation/update-time ACL
   test analogous to whatever `join` has for HEL-278 (cross-user `otherDataSourceId` → 404 at
   `addStep`/`updateStep`, mirroring HEL-278 AC #3). Add one if Change Request 1 adds the pre-flight
   check.

### Non-blocking notes

- The column-reconciliation policy (Decisions 2–4) is precise and testable — spec.md's scenarios
  pin exact input/output row shapes for both modes and the identical-columns byName case, which is
  sufficient for an implementer to write a failing-then-passing test against.
- Decision 6 (analyze passthrough) is well-reasoned and verified accurate against
  `PipelineAnalyzeService.scala`'s actual dispatch code — no changes needed there.
- The mechanical wiring plan (registry, protocol, codec, Flyway drop/re-add, stepNarrowing mirror)
  is accurate against every file I spot-checked (`domain/package.scala`, `PipelineStep.scala`
  registry, `stepNarrowing.ts`) and the two-time Flyway re-check (tasks 3.1/7.1) correctly captures
  the known merge hazard.
