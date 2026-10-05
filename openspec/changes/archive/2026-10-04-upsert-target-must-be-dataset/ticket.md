# HEL-1265: Upsert existingSource target pointing at a non-dataset source passes create/analyze/preview/dry-run and fails only on a real run

## Description

origin_kind: followup
origin_ticket: HEL-1147

Reported by the HEL-1147 lane; the driver has not verified it. Reproduce it live first.

**Claim:** an `upsertsource` step whose target is `existingSource` with the id of a source that is not a dataset
(CSV, REST, SQL or content) is accepted by step create, analyze, step and Output preview, and dry run. It fails only
on a real run, so the error surfaces after the user thinks the pipeline is valid.

## Acceptance Criteria

* An existingSource target must be a dataset the caller can write to. Enforce this at create/update with a 422 that
  names the target, and report it from analyze. Preview and dry run should refuse it with HEL-1147's named
  `STEP_CONFIG_INVALID` shape, or with a sibling write-target code if that fits better.
* Check every entry path: the UI step editor, MCP `add_pipeline_step`, apply-proposal / `apply_pipeline_proposal`,
  and pipeline import if it exists.
* Check stored steps for invalid targets that are already saved. Decide whether they read back cleanly (as HEL-1147
  did for absent names) and report a count from the dev DB, read-only.
* If the check is grant-aware, prove it holds under a non-BYPASSRLS role.
* Red before the fix, green after.

## Driver constraints (from the dispatch brief)

* Build on HEL-1147 (eda4669e): `StepConfigError` marker + named 422 `{message, code: "STEP_CONFIG_INVALID", stepId,
  stepKind, reason}`; data and source-loader failures stay on the old path. Decide config vs sibling code in design.
* HEL-1252 made existingSource upsert targets a delete-blocking reference (R3) -- keep consistent.
* Parallel lanes: HEL-1154 (preview "(previewed)" title suffix), HEL-1264 (helio-mcp scripts/verify.ts +
  dependabot.yml). Minimal hunks in shared preview files. Migration ledger: V115 reserved for HEL-1154; use V116 if
  one is needed.
* Shared dev DB: record every id created; delete by exact id only. Own ports, own headless browser context.
* Backend gate `nice -n 19 sbt testFull`, max 2 parallel workers, everything nice -n 19.
* Known flakes (rerun, don't fix): FirstRunRoutesSpec, ExistenceNotLeakedRoutesSpec, ApiRoutesPipelineRunGuardSpec,
  AssistantTelemetrySpec (1s RouteTest timeouts), PanelCard.test.tsx:625, ProductEventRollupServiceSpec.
* Red before fix, green after, plus a mutation.
