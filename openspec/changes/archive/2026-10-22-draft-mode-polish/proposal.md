## Why

HEL-1631 (draft mode) and HEL-1632 (live Output column) shipped with a list of known rough edges. Some are bugs: a
blank band under the draft notice, kept drafts that survive session expiry, frames lost on a layout switch, and a
restored step treated as new. Others are copy, docs and test hygiene. HEL-1685 collects them, and the owner has
triaged the ticket (escalation HEL-1685-1792681541852-95d9a1) into what ships here and what is deferred.

## What Changes

- Bugs 4–10: the draft notice gets its own grid row (no empty band); the phone draft-status line clears the Output
  card's menu at 375; kept drafts are cleared on the 401 / session-expiry path too; the run-stream terminal refresh no
  longer requests an Output that the saved definition removed; last-good draft frames survive a desktop↔phone switch;
  the dead step-editor `saveError` plumbing is removed (the step-named Save 400 notice stays); a step restored by
  Discard is not treated as newly created.
- Item 3: the pipeline page's three always-mounted dialogs (Share, Schedule, StepPalette) no longer re-render while
  closed.
- Copy and docs: an Output whose step was deleted no longer reads "from an unknown step"; "No rows to preview." is
  padded after an error; the cascade dialog stops repeating its list as "(s)" hint lines; the archived HEL-1631
  design.md is corrected; a test nit is fixed.
- Live Output column (addendum): "updating" shows while a newer draft frame is settling; the 1500 ms coalesce cap
  fires when `requestIdleCallback` exists; a test guards `onToggle`'s identity; reference marks honour
  `noAnimation`; the disclosure no longer squeezes the step editor; one "stale" style; the error text appears once.
- The elevation and motion token guards stop hardcoding a CSS file count.
- DESIGN.md §10: a carve-out stating that live draft previews update without the chart-refresh morph (owner answer
  `add-carveout`).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-draft-mode-ui`: kept drafts are cleared on session expiry; frames survive a layout switch; a restored
  step is not new; the draft notice takes no extra space.
- `pipeline-live-output-column`: "updating" while settling; the coalesce cap holds; the error is shown once.

## Non-goals

Owner-deferred: perf items 1–2 (declined; prod build measures edit 1 = 32 ms, edits 2–10 ≤ 26 ms against the 100/50
budgets), the item 13 hook splits, addendum D (non-focused server-resolved Output), E (compare overlay, plain-chart
tile), H (server column order) and a shared-`Modal` change. Addendum J needs no action. Also out of scope: HEL-1684,
HEL-1696, HEL-1697, and the CI and e2e harness files (HEL-1699).

## Impact

Frontend only, under `frontend/src/features/pipelines`, `features/auth`, `features/panels/ui/referenceMarksOption.ts`
and `theme/*TokenGuard*`, plus new and updated jest tests, one new e2e spec, DESIGN.md §10, and the archived
HEL-1631 design.md. There are no backend, API or schema changes.
