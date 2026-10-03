## 1. Red first
(Run 1.1 before touching LookupStep.)
- [x] 1.1 Add `LookupColumnCollisionSpec` (runtime + analyze) with a collision case; run on unmodified main logic and record the red output

## 2. Implementation
- [x] 2.1 Add `JoinColumnNaming.resolveWithKey` core (design Decision 4); `resolve` delegates; helper tests incl. `droppedKey = None`
- [x] 2.2 Use it in `LookupStep.evaluate` (Decisions 1-5), including the unmatched-row and key-only cases
- [x] 2.3 Use it in `PipelineAnalyzeService.inferLookup` (Decision 6)
- [x] 2.4 Update existing tests/spec text asserting overwrite; update `steps/README.md` and the stale `LookupStep`/`inferLookup` doc comments
- [x] 2.5 Grep frontend/helio-mcp/ProvenanceService/PatchSetPreviewProjectionSteps/PipelineCostEstimator for client-side lookup column computation; align any mirror

## 3. Verification
- [x] 3.1 Parity test (runtime `LookupStep.evaluate` vs `analyzeNodes`) for: no collision, single, several, `right_x` on left, on right (requested columns include both `x` and `right_x`: x -> right_x_2, right_x unchanged), on both, key only, and sourceKey != lookupKey with `lookupKey` requested; both lane-kind and source-kind secondaries; the lane-kind case asserts types stay keyed by the ORIGINAL requested name, not the renamed one
- [x] 3.2 Mutation: disable prefixing in the shared core `resolveWithKey` (so both join and lookup go red), show lookup AND join tests red, restore
- [x] 3.3 Read-only dev-DB inventory of lookup steps with collisions (exact SELECTs, no writes); report table
- [x] 3.4 Full backend gate `cd backend && nice -n 19 sbt testFull`
- [x] 3.5 PR body: what bound Outputs/panels now read (verified against code), key semantics, Spark/secondarySourceSchemas findings

## Standing Constraints
- [C1] Backend gate is `cd backend && nice -n 19 sbt testFull` (never bare `sbt test`), one full suite at a time; run `sbt --client shutdown` and `cleanup.sh --phase4` as separate calls; known flakes (HEL-1228/1225, HEL-1215, HEL-1247) are reported by name.
- [C2] Dev DB access is read-only with exact SELECTs; any cleanup uses exact ids only, never disabling triggers/FKs, never `pgrep -f`/`pkill -f`. No production or gcloud actions.
- [C3] Red-first: show the failing collision test on unmodified main logic before the fix, and a mutation (prefixing removed) turning lookup and join tests red after.
