# HEL-1661: Pipeline detail for grantees: hide Run/Dry run from viewers, and drop the "source type we don't yet recognize" banner for shared sources

## Description

origin_kind: followup
origin_ticket: HEL-1648 (PR matto00/helio#1056, merged as 442c2a53c)

HEL-1648's lane found two problems with the pipeline detail page when the viewer is not the owner:

1. **A viewer grantee still sees the Run pipeline and Dry run buttons** in the pipeline header. The server rejects a viewer's run, so they are dead controls. Since HEL-1648, the analyze response carries `callerRole` (`owner|editor|viewer`). Use it to hide the buttons, or disable them with an explanation, for viewers.
2. **Grantees see the "source type we don't yet recognize" banner** for sources they don't own. The client can't see a non-owned source in its source list, so it falls through to the unknown-type branch. Grantees should see a neutral state or the source's real type, not a message that reads like a bug.

## Acceptance criteria

* A viewer sees no actionable Run or Dry run, on desktop and phone, in light and dark.
* An editor or viewer on a shared pipeline never sees the unknown-type banner for a known source type.
* An e2e test covers each case, failing first.

## Premise validation (orchestrator, 2026-11-20, main 87cf01a5f)

Item 2's stated cause is stale. The banner is `denyReasonCopy("unclassified-source")`, rendered by `SpineStatusStrip` from the server's `costVerdict.reasons`. `PipelineAnalyzeReads.analyze` resolves each root for the cost verdict with `findByIdOwned(dsId, caller)`, so a root the grantee does not own resolves to nothing and becomes `unclassified-source` (which also turns `autoRunnable` off). The fix is on the server. Full record: `.concertino/runs/HEL-1661/evidence/premise-validation.md`.

## Driver constraints (binding for this run)

* Follow HEL-1782's viewer precedent (hide edit affordances; "View only" indicator), on desktop and phone (phone step sheet and any phone Run entry).
* Server change is limited to the cost-verdict root resolution. Nothing of the source beyond the reason code may reach a grantee (no name, config, credentials, id). Prove on the NOBYPASSRLS role `helio_app_test` that a stranger still gets `404` from analyze and that a grantee's response carries no new source detail.
* The change to `autoRunnable` for editors is a behaviour change beyond the banner: confirm the new value matches what the server actually does when an editor runs the pipeline and when a dataset write triggers an auto-run (`AutoRunTriggerService`). Cover with a test. Call it out in the PR body.
* No migration. Do not touch `PipelineService.scala` wiring (siblings HEL-1720, HEL-1722).
* An e2e spec per case, red first, red run committed before implementation.

## Owner rulings (2026-11-20, recorded via `concertino answer`, chat channel)

* **Q1, fix-in-scope.** Analyze validates a grantee's steps against the pipeline OWNER's root schema, so a valid pipeline no longer shows "A step in this pipeline has a problem…" to grantees, and an editor's `canRun` reflects reality. Use the owner's schema only inside the server-side validation. Send no new column names or types to a grantee beyond what an existing grantee-visible response already returns. If an accurate result really requires sending more of the schema, escalate that point instead of deciding. Make analyze agree with the auto-run trigger's config gate on this case, or explain why they must differ. Prove it on `helio_app_test`, including stranger `404`.
* **Q2, run-only-plus-followup.** Hide every run entry (header Run pipeline / Dry run / Save & run, phone Dry run / Run pipeline / Save & run pills, Output sheet Run pipeline, save-toast Run now). Keep Discard for a viewer who has a draft. Show "View only". File a follow-up for full viewer read-only on the pipeline page (Follow-up label, relatedTo HEL-1661).
* **Q3, neutral-detail-for-grantees.** A grantee gets each cost reason's code with a neutral `detail` (no source kind, URL flag or count). Owners see no change. Wire shape unchanged.
