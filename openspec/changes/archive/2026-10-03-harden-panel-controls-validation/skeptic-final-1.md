## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)
- Head reviewed: b65e734e4113f7745fcf2ec8cf61dd0bde3fe9ca; diff vs live-resolved base 3bc5efe7. Backend-only (no UI; design step skipped).
- Red-then-green: in a scratch copy with main's production sources (git archive 3bc5efe7) and the new PanelControlsValidationSpec: 45 run, 15 passed / 30 failed (matches write-paths.md). On the real head: 47/47 pass (45 + 2 wiring).
- All three defects across every write path (PATCH, updateBatch, create, batch create, PUT contents, apply-proposal, import) are covered by the path x scenario matrix; duplicate/snapshot/patch-set/MCP are correctly shown inheriting the shared seams (OutputControlSpec.validateList, PanelConfigCodec.applyConfigPatch/decodeCreateConfig, BatchControlsCheck, ProposalPanelSupport). Same error strings everywhere. Code read: PATCH decodes+validates after 404/403 lookups and before any write; legacy duplicates are not locked on controls-omitting patches.
- Wiring test non-vacuous: mutated a scratch copy of ApiRoutes.scala. Passing null for the validator to DashboardContentsService (line 367) -> the Contents test fails; null to DashboardProposalService (line 364) -> the Proposal test fails. Test asserts the propose-time-only "panel 'Sales': " prefix, so create-time validation can't mask it.
- No test weakening: diff of backend/src/test has zero removed lines (two new files only).
- Full `sbt testFull` (nice, in worktree): 5420 succeeded, 0 failed. ExistenceNotLeakedRoutesSpec ran (56 log hits) and passed; HEL-1002 404 ordering preserved plus an explicit absent-panel-404-before-validation test. No known flakes (HEL-1228/1225, 1215, 1247) hit.
- sbt client shut down. Worktree tracked-clean (only untracked evaluation-1.md).

### Verdict: CONFIRM

### Non-blocking notes
- The 404 test covers absent, not foreign-owned, panels; foreign existence-leak is covered by ExistenceNotLeakedRoutesSpec (green).
