## Standing Constraints

- [C1] Every seam-test leg (frontend Jest, backend ScalaTest, helio-mcp) must have a recorded red under a key-rename mutation of the fixture's keys, captured as evidence before revert; a leg with no recorded red does not count toward AC5.

## 1. Backend

### Backend
- [x] 1.1 Remove `override def authorable = false` from `JoinStep.companion` (design D1)
- [x] 1.2 Re-pin the unauthorable set to `{groupby}` in `PipelineStepRegistryCatalogSpec` and `PipelineStepCatalogServiceSpec`

## 2. Frontend

### Frontend
- [x] 2.1 Add `join` (`Link2`, "Join tables") to `OP_TYPES` beside union/lookup; delete `JOIN_OP_TYPE` and its `pipelineStepToStep` branch (D2)
- [x] 2.2 Rewrite the stale `OP_TYPES` exclusion comment and the "do NOT mirror join's exclusion" sibling comments (D2)
- [x] 2.3 Add `joinConfigOf` to `stepNarrowing.ts`, mirroring `lookupConfigOf` with full passthrough (D4)
- [x] 2.4 Create `stepConfigs/JoinConfig.tsx`: SecondaryInputPicker, join-key Select with not-in-input option, inner/left toggle + descriptions + unsupported-type notice (D3)
- [x] 2.5 Wire `joinConfig` state and `onJoinChange` into `useStepCardState` (exact key set, no persist on mount) (D4)
- [x] 2.6 Add the `join` branch to `StepOpEditor` (D4)
- [x] 2.7 Add the join clause to helio-mcp `add_pipeline_step` description in `helio-mcp/src/tools/write.ts` (D6)

## 3. Tests

### Tests
- [x] 3.1 Update `stepNarrowing.test.ts` unauthorable expectation to `{groupby}`; add `joinConfigOf` + `pipelineStepToStep("join")` cases
- [x] 3.2 Repoint `StepCard.test.tsx` no-editor fallback tests off join (unsupported/groupby fixture), intent preserved
- [x] 3.3 Add `JoinConfig.test.tsx`: each control, lane passthrough, unknown joinType notice, missing-key option, no persist on mount
- [x] 3.4 Add `shared-test-fixtures/join-step-config.json` (source-kind + lane-kind cases) (D5)
- [x] 3.5 Add frontend seam test asserting persisted body equals each fixture case exactly (D5)
- [x] 3.6 Add backend `JoinStepConfigSeamSpec`: validateRawConfig, wire round-trip, route POST→GET identical (D5)
- [x] 3.7 Add helio-mcp test asserting the join clause names exactly the fixture's keys (D5/D6)
- [x] 3.8 Record seam mutation reds (frontend key rename, backend key rename) in evidence, then revert (D5)
- [x] 3.9 Add `e2e/hel958-join-step-editor.spec.ts` building + running a join through the UI, asserting rows and `right_<name>` (D7)
- [x] 3.10 Run gates: frontend lint/typecheck/jest, helio-mcp tests, `nice -n 19 sbt testFull`, the new e2e spec (servers via start-servers.sh, never bare vite)
- [x] 3.11 Live check vs the running app, light + dark: build a join via the UI, run it, assert real output rows; persist screenshots as evidence (AC6)
- [x] 3.12 Update the stale "picker-excluded" join comment in `PipelineStepRoutesSpec.scala` (~L217)
