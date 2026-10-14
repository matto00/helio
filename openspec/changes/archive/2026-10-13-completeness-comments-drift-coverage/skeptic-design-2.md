## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD a67f76b9527ec9ec6aebde9077fdf9dc2caea097. The only difference from that commit is the untracked change dir.

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/completeness-comments-drift-coverage/hel-1467`.
- **Round-1 CR1 (behavioral red) is addressed, and its premise holds on the live tree.** D7(a), task 2.0 and C2 now require recording an exit 0 on the unmodified tree. I ran this myself. I extracted HEAD (`git archive HEAD scripts schemas backend/src/main helio-mcp/src frontend/src`) into a scratch dir. There, `node scripts/check-schema-drift.mjs` exits `base=0`. Removing `oneOf[5]` (the `"form"` branch, 6 branches in total) from `schemas/panels/panel.schema.json` still gives `mutated=0`, with the same "9 surfaces checked / 5 schema enums detected" output. The drift goes undetected today, so the planned red is real and behavioral.
- D7(b)/task 2.1 use a `[]`-returning stub so the self-test loads. The harness (`check-schema-drift.selftest.mjs` L27-35) catches each case and prints `FAIL <name>`, so these are assertion failures, not a module-load error. With the stub, "const group detected" and "unchecked const group errors" fail. The separator case fails too, because current `enumKey` (lib L16-18) is a raw `${file}#...`, so `panels\x` and `panels/x` produce different keys and validation returns a coverage error. The design now says outright that a SyntaxError or missing-export failure does not count.
- **Round-1 CR2 (proposal vs D3) is addressed.** The proposal's Non-goals now allow "at most one behavior-preserving switch of the `upsertsource` arm … made only when proven equivalent". This matches D3. I checked that equivalence is plausible. The codec arm is `c.toJson.compactPrint` (codec L80). `UpsertSourceStep.companion.encodeConfig` is `config.asInstanceOf[UpsertSourceConfig].toJson.compactPrint` (UpsertSourceStep.scala). Both resolve the same companion-scoped implicit format. `PipelineStepKind.UpsertSource` exists (PipelineStep.scala:331), so the Registry form compiles.
- **Round-1 CR3 (L105 count) is addressed.** D3 and task 1.2 now include "the 23 `*Config` case classes" (still present at codec L105). The `encodeConfig` scaladoc also says "adding an 11th config class … is a compile error" (L44-48). That is another stale number, and D3's rewrite of the whole scaladoc covers it.
- Round-1 non-blocking notes are folded in. D5 keys a nested group once, by its innermost combinator. The coverage error text says "enum or const group". D4 filters out `pipeline-op-picker-stability` and expects the no-spec list to grow. D7 requires per-file `git diff --exit-code` after each mutation.
- Items 1-5 are still present in the live tree. `PipelineStepSpec` L12-15 says "sealed trait"/"sealed-trait / PipelineStepKind.All parity", and L128-130 says "fails compilation (sealed-trait exhaustiveness)". README L21/L57-58 say "23 step kinds" and "groupby and join". `PipelineShape.scala:39` says "Single source of truth". `PipelineStepSecondSourceGuardSpec.scala:17` says "the single source of truth every op is registered in". D2's guard claim is accurate: L123-126 asserts `allSubtypes.map(_.kind).toSet shouldBe PipelineStepKind.All`, and the match test at L128+ has no default arm, so an unlisted subtype raises a runtime `MatchError`.
- D5/D6 internal consistency. The detected key for a const group uses the wildcard path `[..., "oneOf","*","properties","type","const"]`. The planned parity surfaces use the same wildcard path through `getConstGroupAt`, so covered and detected keys match. m3 (remove a surface) then shows up as a coverage error. `compareSets` labels a mismatch with the surface label and `missing: form`, which satisfies the ADDED scenario.
- Scope: AC1-AC5 each map to tasks: AC1 to 1.1-1.6, AC2 to the design Context re-derivation, AC3 to 2.2-2.3, AC4 to D6 and the separator case, and AC5 to 2.0, 2.1 and 3.1. HEL-1474 files and rendered Concertino files are excluded (C3). I found no TODO, TBD or deferred blocking decision.

### Verdict: CONFIRM

### Non-blocking notes

- **Task 1.4's verification command is too narrow for AC1's "known layers named".** `git grep -n "PipelineShape.Registry"` finds only backend users of the Registry. Other layers hard-code the shape ids too:
  - `frontend/src/features/pipelines/ui/shapes/ShapePickerModal.tsx:53` (`SHAPE_DISPLAY_ORDER`)
  - `frontend/src/features/pipelines/services/pipelineService.ts:395`
  - `helio-mcp/src/tools/pipelines.ts`
  - `helio-mcp/src/tools/read.ts`

  Re-derive with `git grep -n -l "pivot-matrix" -- ':!openspec/changes/archive'`. The PipelineShape comment should name these layers, or explicitly scope its claim to the backend catalog. The evaluator should check this at the final gate.
- red-evidence.md should state which self-test cases were red against the stub, and why each one was. The "non-combinator consts ignored" case passes against a `[]` stub. That is a guard, not a red, and should be labelled that way.
- Do the D3 equivalence check in a test, not only by reading the code. The `PipelineStepConfigCodecSpec` round-trip case for every typed config should cover an `UpsertSourceConfig`.
