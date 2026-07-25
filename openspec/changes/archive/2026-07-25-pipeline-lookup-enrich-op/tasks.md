## 1. Backend — core step

- [x] 1.1 `domain/steps/LookupStep.scala`: `LookupConfig(referenceDataSourceId, sourceKey, lookupKey, columns)`, tolerant `decode` (defaults `""`/`""`/`""`/`Vector.empty`), async `evaluate` via `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource` (mirror `UnionStep`), single-key left-join/first-match/null-fill/collision logic per design.md Decisions 2–5, `LookupStep.companion` (`Kind = "lookup"`). No inline FQNs.
- [x] 1.2 Register `PipelineStepKind.Lookup`; add `LookupStep`/`LookupConfig` aliases to `domain/package.scala` (mirror `UnionStep`/`UnionConfig`).
- [x] 1.3 Register `LookupStep.companion` in the step registry consumed by `PipelineStepRepository.rowToDomain` (mirror `UnionStep.companion`).

## 2. Backend — protocol, codec, analyze, ACL

- [x] 2.1 `PipelineStepProtocol.scala`: `LookupStepResponse` (`id, pipelineId, position, createdAt, updatedAt, config`), `jsonFormat6`, write/read-side union arms, `fromDomain` — mirror every `UnionStepResponse` touch point.
- [x] 2.2 `PipelineStepConfigCodec.scala`: `encodeConfig`/`extractConfig` arms for `lookup`.
- [x] 2.3 `PipelineAnalyzeService.scala`: add `inferLookup` dispatch case per design.md Decision 7 — appends each name in `columns` typed `string`, collision-safe (`filterNot` + `:+` per column), NOT part of the identity-passthrough group.
- [x] 2.4 `PipelineAnalyzeProtocol.scala`: `LookupAnalyzeStepResponse` + union-arm dispatch.
- [x] 2.5 `PipelineService.toAnalyzeStepResponse` (exhaustive match): add the `lookup` arm.
- [x] 2.6 `PipelineService.addStep` AND `updateStep`: add `lookupCheckF` pre-flight ACL (`case lc: LookupConfig => dataSourceRepo.findByIdOwned(...)`, 404 on cross-user), chained after the existing `unionCheckF` arm, per design.md Decision 9 — closes a cross-tenant gap `lookup` would otherwise ship with (HEL-278 fixed this for `join`, HEL-384 for `union`; `lookup` needs the symmetric fix).

## 3. Backend — migration

- [x] 3.1 Re-confirm the current max Flyway migration number via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration — re-derive fresh, don't trust the ticket's/design's guess.
- [x] 3.2 Create `V<NN>__add_lookup_op.sql` extending `pipeline_steps_op_check` to add `'lookup'`, following the drop/re-add pattern in `V71__add_union_op.sql` (full accumulated op list).

## 4. Frontend

- [x] 4.1 `types/pipelineStep.ts`: `LookupConfig`/`LookupStep`/`LookupAnalyzeStep` types, added to the relevant discriminated unions — mirror every `UnionConfig`/`UnionStep`/`UnionAnalyzeStep` touch point.
- [x] 4.2 `state/stepNarrowing.ts`: add `lookup` directly to `OP_TYPES` (picker) per design.md Decision 8 (not excluded like `join` — ships both the ACL check and a full editor); add `defaultConfigFor` case (`{"referenceDataSourceId": "", "sourceKey": "", "lookupKey": "", "columns": []}`); add `lookupConfigOf` helper.
- [x] 4.3 Create `ui/LookupConfig.tsx`: reference-source picker (mirror `UnionConfig.tsx`'s other-source picker), `sourceKey` `Select` sourced from `analyzeSchema`, `lookupKey` free-text `TextField`, `columns` free-text add/remove row list (mirror `UnpivotConfig.tsx`'s row-add UI shape with `TextField` rows instead of `Select` rows) per design.md Decision 11; PATCHing on change; follow DESIGN.md tokens/patterns.
- [x] 4.4 Wire `LookupConfig.tsx` into `StepCard.tsx` + `useStepCardState.ts` (mirror existing op-specific editors, passing `analyzeSchema` the same way `UnpivotConfig`/`FillNullConfig` receive it).

## 5. MCP

- [x] 5.1 `helio-mcp/src/tools/write.ts`: document `lookup` + config shape (`referenceDataSourceId`, `sourceKey`, `lookupKey`, `columns`) in the `add_pipeline_step` tool's description string.

## 6. Tests

- [x] 6.1 `InProcessPipelineEngineSpec.scala`: round-trip execution — match (only named columns brought in), unmatched (null-fill, row preserved), multiple-matches (first-match, no row multiplication), column-collision (reference value wins), plus missing/invalid-reference-source error-path tests.
- [x] 6.2 `PipelineAnalyzeServiceSpec.scala`: additive-schema test — `columns` appended typed `string`, no `validationError`, for a `lookup` step.
- [x] 6.3 `LookupConfig` codec round-trip test (encode/decode/tolerant-decode-on-missing-keys).
- [x] 6.4 `PipelineStepSpec.scala`: update kind-parity assertions to include `lookup`.
- [x] 6.5 `ui/LookupConfig.test.tsx`: co-located test for the new editor (CONTRIBUTING-bound).
- [x] 6.6 Extend an existing `stepNarrowing.ts` test (if one covers `union`'s narrowing) to cover `lookup`'s default config, `lookupConfigOf`, and picker-inclusion.
- [x] 6.7 `PipelineStepRoutesSpec.scala`: mirror the join/union ACL test pair — "POST lookup type + cross-user reference-source → 404" / "...own reference-source → 201" (same `seedDataSource` fixture pattern). Per design.md Decision 9 / task 2.6.
- [x] 6.8 `PipelineStepRoutesSpec.scala`: NEW test (mirror union's task 6.8, no join equivalent exists) — "PATCH lookup step config to cross-user reference-source → 404", covering the `updateStep` half of task 2.6 that 6.7 doesn't reach; assert persisted config unchanged, per spec.md's "Cross-user lookup step update returns 404" scenario.

## 7. Delivery hygiene

- [x] 7.1 Re-confirm the Flyway migration number is still free (no collision from a concurrent lane) via `ls backend/src/main/resources/db/migration/ | sort` immediately before the delivery push; renumber if another migration landed on the same VNN since task 3.1.
