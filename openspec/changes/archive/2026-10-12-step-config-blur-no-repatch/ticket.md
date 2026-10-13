# HEL-1507: Step config text fields re-emit onChange on blur, sending a redundant identical PATCH (convertformat, likely compute and upsertsource)

## Description

Follow-up of HEL-1484 item 7. `ConvertFormatConfig`'s "Destination field" input calls `onChange` on every keystroke AND
again on blur (`onBlur={(e) => handleOutputFieldChange(e.target.value)}`, `ui/stepConfigs/ConvertFormatConfig.tsx:120`).
Moving focus anywhere else blurs it, re-emits the same config, and the debounced persist PATCHes it again ~400 ms later.
Both PATCHes carry the identical body `{"config":{"field":"area","from":"csv","to":"json","outputField":"dest"}}`.

Evidence (HEL-1484 live probe, throwaway user): convertformat edit alone sends one PATCH; convertformat edit then click a
heading sends a duplicate PATCH (blur alone reproduces it). The forced 422 in the original report is irrelevant.
Script and raw logs: `.concertino/runs/HEL-1484/evidence/probe/HEL-1484-item7.mjs`, `HEL-1484-item7-base.txt`,
`HEL-1484-item7-base-GH.txt` (main checkout).

Root cause: `onBlur` re-runs the `onChange` handler on a controlled input already committed per keystroke;
`useStepCardPersist` has no "config unchanged" check. Same pattern in `ComputeFieldConfig.tsx` (~67, ~82) and
`UpsertSourceConfig.tsx` (~187), not probed live. `ConvertFormatConfig.test.tsx` fires change then blur and only asserts
onChange was called.

Options: remove the redundant `onBlur` from all three components, or add a no-op guard in
`useStepCardPersist`/`emitOrPersist` that skips a payload deep-equal to the last persisted config (changes the wire
behaviour pinned by `useStepCardState.characterization.test.ts`). Server impact is nil (idempotent PATCH); one redundant
request per blur.

## Acceptance Criteria

- Every step-config text field that re-emits its config on blur is enumerated from the current tree, and each is
  confirmed (or ruled out) by a live network probe showing the redundant identical PATCH before the fix.
- After the fix, editing any confirmed field and then moving focus away sends exactly one PATCH for that edit (live
  network probe, same scenario as before).
- No change to the debounced persist hook's wire behaviour as pinned by `useStepCardState.characterization.test.ts`.
- Unit tests that currently pin "blur calls onChange" are replaced by tests that pin "blur does not call onChange"
  (red against the old code), plus at least one integration test showing change-then-blur yields one
  `updatePipelineStep` call.
