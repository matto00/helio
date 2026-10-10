## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 0a52831600a33690b3f45dbee4fa78a4a8d92838 (base; change dir untracked). Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=task/split-output-editor-sheet/HEL-1430`.

### What I verified (with evidence)

- Premises re-derived from the live tree: `OutputEditorSheet.tsx` = 739 lines (`wc -l`); `PipelineDetailPage.tsx:333-344`
  mounts `{outputSheet && <OutputEditorSheet open ... />}` with no `key` (sibling `OutputHistoryModal` IS keyed by id —
  precedent for Decision 5); in-sheet reseed effect (sheet ~152-162) resets only nodeStepId/kind/name/historyPayloads/
  saveError/confirmingDelete on `[open, output?.id]`; per-kind `useState`s (sheet ~206-272) are never reseeded.
- Seed equivalence (Decision 1): compared sheet ~206-272 to `configPatch.ts:45-95` `openingParams` field by field —
  identical predicates and defaults; only `chartOptions ?? EMPTY_CHART_OPTIONS` vs `?? {}` (structurally equal).
- **Round-1 CR1 closed.** Decision 4 now mandates a touched chart case with non-default stored `fieldMapping` and a
  changed annotation binding asserting the exact `config.fieldMapping`. Verified this actually reaches the wire:
  `buildOutputConfig.ts:86-95` builds `fieldMapping: {...withoutAnnotation(params.chartFieldMapping), annotation?}`, and
  `buildConfigPatch` emits the whole key when it differs from baseline — so stored xAxis/yAxis travel verbatim and a
  divergent `chartFieldMapping` seed would change the sent body. `tableFieldMapping`: I confirmed it is unobservable by
  construction (no setter/control; `buildOutputConfig` table case passes it through; baseline built from the same
  seed, so it is never in a patch); the design defers recording this to the executor, which is acceptable.
- **Round-1 CR2 closed.** Decision 4(b) + task 2.1a + Standing Constraint C1 require a post-extraction mutation inside
  `openingParams` (metric format default; chart fieldMapping path), recording the characterization red and the
  configPatch suite outcome. Both mutations are detectable: the metric-format default is DOM-visible and appears in the
  create-mode Save body (config `{}` -> default seeds); the chart fieldMapping mutation is caught by the CR1 touched case.
- Round-1 non-blocking notes absorbed: Decision 3 adds the "per-kind state relies on the key remount" comment and the
  whole-object pass to cards; task 3.3 adds the A->B deep-link swap in the running app.
- Decision 5 red-first: unchanged from round 1 and still sound — on base, A(bar)->B(pie) keeps `chartType` "bar" and an
  untouched Save diffs bar vs B's pie baseline, so both assertions are red; keyed, both green.
- Decision 6 / AC4: the guard comment at `OutputEditorSheet.configPatch.test.tsx:242-243` reads "passes on the pre-fix
  code"; task 1.3's run-against-`6f2351e8^`-then-reword is the right discipline.
- AC coverage: AC1 -> 2.1/2.2/2.3; AC2 -> 3.1; AC3 -> 1.1/1.2/2.1a/3.3; AC4 -> 1.3; AC5 -> 1.4/2.4. No uncovered AC,
  no scope drift (HEL-1432 explicitly excluded; no API/schema change so no contract delta needed). Spec delta matches.

### Verdict: CONFIRM

### Non-blocking notes

- Decision 3's rationale says "other callers/tests rely on the component contract". There is exactly one production
  caller (`PipelineDetailPage.tsx:11` import) and no outputEditor test uses `rerender`; keeping the effect is still the
  right behaviour-preserving call, but the stated reason is overstated — reword when touching design.md.
- The create-mode key (`create:<stepId>`) also remounts on a create->create step change, which the base did not reseed
  (output?.id undefined both times). Intended per AC5; worth one line in the PR body as a deliberate behaviour change.
- Edit-mode metric cases in 1.1 should include one stored config with `format` ABSENT so the default seed is also
  checked in edit mode, not only via the create body.
- `tableFieldMapping`: record the "unobservable by construction" finding in design.md Decision 4 (verified above)
  rather than leaving it as an executor either/or.
