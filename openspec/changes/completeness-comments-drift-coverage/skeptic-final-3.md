## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD 0ff17784c151a1bdddc3f1b79bf3290759d94e6a.

- **Base.** Resolved live with `resolve-review-base.sh <wt> main origin` (exit 0), which returned a67f76b9527ec9ec6aebde9077fdf9dc2caea097.
- **Spawn-cwd guard.** `READY ambient=/home/matt/Development/helio branch=task/completeness-comments-drift-coverage/hel-1467`.
- **UI.** No UI is touched, so the UI step was skipped.
- **Modifications.** I changed nothing in the worktree except this report. The mutation in the drift item below ran in a scratch copy, and `git status --short` was clean afterwards.

### What I verified (with evidence)

- **Round-3 delta (`git diff ebf47ee54..HEAD --stat`).** It touches README.md, comment-verification.md, files-modified.md and the copied skeptic-final-2.md. No Scala or `.mjs` file changed.

- **skeptic-final-2 CR1 (join/upsertsource framing): fixed.** README.md:57-77 no longer says the specs "bless" an empty value. It now says what each spec says: an empty value is tolerated as a savable draft at write/add time, and is still treated as unset-required later. I re-read every quote against its spec file, and each one is verbatim:
  - `pipeline-join-step-editor/spec.md:11-12`: "SHALL NOT be rejected for its empty, not-yet-chosen right input".
  - `pipeline-step-config-validation/spec.md:9`: "...in the same manner as any other unset required field". Its scenario at :21 says the same.
  - `pipeline-step-config-runtime-completeness/spec.md:26-29`: a join with an empty `joinKey` fails, naming it "as the missing required value".
  - `pipeline-upsertsource-config/spec.md:45-46`: "An absent `target` or `mode` SHALL NOT be rejected — an incomplete draft is not a write-time error".
  - `pipeline-upsertsource-config/spec.md:95`: "savable, not runnable".
  - `pipeline-run-execution/spec.md:131-133`: groupby "SHALL contain `groupBy` ... `aggColumn` ... `aggFunction`".

- **No stronger contradicting statement exists in `openspec/specs` (C5, grepped across all specs).**
  - **join and upsertsource.** I grepped every hit for `upsertsource|`join`|join step|joinKey|secondaryInput` that also mentions empty, absent, default, missing or required. Every one treats the empty value as an incomplete draft, which matches the README:
    - `pipeline-step-config-read-strictness:60`: "tolerant default ... incomplete-draft state".
    - `patch-set-apply:51`: "an incomplete draft".
    - `pipeline-joinstep-right-source-acl:50`: an "incomplete-draft exemption".
    - `pipeline-step-preview:159-171`: an upsertsource with an empty `target.name` is rejected at preview.
    - `pipeline-upsertsource-editor:17,46`: a draft add is accepted.

    No spec says an empty join or upsertsource value is a legitimate final configuration.
  - **groupby.** `grep -rn -i 'groupby'` finds three groupby-step hits outside `pipeline-run-execution`:
    - `pipeline-analyze-api:267-301`: the projection of a *valid* config, plus a best-effort fallback for a key absent from the input schema.
    - `pipeline-step-config-validation:49-52`: an unsupported function is reported.
    - `pipeline-join-step-editor:16`: the step is unauthorable.

    The empty-groupBy statements (`pipeline-aggregate-op:85-99`, shape-registry) belong to the `aggregate` kind, not `groupby`. The README sentence "none found states whether an absent or empty value is legitimate" therefore holds, and the word "only" was dropped as requested.

- **CR2 (groupby "only"): fixed.** The README now reads "other specs found by the command below ... none found", with a re-derive command (README:79). comment-verification.md S22b records the search and explains why each hit is excluded.

- **CR3 (commands missing): fixed.** S20, S20b, S21, S21b, S21c, S22, S22b and S23 each carry an exact `sed -n`/`grep` command alongside the output.

- **AC1 / AC2: items 1-5 re-checked at HEAD against the tree.**
  - **Item 1.** `PipelineStepSpec` scaladoc says "NOT sealed". The test is renamed to "each subtype in allSubtypes maps to its kind through a runtime pattern match", with an honest comment about MatchError.
  - **Item 2.** The `encodeConfig` scaladoc now says the match is on `Any` and that the fall-through is a runtime `IllegalArgumentException`.
    - The upsertsource arm now dispatches through the Registry.
    - A new round-trip test (`PipelineStepConfigCodecSpec`, byte-identical to `cfg.toJson.compactPrint`) satisfies C4.
    - The comment's claim that `DraftRoundTripWriteSafetySpec` runs every Registry kind through `encodeConfig` holds: `drafts.keySet shouldBe PipelineStep.Registry.keySet` plus the per-draft `encodeConfig` loop.
  - **Item 3.** README counts are replaced with commands.
    - The Registry count command prints 27.
    - The `-op` spec listing prints 24.
    - The three kinds without an `-op` spec are groupby, join and upsertsource, which I matched by hand.
  - **Item 4.** PipelineShape.scala:39-48 drops "single source of truth". `git grep -l pivot-matrix -- ':!openspec'` returns every named layer: PipelineShapeSpec, PipelineShapeRoutesSpec, ShapePickerModal (`SHAPE_DISPLAY_ORDER` at :53), pipelineService.ts, helio-mcp tools and scripts/verify.ts. The list is marked as examples.
  - **Item 5.** SecondSourceGuardSpec drops "single source of truth". The named frontend files (pipelineStep.ts, stepNarrowing.ts, StepOpEditor.tsx) are all in the output of `git grep -l chunkbytokencount`.

- **AC3 (const-group detection).**
  - `findPanelKindConstGroups` exists in `scripts/lib/panelKindEnumCoverage.mjs` and is wired into the coverage loop in `check-schema-drift.mjs`.
  - Both real groups are parity-checked surfaces: `panel.schema.json oneOf.*.properties.type.const` and `create-panel-request.schema.json allOf.*.if.properties.type.const`.
  - My own probe: both real groups carry `[output,text,markdown,image,divider,form]`, and a bare `anyOf:[{const:text},{const:chart}]` is detected as `anyOf.*.const`.
  - **Independent mutation.** I copied the tracked files to the scratchpad and removed the `form` oneOf branch from panel.schema.json. `node scripts/check-schema-drift.mjs` then exits 1 with "missing: form". red-evidence.md 2.0 records that the base tree exited 0 on the same removal.

- **AC4 (separator-independent keys).** I ran `validatePanelKindEnumCoverage` with detected `a\b.json` and covered `a/b.json`, and it returns `[]`.

- **AC5 (red, guard and mutation evidence).** red-evidence.md has:
  - the behavioral red (2.0, exit 0);
  - 6 FAIL assertion lines against a `[]` stub, with no load error;
  - each case labelled red-vs-stub or GUARD;
  - mutations m1-m5, each with a failing exit and a `git diff --exit-code` restore proof.

- **Gates at this HEAD (run fresh by me).**
  - `node scripts/check-schema-drift.mjs` exits 0: "11 surfaces checked", "7 schema enums/const groups detected, each checked or exempted".
  - `node scripts/check-schema-drift.selftest.mjs` exits 0: "all cases passed".
  - The Scala run was `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.PipelineStepSpec com.helio.api.protocols.pipelines.PipelineStepConfigCodecSpec com.helio.api.protocols.pipelines.PipelineStepSecondSourceGuardSpec *DraftRoundTripWriteSafetySpec"`. Result: "Suites: completed 4, aborted 0", "Tests: succeeded 114, failed 0", "All tests passed". Afterwards I ran `sbt --client shutdown`.
  - `npx prettier --check` passes on the README and the three `.mjs` files.

- **Standing constraints.**
  - **C1:** every new sentence has a command and its output.
  - **C2 and C4:** see AC5 and item 2 above.
  - **C5:** every quote was checked against the spec content, plus an all-specs grep.
  - **C3:** `git diff --name-only a67f76b95...HEAD | grep -i 'scripts/concertino|.concertino|embeddedpostgres'` is empty.
  - **files-modified.md:** `comm -3` against the diff name list is empty, so the list is complete and repo-relative.

### Verdict: CONFIRM

### Non-blocking notes

- **Stale step-file list in the README introduction (not introduced by this change; recommend a Follow-up ticket, relatedTo HEL-1467).**
  - `backend/src/main/scala/com/helio/domain/steps/README.md:3-9` says "one file per step type", then lists 23 `*Step` files.
  - The directory has 27. Missing from the list: `AnalyzeWithAiStep`, `ConvertFormatStep`, `GenerateTextStep` and `UpsertSourceStep`.
  - This is the same staleness as ticket item 3 ("23 step kinds"), but in a list rather than a count. Neither the ticket nor any design artifact cites it, so I do not treat it as an unmet AC.
  - Suggested fix: list all 27 names, or replace the list with an `ls backend/src/main/scala/com/helio/domain/steps/*Step.scala` re-derive command.
- **No gate defect.** None of the reports I drilled into relies on mtime ordering.
