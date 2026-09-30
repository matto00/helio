(Executor MUST follow design.md Amendments A1-A5; add a test that a `join` kind in nodePath hits the humanised label fallback.)

## 1. Data layer
- [x] 1.1 provenanceService (auth + public), types mirroring the wire, schema-aligned
- [x] 1.2 useProvenance with shared cache + in-flight dedupe, lazy on open
- [x] 1.3 provenanceLabels reusing the pipeline op-label mapping; typed telemetry hook point

## 2. UI
- [x] 2.1 ProvenancePopover (usePortalPopover, dialog, focus trap/return, Escape, touch targets, both themes)
- [x] 2.2 Degraded states: never run, running, failed, zero rows, no assertions, multi-source, failed/warned checks
- [x] 2.3 ProvenanceTrigger; wire into desktop grid card, mobile stack, fullscreen overlay, detail modal, public viewer
- [x] 2.4 Invalid data badge opens popover at checks; no second uncached assertion-status fetch

## 3. Tests and verification
- [x] 3.1 Unit/component tests per path; per-path network-count assertion (0 requests before open, exactly 1 after two opens); a11y; public has no link/ids and sends token; click/Escape isolation on card, mobile stack, fullscreen, detail modal; never-run vs no-rows vs n-rows
- [x] 3.2 Live verification: desktop + phone, light + dark, anonymous public viewer; red-first baseline
- [x] 3.3 Keep files-modified.md complete; clean dev-DB residue by exact id

## Standing Constraints
