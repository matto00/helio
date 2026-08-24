## Why

`schemas/` has grown to 76 flat JSON Schema files with no organization, making it hard
to find the contract for a given domain and out of step with the backend's own
domain-subpackage layout (HEL-633/634). Two loose files at repo root
(`orchestration-flow.html`, `development-plan.md`) also belong with the orchestration
material already collected under `notes/`.

## What Changes

- Reorganize `schemas/*.schema.json` (76 files) into domain subdirectories
  (`schemas/<domain>/*.schema.json`), using the ticket's 8 domain names (alerts, auth,
  dashboards, panels, pipelines, hooks, workspace, shared) as starting vocabulary,
  extended with new domains for schemas the original ticket never listed: metrics,
  assistant, authoring, patch-sets, agent-memory, data-types.
- Make `scripts/check-schema-drift.mjs` recurse into subdirectories and update its 4
  hardcoded panel-type-enum-parity file paths for the new nested layout. (The script does
  not itself perform `$ref` resolution — it JSON-parses each schema file standalone.)
- Update `backend/src/test/.../testsupport/JsonSchemaValidation.scala` call sites and any
  other classpath/hardcoded schema-path references for the new layout.
- Fix all cross-file `$ref`s and `$id`s inside schema files (structure-aware rewrite).
- Move `orchestration-flow.html` from repo root into `notes/`, alongside
  `notes/orchestration-iron-laws-handoff.md`. (`development-plan.md` is not a tracked file
  in this repo — locally git-ignored via `.git/info/exclude` and absent from this worktree
  — so it cannot be moved by this change; see design.md D7.)
- Update inbound links to the moved doc.

## Capabilities

### New Capabilities

(none — this is a structural/tooling reorganization; no new system behavior)

### Modified Capabilities

(none — schema *content* and system behavior are unchanged; only file location and
supporting tooling paths change. No spec-level requirement changes.)

No spec deltas accompany this change. `openspec validate` will therefore report `Change
must have at least one delta` — expected, not a defect, per the identical situation and
its resolution in the epic-sibling precedent
`openspec/changes/archive/2026-08-22-repackage-backend-domain-subpackages` (HEL-633,
`proposal.md:49`). Archive with `--skip-specs`.

## Impact

- `schemas/` — all 76 `.schema.json` files relocate into subdirectories.
- `scripts/check-schema-drift.mjs` — file-discovery glob (recursion) + 4 hardcoded
  panel-type-enum-parity paths. (The script does not itself perform `$ref` resolution.)
- `backend/src/test/**/testsupport/JsonSchemaValidation.scala` — schema loading paths.
- Any `openspec/` or CI references to flat `schemas/*.json` paths.
- Repo root — two files removed, relocated to `notes/`.
- Non-goals: package README convention (HEL-637), further repackage follow-ups
  (HEL-802/803/804/811) — out of scope, not touched.
