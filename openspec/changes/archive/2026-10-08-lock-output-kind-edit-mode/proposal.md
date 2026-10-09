## Why

The server cannot change an existing Output's kind (`UpdateOutputRequest` carries only `name`/`config`), yet the Output
editor lets a user change Kind in edit mode. Saving then sends the full config for the new kind, which the server rejects
(since HEL-1313) with a developer-worded 400 naming a wrong-kind config key. The control offers an action that cannot
succeed.

## What Changes

- In edit mode the Output editor's Kind select is disabled (native `disabled`, so it is not a dead focusable control).
- A short visible reason is shown under it ("An Output's kind can't be changed after it's created. Create a new Output
  for a different kind.") and is wired as the select's accessible description.
- Create mode is unchanged: Kind is enabled, no reason text.
- The now-unreachable edit-mode "kind changed → send full config" branch's comment is updated to say kind is fixed in
  edit mode (the guard itself stays as a defensive fallback).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: kind is fixed for an existing Output in the editor; switching kind (and its option-group
  swap) applies to create mode only.

## Impact

- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` and its tests. No backend, schema or API
  change.

## Non-goals

- Supporting a real kind change for an existing Output (would be a product call; escalate if preferred).
- HEL-1430's OutputEditorSheet split, test comment, and sheet key.
- Changing the shared `Select` component.
