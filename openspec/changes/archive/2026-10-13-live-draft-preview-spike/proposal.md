## Why

The approved HEL-1570 pipeline board (B2 · Pipeline) edits a draft and re-renders per-step counts, preview rows and the
Output live, with nothing saved until "Save & run". Today every step edit is PATCHed after a 400 ms debounce
(`useStepCardPersist.ts`), both preview endpoints run only the saved config and re-fetch live sources on every call
(`PipelineRunPreview.scala`), and there is no client evaluator. HEL-1581 cannot be built until evaluation placement,
sampling, transport, render and draft semantics are settled. This spike settles them.

## What Changes

- New durable design doc `docs/live-draft-preview.md` answering HEL-1580 questions 1–6, each with a recommended
  approach and the rejected alternatives, grounded in file:line citations from the tree.
- A step-kind table derived from the tree (27 registered kinds), each marked client-evaluable or server-only with a
  reason, plus a parity-testing plan that names a concrete, failable mechanism.
- A throwaway browser prototype (3-step filter → sort → compute pipeline over 1,000 rows, matching the board), kept as
  evidence in this change directory with an exact reproduce command, and a recorded per-edit latency (target < 50 ms),
  measured in a real Chromium, not jsdom or node.
- Cheap transport measurements against the existing preview endpoint and run-events SSE, and an owner escalation for
  any genuine architecture call between viable options. The owner's answers are recorded in the doc.
- Confirmed or adjusted scope for HEL-1581, posted as a comment on HEL-1581 (never a silent description edit).

## Capabilities

### New Capabilities

None. This is a spike: it changes no runtime behaviour, so `.openspec.yaml` sets `skip_specs: true`.

### Modified Capabilities

None.

## Impact

- New: `docs/live-draft-preview.md`; evidence under `openspec/changes/live-draft-preview-spike/` (prototype,
  `measurements.md`).
- No product code, schema, API, dependency or migration changes. The prototype has no npm dependencies and is never
  imported by `frontend/`, `backend/` or any build.

## Non-goals

- Implementing live draft preview, a client evaluator, a draft-preview endpoint or a sample store (HEL-1581 and its
  follow-ups).
- Redesigning the pipeline page (HEL-1579), the design tokens or DESIGN.md (HEL-1571).
- Fixing HEL-1438's SSE reopen; this spike only measures and cites it.
