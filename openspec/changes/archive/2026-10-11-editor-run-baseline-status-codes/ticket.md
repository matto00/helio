# HEL-1503: After HEL-1492: editor runs skip the schema-drift baseline; expose triggered_by_user_id?; split PipelineRunRepository; mid-submit-delete status codes; revoked editor dry run

## Description

These follow-ups came from HEL-1492 (matto00/helio#953, 3eb0cc893). Editor-grantee runs now write run rows and `last_run_*`, count against the pipeline owner's concurrency budget, and are attributed through `pipeline_runs.triggered_by_user_id` (V124).

1. **Schema-drift baseline (HEL-462):** `updateLastSourceSchema` is still owner-only, so an editor's run never refreshes the baseline. This is the same class of gap as HEL-1492.
2. **Product/privacy call:** `triggered_by_user_id` is stored but not exposed in any API or UI. Should run history show who ran it?
3. **Split** `PipelineRunRepository.scala` (628 lines), behaviour-preserving.
4. **Status codes:** an owner whose pipeline is deleted mid-submit now gets 403, where 404 is arguably better. A stale editor grant on a pipeline deleted mid-submit can return 500 inside the accepted race window.
5. **Revoked editor dry runs:** a dry run by an editor whose grant was revoked still executes; only its row is skipped. Decide whether it should 403.
6. **Spec text:** the requirement title in `openspec/specs/pipeline-run-guard/spec.md` still says "per-user concurrency cap", but the body now says it's the owner's budget. `openspec/specs/pipeline-run-execution/spec.md:4` has a TBD Purpose, which predates this change.

## Scope for this run (driver decision)

- IN: item 1 (fix via the HEL-1492 privileged-after-ACL path), item 4, item 5, item 6.
- PRODUCT CALLS (escalated, see Owner rulings below): item 2 (exposure), item 4 (403 vs 404, 500 handling), item 5 (refuse the dry run?).
- OUT: item 3 (repository split) — stays on the ticket; HEL-1503 remains open after this delivery.

## Acceptance criteria

1. An editor grantee's successful real run persists `pipelines.last_source_schema` exactly as the owner's run would — the
   source schema as the pipeline owner sees it (the owner's drift-compare view), whoever owns the source. Owner runs
   unchanged; dry/failed runs unchanged.
2. A run submission (owner or editor, real or dry) for a pipeline deleted after the access check but before admission
   returns `404 Not Found`, never executes and writes no run row; it never returns 5xx. `403` remains only for an existing
   pipeline whose submitter is no longer owner/editor.
3. A dry run re-verifies owner-or-editor immediately before executing; a revoked editor gets `403`, nothing executes, no
   row is written. A live editor's dry run is unaffected.
4. `pipeline-run-guard` concurrency requirement renamed to the owner's budget and its Purpose corrected;
   `pipeline-run-execution` Purpose written (no TBD).
5. Item 3 (repository split) and item 2 exposure are not changed; `triggered_by_user_id` stays stored-only.
6. Tests red first on `VerifiedEmbeddedPostgres.start` as a NOBYPASSRLS role; `[hel1468-guard]` in sbt output; no
   migration.

## Owner rulings (2026-10-12, via driver AskUserQuestion; escalation HEL-1503-1791774605911-771707, answers A/A/A)

- Item 2: A — `triggered_by_user_id` stays stored-only; no API/UI exposure.
- Item 4: A — `FOR KEY SHARE` on the pipeline row in both admission transactions; deleted pipeline → 404 on both paths;
  403 only for an existing pipeline with a revoked grant; no 500.
- Item 5: A — re-check owner-or-editor right before a dry run executes; 403 without executing.
- Baseline READ side (`findLastSourceSchema` owner-scoped): follow-up, not this change.
- Item-1 correction accepted: the editor branch must not read the source with the editor's ownership filter. Refined at
  design-gate round 2 (orchestrator, within the accepted correction): the read uses the PIPELINE OWNER's view rather
  than an unfiltered `findByIdInternal`, so capture matches the owner's analyze (see design.md D2).
