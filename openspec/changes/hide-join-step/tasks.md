# hide-join-step — Tasks

- [x] Remove `join` from the `OP_TYPES` picker array in
      `frontend/src/features/pipelines/state/stepNarrowing.ts`
- [x] Add a `JOIN_OP_TYPE` internal constant so `pipelineStepToStep` can
      still resolve existing backend-loaded join steps without falling back
      to the wrong op type
- [x] Verify no tests assert join is in the picker dropdown
- [x] Run frontend verification gates: lint, format:check, test, build
