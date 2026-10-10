# HEL-1417: Step-config validation follow-ups after HEL-1402: patch-set step-create resolves late, shared validateRawConfig helper, compute-without-type, test/spec tightening; split PipelineService.scala (~2600 lines)

## Description

origin_kind: followup
origin_ticket: HEL-1402

From HEL-1402 (06a4eb97: single-call create + patch-set pipeline-create now run `validateRawConfig` for every step kind,
422 `Step '<clientId>': <msg>`). Verify each.

1. Patch-set step-create edits (`resolvePipelineStepCreate`) are still rejected only at apply time (200 with `failure`),
   not at resolve/preview time. Move the check to resolve, like `resolvePipelineCreate` (HEL-1402's design-gate finding).
2. The `companionFor(...).toOption.flatMap(_.validateRawConfig(...))` pattern now appears at 6 sites. Extract one shared
   helper (behaviour-preserving). Coordinate with HEL-1416, which adds more checks behind it.
3. A compute config with no `type` is accepted on every write path but shows up in analyze as a generic
   "compute config error" (pre-existing).
4. The aggregate create test only checks for `"agg"`; it should assert `Step 'agg':` and `bogus`. The
   `pipeline-step-config-rejection` spec's Purpose is narrower than its requirements now are.
5. `PipelineService.scala` is ~2600 lines. Split it behaviour-preserving, to the same standard as today's splits
   (HEL-1253/1187/1234/1371): its own ticket or this one's last item, at the implementer's call.

## Acceptance Criteria

- AC1: A patch-set `pipelineStep` create edit whose config `validateRawConfig` rejects is refused at resolve time —
  apply returns 422 (no edit applied, no step created) and preview returns 422 — with the same `edit N: <msg>` shape the
  `pipelineStep` update edit uses. Red-first through the real patch-set apply and preview routes.
- AC2: All 6 `companionFor(...).toOption.flatMap(_.validateRawConfig(...))` call sites route through one shared helper;
  behaviour unchanged (existing suites green, no message/status drift).
- AC3: A compute config with no `type` is analyzed on its merits (no generic "compute config error"); decided analyze-side,
  not reject-at-save (dev DB: 2/2 stored compute steps lack `type`).
- AC4: The aggregate create test asserts `Step 'agg':` and `bogus`; the `pipeline-step-config-rejection` Purpose covers
  every requirement it now holds.
- AC5: PipelineService split delivered here OR filed as its own ticket (implementer's call, stated in the plan).
