# Test-exercise mutation red runs (HEL-1463, D6d)

`move-check/mutate.py apply|revert|list` applies one exact-line behaviour mutation per collaborator file (nine), each
changing an observable HTTP/result status in a moved body. All nine were applied together; `sbt testOnly *Pipeline* *ResourceTagging*`
(run 2; logs `mut1.log`/`mut2.log` in the run evidence dir) failed with distinct, attributable messages; then all were reverted
(`mutate.py revert`, move checker PASS again) and the full `sbt testFull` after the change is green (test-count-evidence.md).

| # | File (line) | Mutation | Existing spec assertion that went red |
|---|---|---|---|
| M1 | PipelineServiceSupport.scala toSummaryResponse | `tag = s.tag` -> `tag = None` | ResourceTaggingSpec:184 "None was not equal to Some(\"t-...\")" (tagged pipeline create + list round-trip) |
| M2 | PipelineCreateWrites.scala:109 | unknown sourceDataSourceId `NotFound` -> `Conflict` | PipelineAclSpec:356 "409 Conflict was not equal to 404"; PipelineCreateOrphanSourceRoutesSpec:114 (simple path) |
| M3 | PipelineCreateTransaction.scala:144 | `checkOwnedSource` `NotFound` -> `BadRequest` | PipelineApplyProposalRollbackSpec:244 "400 Bad Request was not equal to 404 Not Found" (the only 400-vs-404 failure) |
| M4 | PipelineRootWrites.scala:113 | addRoot pipeline `NotFound` -> `Conflict` | PipelineRootRoutesSpec:268 "409 Conflict did not equal 404" |
| M5 | PipelineAnalyzeReads.scala:169 | analyze pipeline `NotFound` -> `Conflict` | PipelineAnalyzeRoutesSpec:132; PipelineAclSpec:238 (cross-user analyze) |
| M6 | PipelineNodeReads.scala:148 | capabilitiesAtNode pipeline `NotFound` -> `Conflict` | PipelineCapabilitiesRoutesSpec:216 "409 Conflict was not equal to 404" |
| M7 | PipelineProposalAnalyze.scala:273 | inline sql `BadRequest(err)` -> `Conflict(err)` | PipelineAnalyzeProposalRoutesSpec:342 "409 Conflict was not equal to 400"; PipelineProposalServiceValidateSpec (unsupported dialect / bad database name expect BadRequest) |
| M8 | PipelineStepCreate.scala:126 | addStepReporting pipeline `NotFound` -> `Conflict` | PipelineStepRoutesSpec:589; PipelineAclSpec:261 |
| M9 | PipelineStepWrites.scala:39 | updateStep cross-user `NotFound` -> `Conflict` | PipelineAclSpec:280 "409 Conflict was not equal to 404" (PATCH /pipeline-steps/:id cross-user) |

Run 1 (first mutation set) is informative about coverage: its M2 (`create` blank-name `BadRequest`, BASE-equivalent line 58),
M6 (`laneTree` pipeline `NotFound`, line 36), M7 (inline `static` missing config, line 340) and M9 (updateStep update-returned-None `NotFound`, line 64) went
undetected by `*Pipeline*` specs, so those four sites have no existing assertion. Coverage-gap follow-up candidates (no test written, C1):
service-level blank pipeline name 400; `laneTree` unknown-pipeline 404; inline `static` source with no `config` on analyze-proposal; `updateStep` returning no row after update.
Total failures run 2: 15 failed tests across 10 suites (see `mut2.log`).
