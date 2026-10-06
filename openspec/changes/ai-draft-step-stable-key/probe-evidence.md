# Probe evidence (D1, C3) — run on UNMODIFIED production code (only the new test file `PipelineDetailPage.draftCreate.test.tsx` present)

Command: `cd frontend && npx jest --config jest.config.cjs --maxWorkers=2 src/features/pipelines/ui/PipelineDetailPage.draftCreate` — exit 1

```
  ● PipelineDetailPage — an AI draft's card survives its own create (HEL-1321) › keeps the open trunk draft expanded when its create resolves
    Expected the element to have attribute:
    Received:
  ● PipelineDetailPage — an AI draft's card survives its own create (HEL-1321) › keeps a lane-add draft on a childless anchor expanded and as its own lane head
    Expected the element to have attribute:
    Received:
  ● PipelineDetailPage — an AI draft's card survives its own create (HEL-1321) › saves an edit made while the create was in flight to the persisted step
    Expected: "ai-1", ObjectContaining {"instruction": "Summarize briefly"}
    Number of calls: 0
                        ×
  ● PipelineDetailPage — an AI draft's card survives its own create (HEL-1321) › an edit after the swap PATCHes the persisted id, with the card still open
    TestingLibraryElementError: Unable to find an accessible element with the role "textbox" and name `/instruction for the model/i`
                      ×
  ● PipelineDetailPage — an AI draft's card survives its own create (HEL-1321) › shows an inline error when saving the in-flight edit is rejected
    Unable to find an element with the text: /422/. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.
                      ×
  ● PipelineDetailPage — an AI draft's card survives its own create (HEL-1321) › a later full resync keeps the created draft's card open
    Expected the element to have attribute:
    Received:
Tests:       6 failed, 1 passed, 7 total
```

Result: 6 red (trunk draft collapses; lane-add draft on childless anchor collapses; in-flight edit never PATCHed (0 calls) => D3 stays in scope; post-swap edit cannot be made because card collapsed; rejected-flush error absent; resync collapse). 1 green: the "no flush PATCH when not edited in flight" guard (a negative guard, not a red proof).

## Cycle 2 — evaluation-1 finding 1 (enable toggle drops renderKey)

New test "an enable toggle on a created draft keeps its card open", run on the cycle-1 code (before the fix):
`Tests: 1 failed, 7 passed, 8 total` — `Expected aria-expanded="true"  Received: aria-expanded="false"` (exit 1). Green after carrying `renderKey` through `handleToggleStepEnabled` and `handleReorderSteps` (reorder has no dedicated test: the evaluator found it confounded by the pre-existing trunk-head collapse; fixed for consistency by the same one-line carry).
