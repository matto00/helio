# HEL-1534: Residual lock inversion: panel create (dashboard then outputs KEY SHARE) vs output-side deletes (output then dashboard via V122)

## Description

Follow-up from HEL-1498 (PR matto00/helio#984). The owner triaged it as standalone. It is a deadlock (40P01) risk.

HEL-1498 established one lock order for panel rows: panel rows by id, then dashboards by id. A separate inversion
remains, between the `outputs` rows and the `dashboards` rows:

* **Panel create** (`PanelLayoutPlacement.insertAndAppend`, `PanelMutationRepository.insertPlaced`): takes the
  dashboard row `FOR UPDATE`, then inserts the panel. The `panels.output_id` foreign-key check takes KEY SHARE on the
  bound `outputs` row.
* **Output, pipeline, step or root delete** (output delete, `PipelineRepository.delete`,
  `PipelineStepRepository.deleteInternal`, root removal): locks the output row (the delete itself), then cascades to
  panels. V122's trigger then locks the affected dashboard rows.

A create on dashboard D bound to output O, racing a delete of O while O has panels on D, can deadlock. HEL-1498's
research flagged this; it was not reproduced or fixed.

## Acceptance criteria

* Reproduce the 40P01 first, red-first on `VerifiedEmbeddedPostgres` as a NOBYPASSRLS role. Follow the
  `LockRaceSupport` pattern from HEL-1498 (`PanelWriterLockOrderRaceSpec`, `PipelineCascadeLockOrderRaceSpec`).
* Then fix it with a single consistent order. One option HEL-1498's research suggested: `hel1498_lock_panels`, or a
  sibling function, also locks the affected dashboards by id after the panels and before the deletes. Any SQL change
  goes in a new migration numbered (max on origin/main) + 1. Never edit an applied migration.

## Driver constraints (2026-10-13 overnight brief)

* V130 is the expected next migration; re-check max-on-origin/main immediately before claiming it and before push.
* Overnight: an assumed product call parks the PR unmerged with an OWNER REVIEW section; otherwise agent-merge via
  the auditor (origin/main ancestor of head, CI green on the exact head, `gh pr merge <n> --squash
  --match-head-commit <sha>`).

origin_kind: followup
origin_ticket: HEL-1498
