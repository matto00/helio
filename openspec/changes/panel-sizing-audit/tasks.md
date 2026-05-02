## 1. Spec Authoring

- [x] 1.1 Write `openspec/specs/panel-content-sizing/spec.md` documenting current padding, font sizes, and element sizing for each panel type
- [x] 1.2 Mark sparse panel types (metric, text at short content, table at 1-2 rows) in the spec per the sparseness threshold defined in design.md
- [x] 1.3 Document grid layout sizing baseline (rowHeight, margin, containerPadding, default item heights) in the spec

## 2. Cleanup

- [x] 2.1 Remove stale `openspec/changes/batch-update-api-endpoint/` directory (was never archived and has no pending work)
- [ ] 2.2 Commit cleanup alongside the spec in the same PR

## 3. Verification

- [x] 3.1 Run `openspec validate --change panel-sizing-audit` and fix any errors
- [x] 3.2 Confirm `openspec/specs/panel-content-sizing/spec.md` exists and all requirements have at least one scenario
