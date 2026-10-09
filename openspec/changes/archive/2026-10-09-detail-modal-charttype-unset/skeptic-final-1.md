## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `cfb5de634513f5bb56003fd867cefab5c971260b`. Base resolved live with `resolve-review-base.sh`: `63c2dd93634323783f2656e8b48c282226cd73ff`. One commit is on the branch.

### What I verified (with evidence)
- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/detail-modal-charttype-default/HEL-1378`.
- **Diff (`git diff BASE...HEAD`):** the only production change is the `buildInitialChart` body in `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:58-70`. It destructures `chartType` out of `defaultChartAppearance` (`:61`), spreads the rest, and deletes the `chartType: ... ?? "line"` line. A stored `chartType` still comes through the `...(panel.appearance.chart ?? {})` spread. The other files in the diff are the new test file and the openspec artifacts.
- **C1 holds:** there is no new export, `defaultChartAppearance` (theme/appearance.ts) is unchanged, and there is no backend, schema, migration or DB change. That also respects the HEL-1379 ruling.
- **AC1 (leave chartType unset when the panel stores none):** traced to `:61` and the deleted line. The edit state is only used by `useState` (`:240`), `resetFormToPanel` (`:288`) and the `AppearanceEditor` prop (`:546`, `showChartSection={false}`), so nothing in the modal depends on `chartType` being set. `ChartAppearance.chartType` is optional, and typecheck passes.
- **AC2 (unit test: bar Output, no stored type, so no chartType initially and none sent on save):** `PanelDetailModal.chartTypeDefault.test.tsx`. Test 1 checks the captured `chartAppearance` with `not.toHaveProperty("chartType")`, using a bar Output fixture. Test 3 checks that a title-only save leaves `pendingPanelUpdates["p1"]` with no `appearance.chart` and no `"chartType"` substring. Test 3 is honestly labelled as a regression guard. Test 2 checks that a stored `pie` passes through, which covers the second spec scenario.
- **Red proof, run independently:** I created a separate detached git worktree in my scratchpad at base 63c2dd93, symlinked node_modules, and copied in only the new test file. Test 1 FAILED: `Expected path: not "chartType"`, `Received value: "line"` (1 failed, 2 passed). I then copied in the HEAD `PanelDetailModal.tsx` and got 3/3 passing. I removed the scratch worktree afterwards. The review worktree was never modified: `git status` shows only the evaluator's untracked evaluation-1.md, and HEAD is unchanged.
- **Gates at HEAD (my own runs, nice -n 19, maxWorkers=3):** `jest --testPathPatterns=PanelDetailModal` passed 14 suites and 83/83 tests. `npm run typecheck` and `npm run lint` (`--max-warnings=0`) were both clean.
- **Spec delta (`specs/chart-type-selector/spec.md`, ADDED requirement):** both scenarios map to tests 1+3 and test 2.

### UI / design judgment
I skipped the live visual review because no rendered output changes. The only consumer of the changed state is the chart section, which is hidden (`showChartSection={false}`, `:545`), and the save path does not send `chartAppearance`. I did not start servers or create any dev-DB rows. As instructed, the unit test plus the independently reproduced red proof is the primary evidence.

### Verdict: CONFIRM

### Non-blocking notes
- The test's `outputService` mock leaves `listOutputPanels`/`getDistinctValues` real, which produces noisy ECONNREFUSED console errors. The evaluator already noted this; it is cosmetic.
- If the chart section is ever enabled, `ChartAppearanceEditor` will show no type selected for an unset value. design.md already accepts this.
