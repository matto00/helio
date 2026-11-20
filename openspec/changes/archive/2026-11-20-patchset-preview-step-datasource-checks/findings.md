# HEL-1722 findings and follow-ups

- Deviation (conservative, C9): D5 runs the roots-only inline-root dry run for a PREVIEW only (`ctx.chargeFetches`). At apply it stays skipped:
  `PipelineService.create` re-checks authoritatively, and running it at apply added a second live fetch and broke apply services built without a
  `SourceService` (undo-owned fixtures, not editable here). If the owner wants resolve-time rejection at apply too, it needs the fixtures wired with a
  `SourceService` first (HEL-1720's files).
- Behaviour changes that only refuse earlier (listed in `check-inventory.md` section 6): the HEL-1265 upsert refusal is now a resolve-time 422; a stale AND
  lane-cyclic edit answers the lane-cycle 400 instead of 409; preview of step edits adopts the service's wording and error order.
- Not covered: a step CREATE whose lane target is a lane dependent of a re-parented step (update covers `DependentViaLane`). Low value, noted.
- Not a bug found, but worth knowing: `checkAdd` costs one extra indexed read on the direct create route (design D1, accepted).
