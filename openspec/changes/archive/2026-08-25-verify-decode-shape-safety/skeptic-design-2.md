## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

All source claims re-derived from the worktree source, not from the planning documents.

1. **Round-1 CR-1 (re-target the `join` live trial) — applied, but INCOMPLETELY.**
   - `JoinStep.scala:19-22` re-read: `rightDataSourceId` → `""`, `joinKey` → `""`, `joinType` → `"inner"`, all via `StepCodecUtil.stringOr`. ✓
   - `PatchSetApplyResolvers.scala:228-232` re-read: `case Success(jc: JoinConfig) => ctx.dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user)` → `None => Left(ServiceError.NotFound(...))`. The backstop is real; `joinKey`/`joinType` fall through to `case Success(_) => Right(())` with no check. ✓
   - design.md D1 (line ~47), design.md's Premise Correction (lines 108-115), and tasks.md 2.1 are all correctly re-targeted onto `joinKey`/`joinType` and explicitly disqualify `rightDataSourceId` as a probe. ✓
   - **BUT** design.md **line 128** still reads: "`JoinStep`'s `rightDataSourceId` defaulting to `""` gets particular attention in the live trials (D1) as the highest-severity instance identified." This is the exact sentence CR-1 asked to remove, still present, and it now directly contradicts lines 108-115 and D1 sitting a few lines above it. See CR-1 below.

2. **Round-1 CR-2 (reconcile proposal Capabilities / soften the `SHALL NOT`) — applied.**
   - proposal.md's Modified Capabilities now lists `conversational-refinement` with an accurate description of the guarantee's scope ("prompt-grounding/test guarantee, not a decoder-level one"). The prior "(none — no spec-level requirement changes)" contradiction is gone. ✓
   - `specs/conversational-refinement/spec.md`'s requirement is now scoped to "grounding SHALL include a worked, decoder-verified example", with a second paragraph explicitly disclaiming any guarantee over model output or decode-time behavior. The four scenarios assert against `RefinementEditShapeSpec` decoding through the real decoders (`JoinConfig.decode` etc.) and checking actual values — test-verifiable, consistent with D2. ✓ The unenforceable absolute `SHALL NOT be returned in a 200 response` is gone. ✓

3. **`openspec validate verify-decode-shape-safety --strict` → `Change 'verify-decode-shape-safety' is valid` (exit 0).** ✓
   (Note: `npx openspec` fails in this worktree — the binary is `/usr/bin/openspec`. Not a plan defect.)

4. **New contradiction introduced by the CR-2 revision — spec requirement is unconditional, tasks are conditional.**
   `RefinementEditShape.scala` today has `RenameStepExample` (line 40), `AggregateStepExample` (43), `GroupByStepExample` (55) and panel/create/delete examples — and **no** join/pivot/window/unpivot example (verified by grep of every `private[services] val` in the file). The new spec requirement asserts, unconditionally, that grounding "SHALL include a worked UPDATE example for **each** of `join`, `pivot`, `window`, and `unpivot`", with four scenarios each asserting a corresponding `RefinementEditShapeSpec` test. But tasks.md 3.1 adds an example only "For each step kind where 2.1-2.4 **reproduces** a wrong-shape edit slipping through", and proposal.md Impact says "**possible** new worked examples". If the live trials pass (a plausible, arguably likely outcome — the whole ticket premise is that the general prompt rule may already cover these kinds), the change ships adding a spec requirement that its own code does not satisfy and four scenarios describing tests that were never written. See CR-2.

5. **Rest of the plan re-checked and holds.** Mechanism (1)/(2) characterization re-confirmed against `WindowStep.scala:37-42`, `PivotStep.scala:25-32`, `UnpivotStep.scala:29-38`. Task coverage traces to all four ACs (AC1 code read → ticket Premise Correction; AC2 → tasks 2.1-2.5; AC3 → tasks 3.1-3.3 + D2; AC4 → design D3 + proposal Non-goals, coordinator-resolved `defer-to-followup`). Cleanup of throwaway pipelines (2.6) and the shared-dev-Postgres hazard are addressed. No placeholders/TODOs anywhere in the artifacts.

### Verdict: REFUTE

Both revisions are on the right track and CR-2 of round 1 is genuinely fixed; CR-1 was fixed everywhere except one stale sentence that re-introduces the original contradiction, and the CR-2 fix created a new conditional-vs-unconditional mismatch. Both are single-edit fixes.

### Change Requests

1. **Delete or rewrite design.md line 128** — the trailing sentence "`JoinStep`'s `rightDataSourceId` defaulting to `""` gets particular attention in the live trials (D1) as the highest-severity instance identified." It survives from the pre-revision text and contradicts the corrected Premise Correction (lines 108-115) and D1, both of which now correctly disqualify `rightDataSourceId` as a probe target. Leaving both sentences in the same document means an implementer reading top-down can still land on the false-negative trial CR-1 exists to prevent. Replace it with the corrected framing (`joinKey` primary, `joinType` secondary, `rightDataSourceId` backstopped and not probed) or delete it outright as redundant.
   *(Non-blocking sub-nit within this edit: D1 says "`rightDataSourceId` is not a useful probe — see the Context section", but the reasoning actually lives in the Premise Correction section; Context only mentions the referential check generically. Point the cross-reference at the right section.)*

2. **Reconcile the spec delta's unconditional "for each of join/pivot/window/unpivot" with tasks 3.1's conditional "only where a gap is confirmed live."** Verified: `RefinementEditShape.scala` currently contains no example for any of the four kinds, so the requirement is satisfied by nothing on `main` and is satisfied by this change only if all four examples are actually added. Pick one and make all three documents agree:
   - **(a)** Make the examples unconditional — change tasks 3.1 to add a worked UPDATE example for all four kinds and 3.2 to add all four decoder-asserting tests regardless of live-trial outcome (the live trials in section 2 then serve their stated purpose: diagnosing whether the *generic* rule already suffices, recorded as evidence, while the worked examples ship either way). Update proposal.md Impact to drop "possible". This is the option consistent with the spec delta as written and with how HEL-411 closed aggregate/groupby.
   - **(b)** Keep the examples conditional and rewrite the spec delta so its requirement and scenarios are conditioned on the same trigger (i.e. only for kinds where a gap was live-confirmed) — but note this leaves the delta unable to state which scenarios will exist until after execution, which is a poor spec shape.
   Option (a) is recommended. Whichever is chosen, tasks.md, proposal.md's Impact/Capabilities wording, and `specs/conversational-refinement/spec.md` must all state the same condition.

### Non-blocking notes

- ticket.md line 39 still carries the superseded "most severe: `rightDataSourceId`" phrasing in the coordinator's second-pass block. ticket.md is an input artifact rather than a binding plan document, so this is not blocking — but if it is cheap to annotate, doing so removes the last copy of the misleading framing.
- `LookupConfig`'s resolver arm is guarded by `if lc.referenceDataSourceId.nonEmpty`, so an empty reference id falls through to `Success(_) => Right(())` — lookup does *not* get the backstop join/union get. Out of scope here; useful for the deferred decoder-hardening follow-up.
- `StepCodecUtil.asObject` returning `JsObject.empty` for a non-object top-level value remains the broadest instance of the class; worth naming in the follow-up ticket.
- This worktree's `scripts/concertino/` is missing `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (it predates a `concertino sync`); I used the main-repo copies at `/home/matt/Development/helio/scripts/concertino/`. Environmental, not a plan defect, but worth knowing before the final gate.
