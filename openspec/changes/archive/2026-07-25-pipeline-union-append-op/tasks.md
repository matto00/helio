## 1. Backend — core step

- [x] 1.1 `domain/steps/UnionStep.scala`: `UnionConfig(otherDataSourceId, mode)`, tolerant `decode` (defaults `"" `/`"byPosition"`), async `evaluate` via `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource` (mirror `JoinStep`), `byPosition`/`byName` logic per design.md Decisions 2–4, `UnionStep.companion` (`Kind = "union"`). No inline FQNs.
- [x] 1.2 Register `PipelineStepKind.Union`; add `UnionStep`/`UnionConfig` aliases to `domain/package.scala` (mirror `JoinStep`/`JoinConfig`).
- [x] 1.3 Register `UnionStep.companion` in the step registry consumed by `PipelineStepRepository.rowToDomain` (mirror `JoinStep.companion`).

## 2. Backend — protocol, codec, analyze, ACL

- [x] 2.1 `PipelineStepProtocol.scala`: `UnionStepResponse` (`id, pipelineId, position, createdAt, updatedAt, config`), `jsonFormat6`, write/read-side union arms, `fromDomain` — mirror every `JoinStepResponse` touch point.
- [x] 2.2 `PipelineStepConfigCodec.scala`: `encodeConfig`/`extractConfig` arms for `union`.
- [x] 2.3 `PipelineAnalyzeService.scala`: add `"union"` to the passthrough dispatch case (`(inputSchema, None)`) per Decision 6 — a real case, not the unknown-op fallback.
- [x] 2.4 `PipelineAnalyzeProtocol.scala`: `UnionAnalyzeStepResponse` + union-arm dispatch.
- [x] 2.5 `PipelineService.toAnalyzeStepResponse` (exhaustive match): add the `union` arm.
- [x] 2.6 `PipelineService.addStep` AND `updateStep`: add `unionCheckF` pre-flight ACL (`case uc: UnionConfig => dataSourceRepo.findByIdOwned(...)`, 404 on cross-user), mirroring the existing `joinCheckF` arm exactly, per Decision 9 — closes a cross-tenant gap `union` would otherwise ship with (HEL-278 fixed this for `join`; `union` needs the symmetric fix).

## 3. Backend — migration

- [x] 3.1 Re-confirm the current max Flyway migration number via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration — re-derive fresh, don't trust the ticket's guess.
- [x] 3.2 Create `V<NN>__add_union_op.sql` extending `pipeline_steps_op_check` to add `'union'`, following the drop/re-add pattern in `V70__add_stringops_op.sql` (full accumulated op list).

## 4. Frontend

- [x] 4.1 `types/pipelineStep.ts`: `UnionConfig`/`UnionStep`/`UnionAnalyzeStep` types, added to the relevant discriminated unions — mirror every `JoinConfig`/`JoinStep`/`JoinAnalyzeStep` touch point.
- [x] 4.2 `state/stepNarrowing.ts`: add `union` directly to `OP_TYPES` (picker) per Decision 7 (union is NOT excluded like `join` — it ships both the ACL check and a full editor); add `defaultConfigFor` case (`{"otherDataSourceId": "", "mode": "byPosition"}`); add `unionConfigOf` helper.
- [x] 4.3 Create `ui/UnionConfig.tsx`: other-source picker + mode toggle (`byPosition`/`byName`), PATCHing on change; follow DESIGN.md tokens/patterns.
- [x] 4.4 Wire `UnionConfig.tsx` into `StepCard.tsx` + `useStepCardState.ts` (mirror existing op-specific editors).

## 5. MCP

- [x] 5.1 `helio-mcp/src/tools/write.ts`: document `union` + config shape (`otherDataSourceId`, `mode`) in the `add_pipeline_step` tool's description string.

## 6. Tests

- [x] 6.1 `InProcessPipelineEngineSpec.scala`: round-trip execution for both modes, plus missing/invalid-source and unsupported-mode error-path tests.
- [x] 6.2 `PipelineAnalyzeServiceSpec.scala`: passthrough test — no `validationError` for a `union` step.
- [x] 6.3 `UnionConfig` codec round-trip test (encode/decode/tolerant-decode-on-missing-keys).
- [x] 6.4 `PipelineStepSpec.scala`: update kind-parity assertions to include `union`.
- [x] 6.5 `ui/UnionConfig.test.tsx`: co-located test for the new editor (CONTRIBUTING-bound).
- [x] 6.6 Extend an existing `stepNarrowing.ts` test (if one covers `join`'s narrowing) to cover `union`'s default config, `unionConfigOf`, and picker-inclusion.
- [x] 6.7 `PipelineStepRoutesSpec.scala`: mirror the join ACL test pair — "POST union type + cross-user other-source → 404" / "...own other-source → 201" (same `seedDataSource` fixture pattern). Per Decision 9 / task 2.6.
- [x] 6.8 `PipelineStepRoutesSpec.scala`: NEW test (no join equivalent exists) — "PATCH union step config to cross-user other-source → 404", covering the `updateStep` half of task 2.6 that 6.7 doesn't reach; assert persisted config unchanged, per spec.md's "Cross-user union step update returns 404" scenario.

## 7. Delivery hygiene

- [x] 7.1 Re-confirm the Flyway migration number is still free (no collision from a concurrent v1.6 lane) via `ls backend/src/main/resources/db/migration/ | sort` immediately before the delivery push; renumber if another migration landed on the same VNN since task 3.1.
