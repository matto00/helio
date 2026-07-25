## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **HEL-278 status and the `joinCheckF` pre-flight pattern, re-verified independently.** Called
   `mcp__linear__get_issue` for HEL-278 fresh (not trusting round 1's or the orchestrator's
   narrative): `status = Done`, `completedAt = 2026-05-24T03:09:34Z`, PRs #171/#173. Read
   `backend/src/main/scala/com/helio/services/PipelineService.scala:266-275` (`addStep`) and
   `:351-357` (`updateStep`) directly — both contain the `joinCheckF` block exactly as design.md's
   Context and Decision 9 now describe it:
   ```scala
   val joinCheckF: Future[Either[ServiceError, Unit]] = typedConfig match {
     case jc: JoinConfig =>
       dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user).map {
         case None    => Left(ServiceError.NotFound(...))
         case Some(_) => Right(())
       }
     case _ => Future.successful(Right(()))
   }
   ```
   design.md's Context correction (lines 15-23) and Decision 9 accurately describe this: creation
   /update-time `findByIdOwned` scoping exists for `join`, runtime `evaluate` still uses privileged
   `findByIdInternal`. Round-1's central finding is now correctly reflected — **(a) confirmed.**

2. **Decision 9's planned `UnionConfig` mirror is internally consistent design.md ↔ tasks.md, with
   one real gap against spec.md.** design.md Decision 9 (lines 109-116) and tasks.md 2.6 both
   describe adding a `unionCheckF` arm to both `addStep` and `updateStep`, matching the shipped
   `join` pattern's exact shape (`case _ => Future.successful(Right(()))` fallback preserved) — this
   part is sound and consistent. However, `specs/pipeline-union-op/spec.md` (lines 97-120) commits
   to **three** scenarios under "Union step second-source reference must be caller-owned...":
   cross-user *creation* → 404, own-source *creation* → 201, **and cross-user *update* → 404**
   (PATCH path). tasks.md 6.7 only plans a "test pair" — `"POST with union type and cross-user
   other-source returns 404"` and `"POST with union type and own other-source returns 201"` —
   mirroring "the existing 'POST with join type...' tests exactly." I read
   `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` directly: the existing join
   ACL tests (lines 258-274) are **POST-only** — there is no PATCH-based cross-user ACL test for
   `join` anywhere in that file (`grep "PATCH"` on the file shows only three PATCH tests: config
   update, cross-type-lock, unknown-id — none exercise the ACL check on update). So spec.md's third
   scenario (union update-time 404) has **zero** task backing it anywhere in tasks.md — not folded
   into 6.7, not a separate task. This is a real, verifiable spec.md ↔ tasks.md inconsistency, not a
   nitpick: the update-time ACL branch (`updateStep`'s `unionCheckF`, task 2.6, second half) is the
   exact security-sensitive code path this round exists to add, and as planned it would ship with
   **no automated regression test** even though the spec explicitly promises the behavior. **(b) —
   NOT fully consistent; see Change Request 1.**

3. **Decision 7's picker-exposure reversal, re-verified against the actual frontend.** Read
   `frontend/src/features/pipelines/state/stepNarrowing.ts:68-95`: the `OP_TYPES` comment reads
   "join is intentionally excluded until full join semantics ship (re-expose when HEL-278 is
   resolved **and** the backend implementation is complete)" — a stale, dual-condition comment.
   Ran `find frontend/src/features/pipelines/ui -iname "*join*"` — **no result**, confirming no
   `JoinConfig.tsx` (or any join-named editor) exists. Ran `grep -n "join\|Join"
   frontend/src/features/pipelines/ui/StepCard.tsx` — **no matches at all**: `StepCard.tsx` has zero
   join-specific wiring, meaning a `join` step today renders with no dedicated config editor.
   `grep -rl "join\|Join" frontend/src/features/pipelines/` (excluding tests) returns only
   `pipelineStep.ts` (wire types), `PipelineDetailPage.tsx`, and `stepNarrowing.ts` — none of which
   is an editor component. This confirms design.md's Context/Decision 7 claim: the real,
   still-current reason `join` stays out of `OP_TYPES` is the missing frontend editor, not the
   (now-closed) ACL gap. Since `union` ships both a `UnionConfig.tsx` editor (task 4.3) and the ACL
   check (task 2.6/Decision 9), exposing it does not inherit either of `join`'s real exclusion
   reasons. **(c) confirmed — well-justified.**

4. **`openspec validate --strict`.** Ran `openspec validate pipeline-union-append-op --strict` from
   the worktree root: `Change 'pipeline-union-append-op' is valid`. **(d) confirmed.**

5. **Flyway re-check tasks.** Read tasks.md sections 3 and 7: task 3.1 ("re-confirm max migration
   number... immediately before writing the migration, do not trust the ticket's guess") and task
   7.1 ("re-confirm... immediately before the delivery push") are both present, distinct, and
   correctly worded. Ran `ls backend/src/main/resources/db/migration/ | sort | tail -5` — current
   max is still `V70__add_stringops_op.sql`, consistent with round 1's finding (no drift). **(f)
   confirmed.**

6. **Decision 8 (`jsonFormat6`) spot check, unchanged from round 1 — re-verified for freshness.**
   Read `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala:36,139,200,227` —
   `JoinStepResponse`'s six-field shape and `jsonFormat6` wiring match design.md Decision 8 exactly.
   No regression here.

7. **Other stale/unverified claims — scanned for.** design.md's Non-Goals, Risks, and Planner Notes
   sections were re-read line-by-line against the corrected Context; found no further false-parity
   or stale-status claims beyond the gap in finding #2. ticket.md's own "Correction" section
   (appended post round-1) accurately restates the same facts I independently re-verified in #1 and
   #3. **(e) — one gap found (see Change Request 1); no other stale claims found.**

### Verdict: REFUTE

### Change Requests

1. **spec.md's update-time (PATCH) ACL scenario has no backing task.**
   `specs/pipeline-union-op/spec.md:116-120` ("Scenario: Cross-user union step update returns 404")
   commits to test-verifiable behavior on the `updateStep` path, but tasks.md 6.7 only plans the two
   POST-side tests (mirroring the join precedent, which itself never had a PATCH ACL test). Add an
   explicit third case to task 6.7 (or a new 6.8) in `PipelineStepRoutesSpec.scala`: "PATCH on a
   union step with cross-user `otherDataSourceId` returns 404" (and, for parity with the "no step
   persisted"/"config unchanged" assertions spec.md requires, verify the step's config is unchanged
   after the failed PATCH). Without this, the `updateStep` half of task 2.6's `unionCheckF` — the
   security-sensitive code this design round exists to add — ships with no automated regression
   coverage even though the spec explicitly promises the behavior is tested.

### Non-blocking notes

- The HEL-278 correction and Decision 9's ACL-check plan are now factually accurate and consistent
  between design.md, tasks.md (creation-side), ticket.md, and proposal.md — this closes round 1's
  security-gap finding cleanly on the *implementation* side; only the *test-task* side has the gap
  above.
- Decision 7's reversal is well-evidenced (no `JoinConfig.tsx` exists, no join wiring in
  `StepCard.tsx`) and the rationale in design.md/spec.md/ticket.md is now honest about what changed
  and why, rather than asserting a stale premise.
- Column-reconciliation (Decisions 2-4), analyze passthrough (Decision 6), and the mechanical
  wiring plan (Decision 1, 8, tasks 1.x/2.x/3.x/4.x/5.x) were unaffected by this round's revisions
  and remain accurate against the codebase per round 1's verification — re-spot-checked Decision 8
  only, no regressions found elsewhere.
