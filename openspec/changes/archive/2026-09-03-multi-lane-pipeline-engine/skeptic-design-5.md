## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

Read all four prior reports, then re-derived from the artifacts, the live specs and the code.

1. **Both committed checks re-run by me, not trusted.**
   - `python3 openspec/changes/multi-lane-pipeline-engine/tools/check-delta-headers.py` → `MODIFIED/REMOVED not matching a live requirement: 0`, rc=0.
   - `python3 .../tools/check-legacy-field-coverage.py` → `LIVE requirements whose text carries a legacy field name but have NO delta block: 0`, rc=0.
   I read both scripts before running them: they do what they claim (per-requirement split on `^### Requirement: `, live-vs-delta header set comparison; the coverage one keys on requirement *bodies* matching the three-name regex, which is the property round 4 asked for). Note the regex is `rightDataSourceId|otherDataSourceId|referenceDataSourceId` — the third name is `referenceDataSourceId`; round 4's report says `lookupDataSourceId` once, which appears nowhere in the tree. The scripts use the correct name; only round 4's prose was wrong.
   - `openspec validate multi-lane-pipeline-engine --strict` → one RFC-2119 wording WARNING on an ADDED requirement in `pipeline-lane-rejoin-input`. No errors.

2. **Round-4's four `pipeline-union-op` requirements — disposed, and I read the resulting text.**
   `Union op fails descriptively…` is REMOVED + re-ADDED as `…on an unresolvable secondary input or unsupported mode` (correct: its live scenario titles embed `otherDataSourceId`); `analyze-inference`, `Frontend StepCard…`, `MCP add_pipeline_step…` are MODIFIED with bodies rewritten to `secondaryInput`. Delta section census across all 18 files: 19 MODIFIED / 12 ADDED / 4 REMOVED.

3. **Fourth granularity probe A — delta-internal staleness the checks do not grep.**
   18 legacy-name occurrences remain in the deltas. I read every one: all are either scenarios that deliberately test *rejection* of the legacy field (`pipeline-step-config-rejection`, `pipeline-union-op:27`, `pipeline-lookup-op:15`, `pipeline-step-config-read-strictness:33`, `patch-set-apply:26`), explicit "SHALL NOT be accepted / SHALL NOT appear in this contract" prose (`pipeline-run-execution:4`, `pipeline-steps-persistence:4`, `conversational-refinement:4`), or REMOVED-block Reason text. No stale live-shape usage survives.

4. **Fourth granularity probe B — checks neither script performs, run by me.**
   - *ADDED colliding with an existing live requirement* (would duplicate at archive rather than replace): **0 across all 18 deltas.** Neither committed check tests this.
   - *Duplicate requirement headers within a delta file*: **0.**
   - *Scenario preservation on MODIFIED, re-derived independently of round 4*: **0 dropped or renamed-away scenarios across all 19 MODIFIED blocks**; every diff is additive only. (This also disproves round 4's incidental claim that the union StepCard requirement's *scenario titles* embed `otherDataSourceId` — they do not; only the bullet bodies did, and MODIFIED replaces those wholesale. The MODIFIED disposition chosen for it is correct.)

5. **Fourth granularity probe C — live specs describing the join/union/lookup secondary input WITHOUT any of the three names.** This is the class a name-keyed check structurally cannot see, so I keyed a sweep on the concept instead (`join|union|lookup|second(ary) source|right source|…` across every requirement in every live spec, minus the ones already legacy-named and already covered) and read every plausible survivor:
   - `pipeline-run-truncation-reporting` → *"The run row cap is reported, never silently applied"* states `sourceTruncated` SHALL be true for "a secondary source read by a `join`, `union` or `lookup` step", with two scenarios about it, and carries **none** of the three field names — invisible to both checks and unmentioned anywhere in the change. I checked whether it is *falsified*: it is not. It constrains source reads; a `lane`-kind input performs no secondary source read, and the lane's own base-source read is already "a source read performed by the run". Behaviour is preserved, no delta is owed. Recorded as a note, not a CR.
   - `pipeline-joinstep-right-source-acl` → *"Existing join steps evaluate regardless of right-source accessibility"* (privileged unscoped lookup in `JoinStep.evaluate`) is uncovered by the delta and name-free. Still true for `source`-kind; silent about `lane`-kind, where there is no data source to look up. Wording ages, semantics do not. Note.
   - `pipeline-step-config-runtime-completeness` → generic ("required configuration values missing or empty"), its scenarios use `column` and `joinKey`, neither of which this change touches. I confirmed at the implementation level that `JoinStep`/`LookupStep`'s `requiredConfigProblems` check only `joinKey` / `sourceKey`+`lookupKey`, never the secondary id (`JoinStep.scala:107-108`, `LookupStep.scala:127-129`), so the new shape does not interact with it. No delta owed.
   - `workspace-context-assembly` "join hints", `pipeline-shape-registry`, `pipeline-sort-op`, `pipeline-dry-run-ui` — all matched the sweep on the word "join"/"secondary" but none concerns step config. Ruled out by reading.

6. **Fourth granularity probe D — schemas/ and other non-spec surfaces reaching the property another way.**
   `grep -rniE 'rightDataSource|otherDataSource|referenceDataSource|"join"|"union"|"lookup"' schemas/` returns **nothing at all** — independently re-confirming round 3's premise and design.md contract item 5's "`schemas/` is deliberately absent" clause. I then swept the code for the *property* rather than the names: every file mentioning `"join"|"union"|"lookup"|*Config.tsx` in `backend/src/main`, `frontend/src`, `helio-mcp/src`. The files **not** in design.md's enumerated surface list (`PatchSetPreviewProjectionSteps`, `PatchSetApplyResolvers`, `PipelineAnalyzeService`/`Protocol`, `PipelineStepProtocol`, `PipelineStepRepository`, `useStepCardState.ts`, `StepOpEditor.tsx`) were each inspected: none reads or constructs the secondary-source id by any route. `PipelineAnalyzeService` dispatches `union`/`lookup` on op name only and explicitly never resolves the other source. No hidden surface found.

7. **Not reopened, per instruction and my own reading:** Decisions 1/1a/1b and the Engine contract. I read the contract in full anyway; items 6a+10 (membership validation as the justification for switching the ACL off on the lane branch) and item 11's pinned lane-path format are the two places three tickets could have diverged, and both constrain mechanism rather than outcome. Nothing there drives a verdict.

### Verdict: CONFIRM

I looked specifically for a fourth granularity of the recurring failure and probed four distinct candidate classes (delta-internal text, delta-structural checks neither script performs, concept-keyed live specs outside the seven files, and non-spec surfaces). Two live requirements do describe the secondary input without the three field names — so the "a name-keyed check cannot see them" hazard is real and present — but neither is contradicted or falsified by this change, and neither owes a delta. I am not manufacturing a CR out of them.

### Non-blocking notes

- `pipeline-run-truncation-reporting` is the one live capability that specifies join/union/lookup secondary-input behaviour and has no delta and no mention in the change. It is correct as written under the new shape, but the executor should confirm that the truncation-reporting path does not attempt a data-source resolution for a `lane`-kind input when building `truncatedReads` (each entry "naming the data source"). One sentence in the change record would close the audit trail.
- `openspec/specs/pipeline-joinstep-right-source-acl/spec.md:~30` ("right-side source") will sit beside the new `secondaryInput`-phrased requirements post-archive. Not contradictory; consider a cosmetic MODIFIED if the executor wants the file internally consistent.
- `check-legacy-field-coverage.py` treats a requirement as covered if its header appears **anywhere** in the delta, including under `## ADDED`. That is safe today only because I separately verified 0 ADDED-vs-live header collisions; if either invariant is ever lost the check would pass vacuously. Cheap hardening: restrict the `covered` set to MODIFIED/REMOVED sections.
- `pipeline-union-op` delta, "Toggling mode updates the step config": "`{"mode": "byName"}` merged into the existing `secondaryInput` value" reads as merging `mode` *inside* `secondaryInput`, though the requirement body correctly makes them siblings. Inherited verbatim from the live text (which said "…the existing `otherDataSourceId` value") by the name substitution, so pre-existing looseness, not a regression.
- Task 10.2a names the check but not its script path, unlike 10.2a-bis. Both scripts are committed under `tools/`; naming the path in 10.2a would make it as re-runnable as its sibling.
- `openspec validate --strict` RFC-2119 warning on the `pipeline-lane-rejoin-input` ADDED requirement. Cosmetic, third time noted.
- `tasks.md` still lists 9.7 and 9.8 between 9.4 and 9.5. Fourth time noted; cosmetic.
