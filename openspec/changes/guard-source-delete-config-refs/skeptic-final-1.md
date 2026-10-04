## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c4313250353591a0b80133df3d436377ef5e8850`. Base `260943222894a97e2d65447ff9b00a7e7f57df89` was resolved live with `resolve-review-base.sh` (exit 0). The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/guard-source-delete-config-refs/HEL-1252`.

### What I verified (with evidence)

**Backend, AC1–AC4: sound.** I found no defect here.

- **AC1, reference inventory.**
  - I re-grepped the migrations for FKs to `data_sources`. The only hits are V4 `data_types` (dropped in V94), V22 (dropped in V98), V98 `pipeline_roots`, and V106 `dataset_rows` (cascades).
  - The domain step codecs that carry a source id are `SecondaryInput.Source` (used by join/lookup/union) and `UpsertTarget.ExistingSource`.
  - `FormPanelConfig.format` writes the key `"dataSourceId"` into `panels.form_config` (`FormPanel.scala` ~L214).
  - V110–V114 add no source column.
  - The four kinds R1–R4 in `DataSourceReferenceRepository.scala` therefore match the code.
  - The `op` strings `join`/`lookup`/`union`/`upsertsource` match `UpsertSourceStep.Kind`.
- **AC2, visibility predicates.**
  - The pipeline predicate (`DataSourceReferenceRepository.scala:61-63, 76-78`) is identical to `helio_can_access_pipeline`'s owner/named-grantee branches (V39 L50-61).
  - The panel predicate (L92-94) is identical to `helio_can_access_dashboard`'s authenticated branch (V36 L67-85).
  - The anonymous public-grant branch is excluded, as C1 requires.
  - All reads go through `ctx.withSystemContext`.
  - Hidden identities exist only in `private` `PipelineHit`/`PanelHit`. `SourceReferences` carries visible entries plus counts.
- **C2.**
  - The race-path `log.warn` (`DataSourceService.scala` ~L672) and the teardown P0001 `log.warn` (`WorkspaceTeardownRepository.scala` ~L591) log only the source id and SQLSTATE.
  - The in-tx re-check now selects `1` and has an identity-free reason.
- **AC3, teardown.**
  - `dependentConflicts` runs on the privileged pool before the user transaction, including on dryRun.
  - Its exemption requires owner == caller AND tag == T for both pipelines and dashboards.
  - Hidden references are only counted.
- **AC4, RLS proof is genuine.**
  - The spec creates `helio_migration_test` as `NOSUPERUSER ... NOBYPASSRLS` and a separate `SET ROLE helio_privileged` pool (spec L64-99).
  - The superuser pool is used only for the contrast fixtures.
  - The pre-fix reds are recorded per scenario in probe-notes.md 1.2.
  - The mutations M1–M10 are recorded, and the evaluator independently reproduced M10. I accept those as recorded output; I did not re-run them.
- **Fresh gate run by me:**
  - `nice -n 19 sbt "testOnly …DataSourceReferenceGuardNonSuperuserSpec …V100ZeroRootGuardNonSuperuserSpec …DataSourceRoutesSpec"` gave `Tests: succeeded 182, failed 0`, EXIT=0. I then ran `sbt --client shutdown`.
  - I did not re-run the full `testFull`. Evaluation-2 reports 5590/0, and cycle 2 touched no production code.
- **Live API probe.**
  - Fixtures: two CSV sources, a pipeline joining source T, and a pipeline rooted on T, all owned by the dev user.
  - `DELETE /api/data-sources/T` returned 409 with `pipelines:[{…references:["join"]},{…references:["root"]}]`, `panels:[]`, and the additive fields.
- **AC5, MCP.** The `delete_data_source` description names the tools `remove_root`, `delete_pipeline`, `update_pipeline_step`, `delete_pipeline_step`, `update_panel` and `delete_panel`. I grepped each one and all six exist in `helio-mcp/src/tools`.
- **Servers.**
  - `start-servers.sh` reused already-healthy servers, and `assert-phase.sh servers` returned PASS.
  - The listener cwds are `/proc/330034/cwd` → `…/HEL-1252/backend` and `/proc/330228/cwd` → `…/HEL-1252/frontend`.
  - Production code has not changed since those servers started (cycle 2 was test-only).

**UI, AC5 frontend notice: refuted. This is the design judgment I was asked to make.**

I triggered the notice in the running app: Sources sidebar → actions → Delete → Confirm on the source referenced by two visible pipelines. The notice renders as follows (my own `innerText` capture):

> "SKEP1252 Regions" was not deleted. this source is still referenced by pipeline(s) 'SKEP1252 Orders by region' (2fd4f051-c04e-48b2-9297-14255cbc65a2; as join input), 'SKEP1252 Region rollup' (3fd09608-ea13-4bdb-b94f-6bab7fe783dd; as root); remove each reference first (detach it in the pipeline editor, or unbind or delete the form panel)
> • SKEP1252 Orders by region (pipeline, join input)
> • SKEP1252 Region rollup (pipeline, root)

Screenshots. These were saved directly into the durable evidence directory, so no relocation and no mtime dependence; checksums given:
- dark: `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final-notice-dark.png` (sha256 `7df6f5ce…dbed9c`)
- light: `/home/matt/Development/helio/.concertino/runs/HEL-1252/evidence/skeptic-final-notice-light.png` (sha256 `832828df…26dc3e1`)

The evaluator's own screenshots (`…/evidence/.playwright-mcp/hel1252-eval-notice-{dark,light}.png`) show the same thing, worse, with a form panel: three UUIDs in a 215px sidebar card.

Judged against the sibling it replaces:
- **Before:** on `main`, `SourceDeleteConflictNotice.tsx` composed its own sentence when pipelines were named ("…is still a root of these pipelines. Remove it from each in the pipeline editor first.") and showed no ids. It fell back to the server `reason` only when nothing was named.
- **After:** this change makes the server `reason` render *always* (`SourceDeleteConflictNotice.tsx:35-36`). The result is a regression in four ways:
  - raw UUIDs in user-facing copy;
  - every visible reference listed twice (once in the prose with its id, once as a link);
  - a sentence starting lowercase after a period ("deleted. this source");
  - a remediation clause that tells the user to "unbind or delete the form panel" when there is no form panel.

An experienced reviewer would reject this card. The design's stated reason for always showing `reason` (D6: the hidden count lives only there) is real, but it is solvable without dumping the API text into the UI.

### Verdict: REFUTE

### Change Requests

1. **The notice must not render raw UUIDs or repeat the list.** Files: `frontend/src/features/sources/ui/SourceDeleteConflictNotice.tsx:35-36`, `frontend/src/features/sources/state/sourcesSlice.ts`, the backend protocol, and the schemas. Evidence: `skeptic-final-notice-dark.png`, `skeptic-final-notice-light.png`.
   - Expose the hidden counts structurally. Add additive `hiddenPipelineCount` and `hiddenPanelCount` (or one `hiddenCount`) fields to the 409 body. The changes needed:
     - `DataSourceDeleteConflict` and `DataSourceDeleteConflictResponse` / `jsonFormat`;
     - `DataSourceRoutes` mapping;
     - `schemas/sources/data-source-delete-conflict-response.schema.json`;
     - tolerant parsing in `sourcesSlice` (absent → 0). Additive fields are allowed by AC2.
   - Have the notice compose its own copy from the structured fields whenever it has any. For example: `"X" was not deleted: it is still referenced by the items below[, and by N pipeline(s)/form panel(s) you cannot access]. Remove each reference first.` followed by the existing link list.
   - Fall back to `conflict.message` only when the body carries no structured data (an older server).
   - The server `reason`/`message` may keep ids for API/MCP consumers, where they are useful to agents.
   - Pin it with Jest:
     - a mixed visible + hidden body renders the hidden count;
     - the rendered text matches no UUID pattern (`/[0-9a-f]{8}-[0-9a-f]{4}-/`);
     - each visible reference appears exactly once.
   - Re-verify in the running app in both themes.
2. **Server reason copy.** File: `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` `referenceConflict` (~L693-697).
   - The remediation suffix is static. Tailor it to the kinds present:
     - mention the pipeline editor only when a pipeline reference exists;
     - mention unbinding or deleting the form panel only when a panel reference exists (hidden counts included).
   - Make sure every path that shows `reason` to a user reads as a proper sentence. That means the hidden-only fallback and teardown's `is referenced from outside this tag batch by …` (`WorkspaceTeardownRepository.scala` ~L633). Either capitalise "This source…" server-side, or have the UI not concatenate it after a full stop.
   - Update `DataSourceRoutesSpec` and the non-superuser spec's string assertions accordingly.

### Non-blocking notes

- The Sources table's "Used by" column (and the sidebar) still counts roots only. Live, "SKEP1252 Regions" showed "1 pipeline" while two pipelines referenced it (light screenshot). A source referenced only by a join step or a form panel shows "Unused" and then refuses deletion. This is a reasonable follow-up ticket (it should use the same finder), not in this ticket's ACs.
- `assertConflictMatchesSchemas` does not validate the top-level body against its schema (the `$id` host can't be resolved offline). A URI mapping in `JsonSchemaValidation` would close that.
- No gate defect: no report I relied on disclosed unsound evidence mtimes, and my own evidence is checksum-identified.
- Dev-DB residue: I created two CSV sources (`8cb29839-6dba-4e4a-8648-396db18c0649`, `b75ad5cc-8caf-47c2-9295-14f6cce5365a`) and two pipelines (`2fd4f051-c04e-48b2-9297-14255cbc65a2`, `3fd09608-ea13-4bdb-b94f-6bab7fe783dd`). I deleted all four by exact id through the API (all 204). Afterwards the pipelines GET returned 404 and the source list showed 0 `SKEP1252` matches. No residue remains.
