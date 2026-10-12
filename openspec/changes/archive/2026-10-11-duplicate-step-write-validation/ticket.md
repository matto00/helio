# HEL-1476: After HEL-1436: duplicateStep skips rawConfigProblem (all kinds); UI cast picker lacks float/date/timestamp; pipeline-cast-op spec "TBD" Purpose

## Description

Origin: HEL-1436 (matto00/helio#920, df5c941e), lane-reported. Labels: Follow-up, Bug. Priority: Low.

1. `PipelineService.duplicateStep` never calls `PipelineStep.rawConfigProblem` (for ANY step kind), so duplicating a step
   with an invalid or legacy config writes another such row (e.g. a stored legacy-target cast). Route it through the same
   write validation; red-first through the real duplicate route.
2. The UI cast picker (`CAST_TARGET_TYPES` = string/integer/long/double/boolean) doesn't offer float/date/timestamp, even
   though the runtime now supports them. A stored cast with one of those targets may render oddly in the picker.
   Product-ish: add them, or show stored values read-only. Verify in the running app.
3. `openspec/specs/pipeline-cast-op/spec.md` still has a "TBD" Purpose.
4. Test-depth note: the runtime passthrough for stored legacy casts is proven through the flat test engine only, not
   `PipelineRunService.submit`.
   (Spark `sparkDataType` float→FloatType is unwired, HEL-238; out of scope.)

## Acceptance Criteria

- AC1: `POST /api/pipeline-steps/:id/duplicate` applies the same strict write-path config check create and update apply
  (`PipelineStep.rawConfigProblem`) to the config it would write, and rejects with the same 422 instead of writing a copy.
  Proven red-first through the real route, for every step kind where a stored row can carry a config that check rejects
  (a stored legacy-target cast at minimum); kinds where no such stored row is reachable are enumerated with the reason.
- AC2: Incomplete drafts that create/update accept (HEL-1416: missing required fields, unset secondary ids) remain
  duplicable — proven by a route test.
- AC3: The pipeline editor's cast target picker offers exactly the backend's supported cast targets
  (`CastStep.SupportedTargets`: string, integer, long, float, double, number, boolean, date, timestamp), pinned by a
  guard test that fails by mutation of either list. A stored target outside that set is displayed as itself (marked
  unsupported), not silently shown as "keep as is". Verified in the running app.
- AC4: `openspec/specs/pipeline-cast-op/spec.md` has a real Purpose.
- AC5: Stored legacy-target cast passthrough is proven through `PipelineRunService.submit`, not only the flat engine.
- Out of scope: Spark `sparkDataType` float→FloatType (HEL-238).
