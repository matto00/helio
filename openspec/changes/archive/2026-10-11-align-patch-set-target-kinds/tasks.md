## Standing Constraints

- [C1] Red first: every new/changed test is shown failing on the pre-change tree (or under mutation for GUARD tests) with the transcript saved under `.concertino/runs/HEL-1459/evidence/`.
- [C2] Do not edit `PatchSetPreviewProjection*.scala` (concurrent lane HEL-1485).
- [C3] No new apply/preview capability and no per-kind UI; `output` create remains rejected.
- [C4] Refinement prompt change is limited to the kind list (adds `output`); no `parentId`/pipelineStep-create prompt change (owner decision, follow-up).

## 1. Backend single source and consumers

- [x] 1.1 Add `PatchSetTargetKinds` (`All`, `AllSet`, prose helpers) and verify it compiles.
- [x] 1.2 `PatchSetProtocol.recognizedKinds` reads `PatchSetTargetKinds.AllSet`; verify existing PatchSetProtocol specs still pass.
- [x] 1.3 `AssistantProposalToolSchemas`: tool-schema kind enum from `All`; `propose_patch_set` description built from `All` (now names `output`); verify with the guard in 3.1.
- [x] 1.4 `RefinementEditShape.Skeleton`: kind list from `All` (gains `output`; NO `parentId` line); verify `RefinementEditShapeSpec` and `AssistantSystemPromptSpec` pass and guard 3.1 covers it.

## 2. Schemas, frontend, MCP

- [x] 2.0 New backend spec validating a real `output`-update preview response against `patch-set-preview-response.schema.json` via `JsonSchemaValidation` (not in a `PatchSetPreviewProjection*` file); record it RED before the enum fix, GREEN after.

- [x] 2.1 `patch-set-preview-response.schema.json`: add `output` to `EditPreview.kind.enum`; fix stale description text (also in apply-response if stale); verify schema-drift pre-commit check and any preview schema-validation spec pass.
- [x] 2.2 Frontend `patchSet.ts`: `PATCH_SET_TARGET_KINDS`, `PatchSetTargetKind`, `EditTarget.kind` derived, `parentId?: string`; verify `npm run typecheck`.
- [x] 2.3 Update `PatchSetReview.test.tsx` `dataType` fixtures to a live kind; verify that test passes.
- [x] 2.4 helio-mcp: export a `PATCH_SET_TARGET_KINDS` const used by the zod enum (and `types.ts` if no cycle); verify helio-mcp build/tests.

## 3. Guards (red by mutation)

- [x] 3.1 Backend `PatchSetTargetKindsSchemaGuardSpec` (labelled GUARD) per design D4; run it, then record mutation runs (drop a kind from `All`; drop `output` from one schema enum; remove `output` from the description) each going red, and restore.
- [x] 3.2 Frontend `patchSetTargetKinds.guard.test.ts` (labelled GUARD) + compile-time `@ts-expect-error` check for `dataType`; record red on the pre-change tree and under mutation.
- [x] 3.3 helio-mcp guard test (labelled GUARD); record mutation red.

## 4. Verification

- [x] 4.1 Run backend patch-set + assistant specs (`sbt "testOnly ..."`, MemAvailable check, `nice -n 19`), `AssistantSystemPromptSpec` included, frontend `npm test` for patchSets/assistant, `npm run lint`, `npm run typecheck`, helio-mcp tests; save transcripts to the run evidence dir.

- [x] 1.5 `scripts/check-schema-drift.mjs`: resolve the tool-schema kind enum from `PatchSetTargetKinds.All` (design D7); verify `node scripts/check-schema-drift.mjs` and its selftest pass.
- [x] 1.6 Use `PatchSetTargetKinds.AllList` in the decoder error message; import `Pattern` in the guard spec (evaluation-1 CR1/CR2).
