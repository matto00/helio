## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 62164029270bcaadfc0fde2b0f43263cd1314b03. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

**Round-1 CR1 (the union red-first harness) is addressed in substance.**
- design.md D3 and tasks 1.1-1.3 now specify `InProcessPipelineEngine.executeTree` and explicitly exclude `executeWithStepCounts`.
- I checked that `executeTree` resolves a lane-kind union purely:
  - `InProcessPipelineEngine.scala:426` builds the context with `resolveLane = stepId => nodeOutcomes.get(StepKey(stepId)).map(_.rows)`.
  - `isReady` waits on the lane dependency, so the lane is evaluated first.
  - The only repo calls on the walk are `stepRepo.trunkOfRoot`, which is pure over the `steps` vector (`PipelineStepRepository.scala:1222`), and the source loads, which are not reached when every input is lane-kind.
  - `UnionStep.evaluate` takes the `Lane` branch through `ctx.resolveLane` (`UnionStep.scala:80-88`).
- Precedent already exists: `InProcessPipelineEngineTreeWalkSpec.scala:27-50,227-238` runs lane-kind unions with `new PipelineStepRepository(null)` and `new DataSourceRepository(null)`. The proposed harness works without a DB.
- C1 and task 1.3 now require the red evidence to show that the analyze assertion is the failing one and that the run-side assertion passed, with no "Lane reference not found" error. This closes the counterfeit-red risk.
- The fixture is feasible. `CastStep.scala:88` keeps an epoch string under `timestamp`, so a cast-to-timestamp lane unioned with a cast-to-integer lane really does put numbers under `ts`.

**Round-1 CR2 (the source-kind secondary) is addressed: option (b) was taken and recorded everywhere CR2 asked.**
- I re-confirmed the gap:
  - `secondarySourceIdOf` covers join and lookup only (`PipelineAnalyzeService.scala:196-201`).
  - `sourceDependencyOf` covers join only (`:247-251`).
  - `processNode` resolves the secondary only through those two (`:300-301`).
- The gap is now recorded in:
  - proposal "Known gap"
  - design Goals ("lane-kind union only")
  - design Non-Goals
  - the D2 "Known gap" paragraph
  - the MODIFIED requirement
  - the ADDED requirement and its scenario "A source-kind secondary is not checked"
  - task 3.1, which pins the gap with a guard test
  - task 4.1 (the doc rewrite)
  - the PR OWNER REVIEW section, per design
- The Goals text no longer overclaims.

**Round-1 CR3 ("reject" overstated) is addressed.**
- proposal "What Changes", design "What this does NOT do", the spec requirements, task 4.1 and the Migration Plan's doc text all now state four facts:
  - `canRun:false` only hides "Run to update".
  - Run pipeline and Dry run ignore it.
  - Scheduled and auto runs are not gated.
  - The projection stays `timestamp`, so the downstream `+` disagreement remains.
- I re-checked the footer citations live. `PipelineDetailFooter.tsx:149` has `{costVerdict.canRun && (`. Lines 317-331 show the Dry run and Run pipeline buttons disabled only on `runStatus`.

**The new MODIFIED requirement matches shipped behaviour.**
- Its header matches `openspec/specs/pipeline-union-op/spec.md:38` exactly, so the delta will apply.
- Its content matches `MultiInputSchemaInference.inferUnion`:
  - `Some(secondary)` gives `inputSchema ++ secondary.filterNot(existing names)`, so the parent wins on a name collision.
  - `None` gives a passthrough with no error.
- The dispatch is a dedicated case (`StepSchemaInference.scala:39`).
- The lane scenario `{a,b} + {a,c} -> a,b,c` is correct under this code.

**Round-1 non-blocking notes:**
- The AnalyzeSchemaWarnings suppression is now listed in Risks.
- The D1 "absent column" guard has been added to task 3.1.
- The stale passthrough requirement is now handled by the MODIFIED delta.

**Facts carried over from round 1 still hold:**
- `fillnull` is in the identity arm (`StepSchemaInference.scala:27`).
- mean/median coerce through `toDouble` (`FillNullStep.scala:175-190`).
- `FillNullConfig.decode` is tolerant (`:27-32`).

### Verdict: CONFIRM

### Non-blocking notes
- Some "reject" wording is left over. The proposal's Capabilities line says "analyze rejects `mean`/`median`", and the D1/D2 headings say "rejected at analyze". The bodies are accurate. Reword to "flags" when convenient so the owner-facing summary is consistent.
- The design says the source-kind gap is "filed as a follow-up ticket", but no task in tasks.md files it or adds the OWNER REVIEW PR text. The orchestrator must own both at delivery. Do not lose them.
- D2's reverse direction (parent numeric, secondary timestamp) goes slightly past the ticket's literal case. It is justified (it is the same disagreement) and is flagged as an assumed product call. It does widen the set of existing pipelines that newly show a step error. Say so in OWNER REVIEW.
- design.md says source-union `AnalyzeSchemaWarnings` behaviour "changes" if the gap is closed. Today `secondarySourceIdOf` excludes union, so the follow-up should verify that claim rather than inherit it.
