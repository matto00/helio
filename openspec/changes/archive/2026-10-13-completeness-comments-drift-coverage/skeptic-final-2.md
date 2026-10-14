## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD ebf47ee54cc2ab43b3830db89bc10e6f2e5982a0. The base was resolved live with `resolve-review-base.sh` (main/origin), which returned a67f76b9527ec9ec6aebde9077fdf9dc2caea097 (exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/completeness-comments-drift-coverage/hel-1467`. No UI is touched, so the UI step was skipped. I modified nothing except this report.

### What I verified (with evidence)

- **Round-2 delta (`git diff 8f745e894..HEAD`).**
  - The only code-tree change is `backend/src/main/scala/com/helio/domain/steps/README.md:57-67`.
  - The rest of the delta: comment-verification.md (S20-S22), tasks.md (C5), files-modified.md, and two copied reports.
  - No Scala or .mjs file changed since round 1.
- **The quotes in the README are verbatim.** I checked each against the spec file:
  - `openspec/specs/pipeline-upsertsource-config/spec.md:45-46`: "An absent `target` or `mode` SHALL NOT be rejected — an incomplete draft is not a write-time error."
  - `openspec/specs/pipeline-join-step-editor/spec.md:9-11`: adding a join step "SHALL succeed with the seed config … and SHALL NOT be rejected for its empty, not-yet-chosen right input."
  - `openspec/specs/pipeline-run-execution/spec.md:131-133`: "The config SHALL contain `groupBy` … `aggColumn` … `aggFunction`".
- **What the README concludes from those quotes is not accurate.** See CR1 and CR2.
- **Drift gate, fresh at HEAD.**
  - `node scripts/check-schema-drift.mjs` exits 0: "11 surfaces checked", "7 schema enums/const groups detected, each checked or exempted".
  - `node scripts/check-schema-drift.selftest.mjs` exits 0, with 22 `ok` lines and "all cases passed".
  - The round-1 behavioral red and my own mutations (a) and (b) still apply. No script changed since round 1, which I confirmed by diffing 8f745e894..HEAD over `scripts/`.
- **Scala specs, fresh run.**
  - Command: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.domain.model.PipelineStepSpec com.helio.api.protocols.pipelines.PipelineStepConfigCodecSpec com.helio.api.protocols.pipelines.PipelineStepSecondSourceGuardSpec *DraftRoundTripWriteSafetySpec"`.
  - Result: "Suites: completed 4, aborted 0", "Tests: succeeded 114, failed 0".
- **AC1-AC5 for items 1, 2, 4, 5 and the tooling.** These are unchanged since round 1, where I traced each one to code. Nothing in the delta touches them, and the evidence is still valid at this HEAD.
- **Prettier.** `npx prettier --check` passes on the README and the three changed .mjs files.
- **files-modified.md.** `comm -3` of `git diff --name-only a67f76b95...HEAD` against the listed paths is empty, so the list is complete and repo-relative. This resolves the round-1 note.
- **C3.** The diff contains no `scripts/concertino`, `.concertino` or EmbeddedPostgres path.

### Verdict: REFUTE

### Change Requests

1. **`backend/src/main/scala/com/helio/domain/steps/README.md:58-63`: "For `join` and `upsertsource` the requiredness statements live in other specs, and both bless an empty or absent value" is misleading for `join`, and it omits the spec that actually governs join requiredness.**
   - **Where the sentence sits.** It follows the HEL-814 table, where "blesses the empty or absent value" means the empty value is a *legitimate final* value. Those are the "not required" fields.
   - **What the governing spec says.** `openspec/specs/pipeline-step-config-validation/spec.md:9` explicitly calls join's input required:
     - "Validation of a `join`, `union` or `lookup` step config at analyze time SHALL report, as named config problems, a `secondaryInput` that is absent …"
     - "A `source`-kind input with an empty `dataSourceId` SHALL be reported as an incomplete configuration in the same manner as any other unset required field".
     - The scenario at :19-21 repeats this: "consistent with other unset required fields".
   - **The same holds for upsertsource.** `pipeline-upsertsource-config/spec.md:95` says the incomplete draft "SHALL remain an incomplete draft (savable, not runnable)".
   - **What the cited specs actually bless.** Both bless the empty value as a *savable draft*: it is not rejected on write or add. Neither blesses it as a legitimate configured value, which is the category of the HEL-814 eight.
   - **Why it matters.** A reader deciding whether `join.secondaryInput` is required is told the spec blesses an empty value. The analyze-time spec says the opposite.
   - **Fix.** Say what the specs say. For join and upsertsource:
     - an empty or absent value is tolerated as an incomplete draft at write/add time (cite the two lines already quoted);
     - for join it is still an unset required field at analyze/run time (cite `pipeline-step-config-validation/spec.md:9`);
     - for upsertsource it is "savable, not runnable" (cite `pipeline-upsertsource-config/spec.md:95`).
   - **Evidence.** Add an S-entry with a command and output for each new sentence.
   - **Note.** This framing came partly from my own round-1 fix suggestion, which cited only the write-path lines. That suggestion was incomplete. The executor should not treat it as the authority.

2. **README.md:63: "For `groupby`, the only statement is in `pipeline-run-execution`" is a new completeness claim with no supporting search.**
   - S22 quotes the one spec and does not search the others. That is the "no completeness claim" pattern AC1 forbids.
   - Other groupby config statements exist: `openspec/specs/pipeline-analyze-api/spec.md:267-300` (valid-config / groupBy-column-not-in-input requirements) and `pipeline-step-config-validation/spec.md:49-52` (an unsupported aggregation function is reported).
   - None of them states requiredness, so the conclusion survives. The word "only" does not.
   - **Fix (either option):**
     - (a) Drop "the only statement is in" and phrase it as "`pipeline-run-execution` says … ; no spec found says whether an absent or empty value is legitimate (re-derive: `grep -rln -i 'groupby' openspec/specs`)".
     - (b) Keep the claim, and record in comment-verification.md the search command, its full output, and why each hit is not a requiredness statement.

3. **`comment-verification.md` S20-S22 record output only, with no command.**
   - C1 requires "a verification command and its output".
   - **Fix.** Add the exact command for each, for example `sed -n '45,46p' openspec/specs/pipeline-upsertsource-config/spec.md`, and do the same for the entries CR1 and CR2 add.

### Non-blocking notes

- The C5 sentence in tasks.md is good, but C5 checks only that a quote matches the spec text. CR1 is a case where the quote is verbatim and still misleading because a stronger statement exists elsewhere. Consider broadening C5: for any requiredness or behavior claim, grep all specs for the field or kind, not only the one cited.
- No gate defect: no report I drilled into relies on mtime ordering.
