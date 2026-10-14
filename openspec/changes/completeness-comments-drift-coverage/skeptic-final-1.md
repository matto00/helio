## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 8f745e8946adbefd7571b500870f454f2278c4bb. The base was resolved live with `resolve-review-base.sh`, which returned a67f76b9527ec9ec6aebde9077fdf9dc2caea097 (exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/completeness-comments-drift-coverage/hel-1467`. No UI is touched, so the UI step was skipped. The worktree was never mutated: `git status --short` before and after shows only the untracked evaluation-3.md.

### What I verified (with evidence)

- **Drift gate.** Fresh at HEAD:
  - `node scripts/check-schema-drift.mjs` exits 0: "11 surfaces checked", "7 schema enums/const groups detected".
  - `node scripts/check-schema-drift.selftest.mjs` exits 0, with 22 `ok` lines and no FAIL.
- **Behavioral red (AC5).** Reproduced in scratch copies made with `git archive`, never in the worktree. I removed the `form` branch (index 5) of `panel.schema.json` `oneOf`:
  - base a67f76b95: exit 0, "9 surfaces checked / 5 schema enums detected". The drift goes undetected.
  - HEAD: exit 1, with `schemas/panels/panel.schema.json oneOf.*.properties.type.const: missing: form`.
- **Mutations of my own (scratch copy at HEAD):**
  - (a) Reverted `enumKey` to the raw `${file}#`. The self-test exits 1, and only the Windows-key case fails. This reproduces m4.
  - (b) Removed the create-panel-request `allOf` const surface, a variant of m3 that red-evidence.md does not include. The drift check exits 1, with a coverage error naming `create-panel-request.schema.json#allOf.*.if.properties.type.const`.
  - The red-vs-guard labelling in red-evidence.md is honest. The "consts outside a combinator" case is labelled GUARD, and m5 makes it failable. This resolves the design-gate note.
- **AC3.** I scanned for panel-kind consts independently with `grep '"const"'` over schemas/ for the panel-kind values. Hits are in only three files:
  - `panel.schema.json` and `create-panel-request.schema.json`: both are covered surfaces.
  - `data-source.schema.json`: its "text"/"image" consts sit behind `$ref` branches, so the detector does not see them. `findPanelKindConstGroups` returns `[]` for this file. That is the documented `$ref` limit, and the union is a source-type union, not a panel-kind one.
  - The `create-panel-request` `allOf` `if` consts and the `panel.schema` `oneOf` consts each equal the six canonical kinds.
- **AC4.** `enumKey` normalizes `\` to `/`, and mutation (a) shows the self-test pins it.
- **Backend tests.** `nice -n 19 sbt -J-Xmx3g "testOnly PipelineStepSpec PipelineStepConfigCodecSpec PipelineStepSecondSourceGuardSpec DraftRoundTripWriteSafetySpec"` ran 114 tests in 4 suites with 0 failed and guard `failed=0 aborted=0`. A separate `-z upsertsource` run executed the new round-trip test (1 succeeded), so the result was not replayed from sbt's cache. That test resolves the design-gate note: it pins byte-identity between the Registry-form arm and the old arm.
- **Item 1 (PipelineStepSpec).** The "sealed" and "compile" claims are gone. `PipelineStepKind.All` is `PipelineStep.Registry.keySet` (PipelineStep.scala:374), so the parity test is the one that fails for a registered kind missing from `allSubtypes`. The comment is accurate.
- **Item 2 (codec).** The `encodeConfig` scaladoc claims are true:
  - The match is on `Any` and ends in a `case other` that throws `IllegalArgumentException`.
  - `DraftRoundTripWriteSafetySpec`:51 asserts `drafts.keySet shouldBe PipelineStep.Registry.keySet`, and :58 calls `encodeConfig`.
  - `PipelineStepConfigCodecSpec`:397 is a hand-listed round-trip case.
  - The count command prints 27.
  - The `upsertsource` arm now uses the Registry form, and the stale "23" and "11th" counts are gone.
  - A grep for `single source|exhaustiv|compile error|sealed|N step kinds` over the five sites found only accurate remaining hits. Codec L148 says "compiler still enforces exhaustiveness", which is true: `configValue` is abstract, so a new subtype must implement it.
- **Item 4 (PipelineShape).** Every named layer appears in `git grep -l "pivot-matrix" -- ':!openspec'`: PipelineShapeSpec, PipelineShapeRoutesSpec, ShapePickerModal:53 `SHAPE_DISPLAY_ORDER`, pipelineService.ts, helio-mcp tools/pipelines.ts and tools/read.ts, and scripts/verify.ts. `PipelineShapeService`:41 reads `Registry`. The design-gate note on the layer list is resolved, and the list is marked as examples.
- **Item 5 (SecondSourceGuardSpec).** The three named frontend files exist and contain `chunkbytokencount`. `PipelineStepKind.All`'s scaladoc (PipelineStep.scala:337-371) does name the hand-enumerated layers.
- **Item 3 (README).** The counts are correct: 27 registered kinds and 24 `pipeline-*-op` specs. The kinds with no `-op` spec are exactly groupby, join and upsertsource. **The guidance sentences around them are wrong, though. See CR1.**
- **C3.** The diff touches no `scripts/concertino`, `.concertino` or EmbeddedPostgres path. Prettier `--check` passes on the changed .mjs files and the README. `check:openspec` is clean.

### Verdict: REFUTE

### Change Requests

1. **`backend/src/main/scala/com/helio/domain/steps/README.md:57-65` makes a new false claim, and the claim misdirects the exact decision this README exists to guide.** This fails AC1: the rewritten comment contains a factual claim that the specs do not back.
   - **What it says.** join and upsertsource each have "no `-op` spec governing the requiredness of its config fields". It then says: "For all three, prefer the conservative (optional) reading until a spec exists."
   - **Why that is wrong.** The README's own rule (L18-22) is to look for a shipped capability spec that "explicitly blesses the empty or absent value". Such specs exist for both kinds:
     - `openspec/specs/pipeline-upsertsource-config/spec.md:45-46`: "An absent `target` or `mode` SHALL NOT be rejected — an incomplete draft is not a write-time error."
     - `openspec/specs/pipeline-join-step-editor/spec.md:9-11`: adding a join step "SHALL succeed with the seed config `{"secondaryInput": {"kind": "source", "dataSourceId": ""}, "joinKey": "", "joinType": "inner"}` and SHALL NOT be rejected for its empty, not-yet-chosen right input."
   - **Why the evidence missed it.** `comment-verification.md` S12/S17 checked only that the spec directory names exist, never what they say about requiredness. So these sentences have no verification command for the claim they actually make.
   - **Fix.** Keep the accurate snapshot "these three kinds have no `pipeline-<kind>-op` spec". Then say where each kind's requiredness is actually stated, citing the two lines above for upsertsource and join. Restrict the "no governing statement; prefer optional until a spec exists; see HEL-900" guidance to `groupby`. Add a verification command for each new sentence to `comment-verification.md`, for example a `grep -n "SHALL NOT be rejected"` over those two spec files.

### Non-blocking notes

- **README:63, "For `groupby` … no governing statement at all".** This matches HEL-814's citation-column meaning: no statement on whether an absent or empty value is legitimate. However, `openspec/specs/pipeline-run-execution/spec.md:131-133` does say "The config SHALL contain `groupBy` … `aggColumn` … `aggFunction`". Dropping "at all", or scoping the sentence to "no statement on whether absent/empty values are legitimate", would avoid a second completeness-style overstatement.
- **`files-modified.md` is incomplete.** It omits change-dir files that are in the diff: proposal.md, design.md, ticket.md, `.openspec.yaml`, `specs/schema-drift-panel-kind-coverage/spec.md`, evaluation-2.md, skeptic-design-1.md and skeptic-design-2.md. The paths it does list are repo-relative.
- No gate defect: no report I drilled into relies on mtime ordering.
