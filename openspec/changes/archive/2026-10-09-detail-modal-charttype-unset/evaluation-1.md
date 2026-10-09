## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `cfb5de634513f5bb56003fd867cefab5c971260b` (one commit on base `63c2dd93634323783f2656e8b48c282226cd73ff`, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (leave `chartType` unset when the panel stores none): `PanelDetailModal.tsx:61` destructures `chartType` out of `defaultChartAppearance` before spreading it, and the `?? "line"` line is removed. A stored `chartType` still comes through the `...(panel.appearance.chart ?? {})` spread. This matches design D1.
- AC2 (unit test: bar Output, no stored type, so no `chartType` in the initial state and no `chartType` in the save): covered by tests 1 and 3 of `PanelDetailModal.chartTypeDefault.test.tsx`. Test 3 is correctly labelled as a regression guard, not a red test (design D3).
- Tasks 1.1 and 2.1–2.5 are all checked, and each one matches the diff.
- Spec delta (`chart-type-selector`, ADDED requirement) matches what was built. Both scenarios are tested.
- Constraint C1 holds. The production diff is the `buildInitialChart` body only: no new export, no `defaultChartAppearance` change, no DB, schema or migration change.
- No scope creep. No API or schema impact.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH at cfb5de63:
- `npm run lint`: clean (0 warnings). `_defaultChartType` is an unused-rest-sibling and the linter accepts it.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm test` (`--maxWorkers=3`, `nice -n 19`): the first full run had 1 failure, in `src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx:301` ("keeps the open trunk draft expanded when its create resolves"). This change does not touch that file or the pipelines feature. I then ran the full suite 4 more times: **5159/5159 passed** every time. I'm classing it as a load-sensitive flake unrelated to this diff (noted below).
- `npm --prefix frontend run build`: succeeds.

Red proof, which I ran myself by mutating the file in place, running the new test file, then `git checkout --` to restore. Afterwards the worktree was clean and HEAD was unchanged:
- M0, base `buildInitialChart` (unfixed): test 1 FAILS with `Expected path: not "chartType"`, `Received value: "line"`. 1 failed, 2 passed.
- M1, base with only `?? "line"` removed (`chartType: panel.appearance.chart?.chartType`): test 1 FAILS with `Received value: undefined`. The key is present-but-undefined, which `not.toHaveProperty` rejects.
- M2, base with the whole `chartType:` line removed but the defaults spread kept: test 1 FAILS with `Received value: "line"`. This shows the D1 destructure is needed.
- Restored fix: 3/3 pass.

The executor's claims (red on unfixed code, red with only `?? "line"` removed, suite/lint/typecheck/format green) are confirmed.

Code quality:
- The comment at `PanelDetailModal.tsx:59-60` carries a HEL ref and states the decision inline, as CONTRIBUTING requires. The wording "would be saved back" is conditional, which fits the latent hazard.
- The test file has a fixture/intent comment only, no step narration.
- No `any`, no dead code, no over-engineering.

act() warnings: the new file produces 2 "not wrapped in act" warnings, both from `OutputPanelContent`'s `setOutput`/`setIsLoading` after the mocked `getOutputById` resolves. The existing sibling `PanelDetailModal.aggregateChart.test.tsx` produces exactly the same 2. This is the existing pattern for this component under test, assertions do not depend on it, and it is **acceptable**.

### Phase 3: UI Review — PASS
I started the servers with `start-servers.sh` (frontend 6810, backend 9717). `assert-phase.sh servers` printed PASS.
- I created a throwaway user (see the created-ids list below), built the `finance` persona template, and logged in through the API in the browser. Note: the shared Playwright browser was carrying another lane's session cookie (user `hel1407-skeptic-…@example.test`), so I switched to my own user via `/api/auth/login` before testing.
- Happy path: I opened the "Sample: Spend by category" chart panel's detail modal, then Edit panel, changed the title, and saved. Auto-save persisted it. The export shows `title: "Sample: Spend by category v2"` and `chartType: "bar"` preserved. Escape closed the dialog.
- Console: 0 errors. The only warnings were 6 pre-existing ECharts "Can't get DOM width or height" warnings.
- The touched chart section is hidden (`showChartSection={false}`), so nothing visible changed. The breakpoint, empty-state and loading checks therefore have no new surface. I didn't screenshot at each breakpoint because no rendered output changed.
- I could not reproduce the "no stored chartType" case live: `PATCH /api/panels/:id` merges `appearance.chart` server-side (the HEL-1304 merge path), so the template panels keep their stored `bar`. The unit test (with the red proof above) is the evidence for that case, as the orchestrator anticipated.

Created dev-DB ids (throwaway; not matt@helio.dev):
- user `0c88ac90-dadf-4084-9160-774540b3e5c0` (`eval-hel1378-1791541658@example.test`)
- dashboard `3eace92c-8d94-45ef-aafc-61258a7fd23e`
- pipeline `5cf050ee-3de4-49a2-a5ef-bdf3886451bb`
- source `54be04e8-838c-42ef-a051-85d9bdf220ab`
- panels `07d07aad-44b6-498a-9f20-c280f49681f2`, `d92211a3-884d-4dec-83c0-0d7d42920537`, `53c0f16c-2467-410b-a8c8-0d6c07b1997c`

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `PanelDetailModal.chartTypeDefault.test.tsx`: the `await act(async () => {})` in `openEdit` lets the real, unmocked `listOutputPanels`/`getDistinctValues` (pulled in by the `requireActual` spread) reach jsdom's XHR. That logs 4 `AggregateError` ECONNREFUSED console errors per run. The sibling test does not show them because it finishes first. Mocking `listOutputPanels` (for example, resolve `[]`) in the `outputService` mock would silence them. Harmless as written.
- In the `AppearanceEditor` mock, `actual.AppearanceEditor(props)` calls the component as a function, so its hooks run inside the wrapper. That works, but `<actual.AppearanceEditor {...props} />` is the conventional form.
- `PipelineDetailPage.draftCreate.test.tsx:301` failed once under full-suite load, then passed 4 times in a row. This looks like a pre-existing timing flake worth a ticket if it recurs. It is unrelated to this change.
