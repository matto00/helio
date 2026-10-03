- `backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala` — shared `OutputControlSpec.validateList`/`duplicateIdCheck` (D1c/D2), strict non-array `controls` decode (D1b), `validateConfig` delegates to the helper
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — reject `controls` key on non-output kinds (create + patch, D3); validate patch-supplied controls on output patch (D1/D2)
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — `update` decodes/validates the config patch after the 404/403 lookups and maps failures to 400; batchUpdate runs `BatchControlsCheck` before the write
- `backend/src/main/scala/com/helio/services/panels/BatchControlsCheck.scala` — new: pre-write codec + eligibility check for batch PATCH items
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — propose/contents-time rejection of malformed/duplicate `config.controls` and `config.controls` on non-output panels
- `backend/src/test/scala/com/helio/api/routes/panels/PanelControlsValidationSpec.scala` — new: 45-case matrix (3 defects x 7 write paths) with real DB; 30 red on main
- `backend/src/test/scala/com/helio/api/routes/proposals/OutputControlsValidatorWiringSpec.scala` — new: D5 wiring test (real DbContext + seeded Output); mutation-proven
- `openspec/changes/harden-panel-controls-validation/{write-paths.md,tasks.md,specs/output-panel-placement/spec.md}` — path table, task ticks, extra scenarios

Mutation evidence (ApiRoutes.scala restored after each; file not in the diff):
- green: 2/2
- DashboardProposalService arg -> null only: proposal test FAILED ("control not eligible..." lacks the `panel 'Sales': ` propose-time prefix), contents test passed
- DashboardContentsService arg -> null only: contents test FAILED (same), proposal test passed
- restored: 2/2 green
