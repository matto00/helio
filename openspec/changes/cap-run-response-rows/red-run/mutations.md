# Mutation checks (task 4.1), run against the implemented tree, each reverted afterwards

Backend, `testOnly *PipelineRunResponseCapSpec *PipelineApplyProposalRunCapSpec`:

| Mutation | Result |
| --- | --- |
| remove the cap (`preview` returns every row) | 6 failed (run, dry, both previews, apply, fixture seam) |
| flip the flag (`size <= PreviewRows`) | 8 failed |
| count from the preview rows (`take(10).size`) | 6 failed |
| drop `rowsTruncated` from the `RunStatusResponse` writer | 1 failed (`GET /runs/:runId`) |

Frontend, `SpineRunStatus.runCap.test.tsx`: chip count from `runResult.length` instead of `runRowCount` -> 2 failed.
