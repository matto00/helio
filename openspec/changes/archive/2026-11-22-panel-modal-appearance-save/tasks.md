## Standing Constraints

- [C1] Every probe and guard reads Redux panel state and the rendered chart type after the modal save and BEFORE the batch flush (then after it), seeding transparency 0.555 and a stored chart.chartType distinct from the bound Output config.chartType and from line.

## 1. Probe

- [x] 1.1 Start lane servers (DB helio_hel1615, ANTHROPIC_API_KEY empty); seed chart.chartType != Output config and != line, transparency 0.555, non-default background; API probe with the modal's exact batch body; record before/after JSON
- [x] 1.2 Playwright through the real modal (title-only, background-only; subtype/OutputControlsEditor saves checked by code reading and the evaluator's browser run); record request body, server read-back, Redux panel + rendered chart type BEFORE the batch flush and after it
- [x] 1.3 Commit probe-evidence.md with an explicit verdict: what was lost (server / client / nothing)

### Backend

- [x] 2.1 Backend guard (or red-first fix if the probe shows server loss): batch title-only update keeps a stored chart and background; verify with the targeted sbt spec

### Frontend

- [x] 3.1 If client loss: commit a red jest run (.txt) for the accumulator/modal test before any fix; verify it fails on unchanged code
- [x] 3.2 If transparency/scalar loss: modal sends only changed keys (transparency compared on seeded integer; nothing changed -> no dispatch); appearance fields typed Partial<PanelAppearance>; red jest (title-only over 0.555) turns green
- [x] 3.3 Re-express HEL-322 sentinel title-only cases per design 2b (sentinel not sent, client still reads it) — intended test change, not a fixture tweak
- [x] 3.4 If client loss OR 3.2 ships: merge the appearance patch over the stored appearance in the local item AND merge it over the prior pending appearance; verify the red test turns green; pending appearance merges over prior pending (two partial saves -> union in batch body, kept after flush, clearSent still clears)

### Tests

- [x] 4.1 Jest: title-only and background-only modal saves keep appearance.chart in client state before flush and keep transparency 0.555; run full spec files
- [x] 4.2 Playwright guard spec: title-only save keeps chart, background, 0.555 on server and the rendered chart type before flush; 2 workers, lane DB
- [x] 4.3 Mutation check: revert the fix (or break the guard's precondition) and confirm each new test turns red; record in probe-evidence.md
