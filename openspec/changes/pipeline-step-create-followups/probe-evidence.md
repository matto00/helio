# HEL-1340 probe evidence

All Jest runs: `nice -n 19 npx jest --maxWorkers=2 <path>` from `frontend/`. Logs in the scratchpad (`hel1340-*.log`).

## Item 1 (AC1): reorder `renderKey` carry

Test: `a non-head reorder keeps a created draft's card open` in
`frontend/src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx`.

- Green at HEAD: `Tests: 9 passed, 9 total` (hel1340-item1-green.log).
- Mutation: in `usePipelineDetailPage.ts` `handleReorderSteps` (line 1291), replaced
  `{ ...pipelineStepToStep(persisted), renderKey: s.renderKey }` with `pipelineStepToStep(persisted)`.
  Result: `Tests: 1 failed, 8 passed, 9 total`; the new test fails with
  `Expected the element to have attribute: aria-expanded="true"` (hel1340-item1-red.log).
- Mutation reverted (`git checkout`); file clean.
