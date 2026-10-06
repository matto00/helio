## Standing Constraints

- [C1] The provisional lane position is set only on the AI-draft temp object before it is added to the list; the non-AI branch of `handleAddLaneStep` keeps using the plain `makeStep` result (HEL-1294 byte-identical).
- [C2] The mount-captured step-id audit also covers page-level state keyed by step id (e.g. `laneDropdownForStepId`, `duplicatingStepIds`, `draftCreateErrors`), recorded in the change.
- [C3] Every probe/regression test is shown red on unmodified code before the fix is applied, with the output recorded in `probe-evidence.md`.

## 1. Probe

### Tests
- [x] 1.1 Write the D1 RTL probes (deferred create POST: card stays expanded; lane-add draft on a CHILDLESS anchor stays expanded; in-flight edit PATCHed) and record each one red on unmodified code; verify by pasting the failing output into `probe-evidence.md` in this change dir

## 2. Implementation

### Frontend
- [x] 2.1 Add optional client-only `renderKey` to `Step`; verify no wire payload ever includes it (grep result recorded)
- [x] 2.2 Set `renderKey` in the draft create swap and carry it through `syncStepsFromServer`; verify with the probe test
- [x] 2.3 Key step cards and lanes by the stable render key at every render site; verify by grep of `key={` in the pipeline UI
- [x] 2.4 Audit the StepCard subtree for mount-captured step ids and record the result; verify by the post-swap PATCH assertion
- [x] 2.5 Give lane-add drafts a provisional non-zero position in `handleAddLaneStep`'s draft branch only (D2b); verify with the childless-anchor probe
- [x] 2.6 Flush an in-flight edit after the draft create (only if probe 1.1's PATCH case was red); verify with the probe test, including a rejected flush showing the inline error

## 3. Tests

### Tests
- [x] 3.1 Turn the probes into the committed RTL test (expanded after create, in-flight edit PATCHed, post-swap edit PATCHes the persisted id, lane-add draft on a childless anchor not remounted, rejected flush visible inline, resync keeps it open); verify green with fix, red with fix reverted
- [x] 3.2 Run `PipelineDetailPage.creatingStep.test.tsx` and the rest of the pipelines suite unmodified; verify green
- [x] 3.3 Run lint, typecheck, format check; verify all pass
