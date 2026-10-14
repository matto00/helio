## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: aff0e753929f34dd62789f4346de061ab8bacc0d (base a67f76b9527ec9ec6aebde9077fdf9dc2caea097, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

- AC2 (re-derived against the current tree): PASS. design.md records the premise re-check at a67f76b95, and I confirmed each item independently: `PipelineStep.scala:39` is `trait PipelineStep {`, the Registry has 27 `->` entries, and the stale "NOT in Registry" / "compile error" / "23 step kinds" / "single source of truth" texts are on the base side of the diff.
- AC3: PASS. `findPanelKindConstGroups` detects exactly two groups under `schemas/` today (`panels/panel.schema.json#oneOf.*.properties.type.const`, `panels/create-panel-request.schema.json#allOf.*.if.properties.type.const`; I enumerated these myself), and both are parity surfaces in `check-schema-drift.mjs`.
- AC4: PASS. `enumKey` normalizes `\` to `/`, and the self-test covers both the covered and the exempted paths.
- AC5: PASS. I re-ran this myself (details in Phase 2).
- C3: PASS. No Concertino rendered file and no EmbeddedPostgres/HEL-1474 file is in `git diff --name-only`.
- C4: PASS. red-evidence.md labels each case red-vs-stub or GUARD (and m5 makes the guard failable). The upsertsource arm switch has the round-trip + byte-identity test at `PipelineStepConfigCodecSpec.scala:430-437`. I confirmed equivalence: `UpsertSourceStep.scala:69` encodes with `config.asInstanceOf[UpsertSourceConfig].toJson.compactPrint`, which is the old arm's body.
- **AC1 / C1: FAIL.** Two issues, both in rewritten comments:
  1. `PipelineStepSecondSourceGuardSpec.scala:17-20` claims "other layers keep their own per-kind lists" and gives `git grep -l 'PipelineStep.Registry\|PipelineStepKind.All' -- backend/src/test frontend/src helio-mcp/src` to "re-derive them". That command finds files that *consume* the Registry, which is the opposite of files that keep their own hand-written per-kind lists.
     - Measured: across `frontend/src` and `helio-mcp/src` the command returns 1 file.
     - A kind-id probe (`git grep -l chunkbytokencount -- backend/src frontend/src helio-mcp/src`) returns 35 files, including `frontend/src/features/pipelines/types/pipelineStep.ts`, `state/stepNarrowing.ts` and `ui/StepOpEditor.tsx`, none of which the given command finds.
     - So the re-derive command does not derive what the sentence says it does, and the known layers are not named. The HEL-1156 standard requires both.
     - comment-verification.md S16 only verifies the first half ("this spec iterates Registry"). The listed output of the second command is a set of Registry consumers, which does not support the "own per-kind lists" claim.
  2. `backend/src/main/scala/com/helio/domain/steps/README.md:120-121` (diff hunk @@ -54): "`join` has `pipeline-join-step-editor`, `-column-collision` and `-joinstep-right-source-acl`". Read as suffixes of `pipeline-join`, the third gives `pipeline-join-joinstep-right-source-acl`, which does not exist. The real spec is `pipeline-joinstep-right-source-acl` (comment-verification.md's own `ls` output shows it). This is a factual error in a rewritten sentence.

All other items 1-5 meet the standard. I spot-checked S1, S3, S5, S6, S8, S9, S11/S12 (24 `-op` specs; groupby/join/upsertsource have none, and the hyphenated spec names map to the 27 registered kinds) and S15 against the tree. They hold. The `DraftRoundTripWriteSafetySpec` claim is true: L51 pins `drafts.keySet == Registry.keySet` and L58 calls `encodeConfig` on every draft.

### Phase 2: Code Review — PASS

Gates I ran myself in WORKTREE_PATH at aff0e7539 (fresh runs, not the executor's report):
- Backend `sbt testFull`, run as 6 foreground shards (`HELIO_TEST_SHARD_INDEX=0..5 HELIO_TEST_SHARD_COUNT=6 nice -n 19 sbt -J-Xmx3g testFull`). Every shard exited 0 with `[hel1468-guard] failed=0 aborted=0`. Totals: 1527 + 1110 + 1484 + 1409 + 1224 + 1304 = 8058 tests, 611 suites, 0 failed (4 canceled in shard 5, pre-existing).
  - The new test "round-trip through encodeConfig for an upsertsource config" and the renamed "each subtype in allSubtypes maps to its kind through a runtime pattern match" both appear as passed.
- `npm run check:schemas` exits 0 ("11 surfaces checked", "7 schema enums/const groups detected").
- `check:schemas:selftest`, `check:openspec`, `check:spec-structure`, `check:scala-quality`, `check:repo-integrity`, `npm run lint` and `npm run format:check` all exit 0.
- Prettier and eslint (`--max-warnings=0`) on the three touched `.mjs` files are clean.
- No `frontend/**` change, so the frontend build and jest gates are not triggered.

Behavioral red and mutations, re-run by me in throwaway detached worktrees (both removed afterwards):
- Red (2.0): base a67f76b95 with panel.schema.json's `form` oneOf branch removed (6 -> 5 branches) runs `node scripts/check-schema-drift.mjs` to **exit 0** (5 enums detected, drift undetected). The same mutation at aff0e7539 gives **exit 1**, `schemas/panels/panel.schema.json oneOf.*.properties.type.const: missing: form` (this is m2).
- Stub red (2.1): `findPanelKindConstGroups` made to `return []` plus `enumKey` un-normalized gives exactly the 6 FAIL assertion lines red-evidence.md records, with no load error. This combines m1 and m4.
- m3: removing the panel.schema.json const surface makes coverage name `schemas/panels/panel.schema.json#oneOf.*.properties.type.const`, exit 1.
- m5: lowering the threshold to `>= 1` makes the GUARD case "consts outside a combinator ... are ignored" FAIL.
- Each mutation was restored and `git status --short` was clean afterwards.

Code quality:
- `findPanelKindConstGroups` and `collectBranchConsts` are small and pure. `getConstGroupAt` fails loudly on an empty or non-string path, so the surface cannot become vacuous.
- The coverage contract is unchanged.
- No dead code, no `any` (JS), no over-engineering.
- The stated `$ref` limit is documented in the lib header.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed (change-local spec deltas only).

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala:17-20`: replace the parenthetical "(other layers keep their own per-kind lists; re-derive them with `git grep -l 'PipelineStep.Registry\|PipelineStepKind.All' ...`)" with text that is true and has a working re-derive command:
   - Point to the hand-enumerated layer list in `PipelineStepKind.All`'s scaladoc (`PipelineStep.scala` ~L335-350), or name the known layers (backend codec/protocol unions, frontend `features/pipelines/types/pipelineStep.ts`, `state/stepNarrowing.ts`, `ui/StepOpEditor.tsx`, and so on).
   - Use a kind-id grep as the re-derive command, e.g. `git grep -l 'chunkbytokencount' -- backend/src frontend/src helio-mcp/src`.
   - Update comment-verification.md S16 with a command whose output actually supports the sentence (C1).
2. `backend/src/main/scala/com/helio/domain/steps/README.md` (the "`join` has ..." sentence, ~L120): write the third spec name in full as `pipeline-joinstep-right-source-acl`, because as a suffix of `pipeline-join` it names a spec that does not exist. Record the verifying `ls openspec/specs | grep -- '^pipeline-join'` in comment-verification.md.

### Non-blocking Suggestions
- `PipelineShape.scala` comment: the `pivot-matrix` re-derive also returns `CreateStepConfigNonRegressionSpec.scala`, `PivotMatrixShape*Spec.scala` and `helio-mcp/src/tools/read.ts`, which the prose list does not name. That is acceptable because the comment says to re-derive, but adding "(and others)" or dropping the enumerated list in favor of the command would avoid a reader treating the list as complete.
- `validatePanelKindEnumCoverage` normalizes detected/covered keys but checks `key in exemptions` against the raw exemption key. A hand-written `\` exemption key would read as stale. This is harmless today (empty table, keys written with `/`) but could be noted in the `enumKey` doc ("exemption keys must be written with `/`"), since the current doc says every exemption key "goes through here", which is not literally true.
