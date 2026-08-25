## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All source reads below are from the worktree, not from the planning documents.

1. **Mechanism (1) — item-level flatMap-drop — claim verified exactly.**
   - `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala:42` —
     `case Some(JsArray(items)) => items.flatMap(it => Try(it.convertTo[SortKey]).toOption)` for `orderBy`. ✓ (line number in docs is correct)
   - `FilterStep.scala:36` (`conditions`) ✓ and `SortStep.scala:30` (`sortBy`) ✓ — same pattern, correctly identified as out of scope.

2. **Mechanism (2) — field-level default-on-missing — claim verified exactly.**
   - `PivotStep.scala:25-32`: `index` → `items.collect { case JsString(s) => s }`, `case _ => Vector.empty`; `column`/`values`/`agg` → `StepCodecUtil.stringOr(obj, k, "")`. ✓
   - `UnpivotStep.scala:29-38`: `idVars`/`valueVars` same collect/empty; `varName`→`"variable"`, `valueName`→`"value"`. ✓
   - `WindowStep.scala:37-40` `partitionBy` — mechanism (2); so `window` genuinely carries **both**. ✓
   - `JoinStep.scala:20-22`: `rightDataSourceId` → `""`, `joinKey` → `""`, `joinType` → `"inner"`. ✓ (docs say "all three via `stringOr`" — accurate; note `joinType` defaults to `"inner"`, not `""`.)
   - `StepCodecUtil.asObject` returns `JsObject.empty` for a non-object top-level value — so a *wholly* wrong-shaped config also decodes to an all-defaults config without failure. Confirms the premise is if anything understated.

3. **`validateEmbeddedStepReferences` claim — verified, with one consequential nuance the docs get half-right.**
   `PatchSetApplyResolvers.scala:222-244`: `Failure(_) => BadRequest`; special arms for `JoinConfig`/`UnionConfig`/`LookupConfig` doing `dataSourceRepo.findByIdOwned(...)`; then `case Success(_) => Right(())`. So pivot/window/unpivot have **no** semantic check. ✓ See CR-1 for the nuance.

4. **`ANTHROPIC_API_KEY` — verified present and real.** `backend/.env` contains exactly one `ANTHROPIC_API_KEY` entry, prefix `sk-ant-a`, value length 108 — a real key, not a placeholder. Task 1.1's precondition is satisfiable.

5. **Live-trial assertion discipline — verified adequate in intent.** design.md D2 and tasks 3.2 both explicitly require decoding through the real decoder and asserting actual field VALUES, and explicitly reject a bare "decodes without throwing" assertion. This is the correct discipline for this defect class. tasks 2.5 requires recording the exact prompt + resulting `patch.config`, so the live trial produces inspectable evidence rather than a pass/fail assertion.

6. **Target files exist**: `RefinementEditShape.scala` and `RefinementEditShapeSpec.scala` are both present at the paths the Impact section names.

### Verdict: REFUTE

Two specific, cheap revisions. The premise corrections themselves are accurate and hold up under independent source reading — the objections are about a mis-prioritized trial target that risks a false-negative conclusion, and an internal contradiction between proposal.md and the spec delta.

### Change Requests

1. **`join`'s `rightDataSourceId` is the one field in the set that is NOT silently accepted — de-prioritize it as the trial target and re-target the `join` trial at `joinKey`.**
   design.md's Premise Correction calls `rightDataSourceId` defaulting to `""` "the most severe instance in the set", and tasks 2.1 gives it "particular attention". But `PatchSetApplyResolvers.scala:228-232` routes every `Success(jc: JoinConfig)` through `dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user)`, which for `""` cannot match a row and returns `Left(ServiceError.NotFound("edit N: data source not found: "))`. A wrong-shape join edit that empties `rightDataSourceId` is therefore **caught and surfaced as an error** — it is the *least* silent instance in the set, not the most severe.
   The concrete risk: as written, task 2.1 probes `rightDataSourceId`, observes the trial correctly rejected, and concludes "the prompt rule covers join" — while `joinKey` silently defaulting to `""` (`JoinStep.scala:21`), which has no resolver check at all and is a genuine silent-degradation path, goes untested. That is precisely the false-negative this ticket exists to prevent.
   Revise tasks 2.1 and design.md's Premise Correction to (a) name `joinKey` (and secondarily `joinType`) as join's real silent-degradation surface and the primary trial target, and (b) record that `rightDataSourceId` is already backstopped by the resolver's referential check, so a rejection there is not evidence about the prompt rule. design.md's Context section already notes join/union/lookup "get an additional referential-integrity check" — the correction is to carry that fact into the trial *design*, where it currently contradicts itself.

2. **Reconcile proposal.md's "no spec-level requirement changes" with the spec delta that adds a requirement — and soften the delta's unenforceable `SHALL NOT`.**
   proposal.md's Capabilities section states under both New and Modified: "(none — no spec-level requirement changes...)". But `specs/conversational-refinement/spec.md` is an `## ADDED Requirements` delta with four scenarios. These directly contradict each other; one must give.
   Relatedly, the added requirement as phrased — a `PatchSet` "SHALL NOT be returned in a `200` response" if its config would decode to degraded content — is a hard guarantee that nothing in this change's committed scope enforces. The change ships prompt worked-examples plus unit tests over those examples; decoder hardening (which is what *would* make this deterministically enforceable) is explicitly deferred by design.md D3 / the Non-goals. design.md's own Risks section correctly says a passing live trial means "this specific adversarial framing didn't reproduce it", not "proven safe for all phrasings" — the spec delta over-claims relative to that.
   Either drop the spec delta (and keep proposal.md's "no requirement changes" as-is, consistent with a verification pass), or keep it and rewrite both the proposal's Capabilities section and the requirement text to state what is actually guaranteed (prompt grounding carries a worked, decoder-verified UPDATE example for each of the four kinds; regression tests assert real decoded values) rather than an absolute guarantee about all LLM output.

### Non-blocking notes

- `StepCodecUtil.asObject` falling back to `JsObject.empty` on a non-object top level means a config that is a JSON scalar or array decodes to an all-defaults config. Worth naming explicitly in whatever follow-up ticket picks up the deferred decoder hardening — it is the broadest instance of the class.
- `LookupConfig`'s arm is guarded by `if lc.referenceDataSourceId.nonEmpty`, so an empty reference id falls through to `case Success(_) => Right(())` — i.e. lookup does *not* get the backstop join/union get. Out of this ticket's scope, but a useful data point for the Filter/Sort follow-up ticket's scoping.
- Scope item 4's disposition is handled correctly: ticket.md records the coordinator's `defer-to-followup`, design.md D3 gives the blast-radius reasoning, and proposal.md Non-goals states it. No ESCALATION is owed here.
- tasks 2.6 (delete throwaway pipelines/data sources) correctly addresses the shared dev-Postgres hazard.
