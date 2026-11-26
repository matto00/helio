## Why

When Save & run is refused for a lane cycle, the draft notice prints the server message verbatim, with raw step UUIDs
(for a step the draft creates, a server-generated id the page has never seen). Its "Couldn't save step" prefix can
also name the lane target instead of the step being saved. Separately, `hel908-tail-attach.spec.ts` has been
quarantined since HEL-951, and it targets an editor (TailChain, step cards, "Add tail step") that no longer exists.
As a result, tail-on-duplicate behaviour has no live coverage.

## What Changes

- Draft-save 400s that name steps (the lane-cycle gate and the dangling lane-target check) name each step by its
  draft key: the clientId for a step this save creates, the stored id otherwise. Every id in the message is one the
  client sent.
- The draft-save refusal notice replaces every page step id in the message with that step's label. Its prefix names
  the step the message is about (the first id in the message), never a later-named lane target.
- `e2e/hel908-tail-attach.spec.ts` is rewritten against the spine and draft editor (four tests). Test 1 now asserts
  the current several-tails/lanes rule. The spec is removed from the `playwright.config.ts` quarantine.
- Three HEL-1515 comments in the step-card characterization fixtures say "descendant" instead of "dependent".

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `pipeline-draft-save`: a refusal that names steps names them by the keys the client sent.
- `pipeline-draft-mode-ui`: the refusal notice names steps by label and prefixes the step the refusal is about.

## Non-goals

- Item 1a, reverting or clearing the lane picker after a refusal. Owner ruling `keep-draft`: the draft is kept.
- Item 1c, `saveErrorIsValidation`. It was removed by HEL-1685 together with per-step saves.
- `hel908-full-flow.spec.ts` / HEL-1145 (link only; HEL-964 owns it). HEL-1521's picker disabling.
- Rewording archived openspec files, or "dependent" where it is the HEL-1521 term.

## Impact

- Backend: `services/pipelines/draft/DraftSaveTransaction.scala`, `DraftDiff.scala` (message text only). No
  migration, no schema or contract change: the 400 body shape is unchanged.
- Frontend: `features/pipelines/hooks/draftSaveRequest.ts`, possibly `ui/PipelineDraftNotices.tsx`.
- e2e: `e2e/hel908-tail-attach.spec.ts`, `playwright.config.ts`.
