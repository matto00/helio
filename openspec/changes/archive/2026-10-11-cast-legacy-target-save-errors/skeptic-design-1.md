## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `3c0ed6ce342c0c1a297d739a990e5ea18e8e55d5`. The change dir is untracked and the planning artifacts are as read on disk.

### What I verified (with evidence)

- **Owner ruling.** `.concertino/runs/HEL-1514/events.jsonl` (main checkout), lines 4-6: the escalation was raised with options `error-only,row-hint,one-click,auto-migrate` and answered `row-hint` by a human (chat and dashboard). D2 implements the ruling as worded: error on the card, the legacy row marked invalid, inline hint, no new button, no rewrite. I did not reopen it.
- **D1 premise.** `frontend/src/features/pipelines/hooks/stepCardFieldHandlers.ts` `onCastChange` calls `persist({ casts: next })` with no `captureErrors`. `useStepCardPersist.ts:61,101` surfaces a rejection only when `captureErrors` is true. `StepOpEditor.tsx:151-152` passes no `saveError` to `CastFieldsConfig`. The fillnull, pivot and window branches pass `saveError` and `saveErrorIsValidation` into the config component, which renders `<InlineError id={errorId}>` and marks its control with `ariaInvalid`/`ariaDescribedBy` (`FillNullConfig.tsx:47,100-127`). So D1's mechanism exists and the cast branch does not render the error today. The premise is CONFIRMED.
- **D2 feasibility.** `shared/ui/Select.tsx:28-33,178-179` exposes `ariaInvalid` and `ariaDescribedBy`. `CastFieldsConfig.tsx:35-43` already detects an unsupported stored target, so the "is legacy" predicate exists.
- **Passthrough claim (keep as is = today's behaviour).** The existing `pipeline-cast-op` spec ("Stored legacy target passes through at run time") and premise-validation agree with it. It is consistent.
- **D3 premise.** `CastFieldsConfig.tsx:66` maps `columns` only, so a stored key that is not in the schema has no row today. CONFIRMED.
- **D4 against the code.**
  - Create (`PipelineStepCreate.scala:61-69`) runs the secondary-source check with `findByIdOwned(id, user)`, which is **caller** identity. Update runs the same check (`PipelineStepWrites.scala:~90-99`). `duplicateStep` (`PipelineStepWrites.scala:234-299`) runs neither, so an editor grantee can clone a join/union/lookup on a source they do not own. This is correctly classed as an **authorization** bypass, and escalate-don't-fix is the right call under the ticket's AC.
  - Lane: `validateLaneReference` (`PipelineService.scala:348-365`) is a pure validity check (exists in this pipeline, not self, not an ancestor). `deleteStep`/`deleteInternal` do no lane-reference refusal that I could find, so a dangling lane after a delete is plausible. It is correctly classed as **validity**.
  - Upsert: `upsertOwnershipCheckF` (`PipelineServiceSupport.scala:189-199`) builds `AuthenticatedUser(pipelineOwnerId, ...)`, so the identity is the pipeline owner, which duplicate does not change. Classing it as **validity** is correct. The clone adds no reach that the original step does not already hold.
  - The D5 order (raw → lane → upsert) matches create's relative order of lane before upsert.
- **Spec deltas exist and target real capabilities.** Both `openspec/specs/pipeline-cast-op` and `openspec/specs/pipeline-step-lifecycle` exist. The cast scenarios are concrete (`binary-ref`, `doc`, `qty`, `gone`) and Jest-testable. The lane and upsert scenarios are ScalaTest-testable against create's status and message (lane missing: 422 `Lane reference '<id>' does not exist in this pipeline.`; upsert target missing: 404 via `UpsertTargetCheck.NotFound`).

### Verdict: REFUTE

The core design is sound. The ruling is implemented faithfully and the D4 classification is correct. Two gaps block it: one AC clause has no plan, and one spec delta would leave the archived spec self-contradictory.

### Change Requests

1. **AC3 is not fully covered: the authorization gap has no "pinned by a test" plan and no post-ruling branch.** The ticket's AC says "every real gap is pinned by a test that fails first. Any authorization gap is escalated…". D4 and task 2.3 cover only the escalation. They do not say:
   - what happens to the secondary-source audit test from task 1.2, which is red and unfixed and so cannot be committed as-is;
   - what the executor implements for each owner answer.

   Specify both branches in design.md D4 and tasks.md:
   - **(a) owner says close it:** `duplicateStep` runs the same `secondaryDataSourceId` + `findByIdOwned(caller)` check before the lane check, returns create's 404 `Data source not found: <id>`, and the 1.2 test goes red to green.
   - **(b) owner says accept or defer:** commit a characterization test that pins the current permissive behaviour, with a comment naming the ruling and any spinoff ticket. Otherwise the gap is not "pinned".

   Also raise the escalation as soon as 1.2 has the repro, before 2.1/2.2, because its answer can change scope.
2. **The `pipeline-step-lifecycle` delta contains a deferred-decision placeholder.** "Authorization checks that depend on the calling user … follow the owner's ruling recorded for HEL-1514" is not testable and describes no behaviour. State in design/tasks that the executor replaces this sentence with the ruled behaviour, plus a scenario, once the owner answers (per CR1's branches). Alternatively, remove it from the normative requirement text and keep it in design.md only.
3. **The `pipeline-cast-op` delta contradicts the live spec. It must be a MODIFIED requirement, not ADDED only.** The existing requirement "Frontend cast op renders a field-type table…" (`openspec/specs/pipeline-cast-op/spec.md:65-74`) says the table lists the columns "derived from the analyze endpoint's `inputSchema`" and "If the analyze response returns an empty `inputSchema`, the UI SHALL render an empty table". D3 and the new ADDED requirement ("Every field the stored `casts` map names SHALL have a row, even when the field is absent from the step's input schema") break that whenever `casts` is non-empty. After archive, both requirements would stand and disagree. Add a `## MODIFIED Requirements` block that restates that requirement:
   - rows = schema columns, then stored keys that are not in the schema;
   - the table is empty only when both are empty;
   - the "Empty inputSchema renders empty table" scenario is updated to say `casts` is empty.

### Non-blocking notes

- D1: "If the cast branch of `StepOpEditor` does not render `saveError` today" is resolved: it does not. Be definite. Pass `saveError`/`saveErrorIsValidation` into `CastFieldsConfig` and render `<InlineError id=…>` at the bottom, exactly as `FillNullConfig` does. There is no card-level renderer to "reuse".
- D2: DESIGN.md has no named "field-hint pattern". The in-feature precedent is `pipeline-detail-page__compute-fields-hint` (`ComputeFieldConfig.tsx:90`, `GenerateTextConfig.tsx:94`). Name the class to reuse so the final gate is not judging an invented one. Use `useId`-based hint ids, because several cast cards can be on one page. When a `saveError` is also present, consider describing the legacy row by both ids.
- D4 lane: "the only expected divergence is a lane target deleted" may be incomplete. A trunk reorder could make the lane target an ancestor of the original, and so of the clone, which gives create's 400 cycle message. The fix (calling `validateLaneReference` with `ancestorChainOf(Some(existing.id), current)`) covers it anyway. Either add a scenario or record evidence that it cannot happen.
- D3: orphan keys with a *supported* target (for example a column renamed upstream) will also get rows, with no marker that the field is absent from the input. This is acceptable as stored state, but the final gate will look at it.
- No base-SHA diff was taken. This is the design gate and nothing is implemented yet.
