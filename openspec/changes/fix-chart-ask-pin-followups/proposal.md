## Why

Three small defects left by the ask and Output-editor work: the editor's chart preview draws at 100px inside a 240px
card, the ask drawer keeps a typed question on another dashboard while the answer resets, and the ask pin's step-less
`rootId` fallback (the pipeline id) has never been sent to the real create route, where it is expected to fail for any
pipeline whose root id is not the pipeline id.

## What Changes

- The Output editor's chart preview fills its 240px card (desktop and phone, light and dark).
- An ask surface clears its typed question when its scope (dashboard or Output) changes, together with the answer.
- The pin builder no longer sends the pipeline id as `rootId` for an Output with neither a step nor a root id; it omits
  the node so the create route anchors to the pipeline's root (its single root, or a named `400` when ambiguous).
- Backend tests drive the pin body through the real `POST /api/pipelines/:id/outputs` route.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: adds a requirement that the chart preview fills its card.
- `ask-ui`: adds a requirement that the question resets with the answer on a scope change.
- `ask-your-data`: the pin hand-off's step-less, root-less node rule changes from "pipeline id as `rootId`" to "no node
  key".

## Impact

- Frontend: `features/pipelines/ui/outputEditor/OutputEditorSheet.css` (or `OutputPreviewPane.tsx`),
  `features/ask/ui/AskPanel.tsx`; new jest test(s) and one Playwright spec.
- Backend: `services/ask/AskPinBuilder.scala`; new route-level spec. No migration, no API shape change.

## Non-goals

- Changing dashboard panel chart sizing (`.panel-content` itself) or the HEL-1763 scroll bound.
- Persisting the question anywhere (session/local storage) or changing in-scope question retention across ask states.
- Making the create route accept a root id that is not one of the pipeline's roots.
