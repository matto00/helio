## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 0a52831600a33690b3f45dbee4fa78a4a8d92838 (= origin/main base; change dir untracked).

### What I verified (with evidence)

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/split-output-editor-sheet/HEL-1430`.
- `wc -l outputEditor/OutputEditorSheet.tsx` = 739 (premise-validation confirmed). Header (lines 7-19) still claims "~580 lines".
- Seeding duplication is real: sheet lines 206-272 seed each per-kind `useState` from `read*Config`; `configPatch.ts:45-95`
  `openingParams` re-derives the same values. I compared every field by hand: chartType, groupBy/chartAggFn/yField,
  annotation predicate (`!== undefined && !== null`), label/unit predicate (`!== undefined`), metricField
  (`fieldMapping.value ?? aggregation.value ?? ""`), metricFormat/collectionFormat `?? "number"`, compare `?? "none"`,
  markdown content — all identical. Only difference: `chartOptions ?? {}` vs `?? EMPTY_CHART_OPTIONS` (structurally equal,
  no identity consumer, held in `useState` so stable). Decision 1's equivalence argument holds.
- Decision 1 keeps table columns on `useOutputTableColumns`/`useOutputColumnFormats` (capabilities load after mount) —
  correct; `openingParams.tableColumnOrder` with `fieldKeys=[]` must not be used as a seed, and the design says so.
- Reachability of item 3: `usePipelineDetailPage.ts:695-710` `?outputId=` effect calls `setOutputSheet({ output: target })`
  with no null in between; `PipelineDetailPage.tsx:333-344` mounts `{outputSheet && <OutputEditorSheet open ...>}` with no
  `key`; in-sheet reseed effect (`OutputEditorSheet.tsx:153-162`) resets only nodeStepId/kind/name/historyPayloads/
  saveError/confirmingDelete. So the A->B swap reuses the instance and keeps A's per-kind state. Reachable.
- Decision 5 red on base (by trace): after A(bar)->B(pie), `chartType` state stays "bar" (never reseeded) -> "shows pie"
  assertion fails; `buildEditConfig` diffs built (A's bar) against `buildBaselineConfig(kind, B.config)` (pie) -> patch
  contains `chartType` -> "untouched Save sends no config" fails. Both assertions red on base; both green once keyed.
  PipelineDetailPage test harnesses exist (`PipelineDetailPage*.test.tsx`, 6 files) to host it.
- Decision 5 key shape: `output?.id ?? \`create:${createTargetStepId ?? ""}\`` — distinct create key; the in-sheet Step
  picker changes local `nodeStepId`, not `outputSheet.createTargetStepId`, so a step change does not remount. Sound.
- Decision 3 (keep in-sheet reseed effect): only one production caller (`PipelineDetailPage`, `open` always true), but
  the effect is the component's own contract and removal is out of scope for a behaviour-preserving split. Correct call.
- Decision 6 (comment): guard at `OutputEditorSheet.configPatch.test.tsx:242-243`; 6f2351e8 exists; plan to run against
  `6f2351e8^`'s sheet and reword to the observed result is the right discipline.
- Line budget: rough cut accounting from the file — header rewrite -13, per-kind state + `buildConfig` to hook ~-80,
  footer ~-30, Configuration card ~-90, placements/materialization effects ~-28, Preview card ~-40, placements list
  ~-15, imports ~-25 => roughly 410-430 before tightening. "~400" is achievable with the listed cuts if the hook returns
  one object passed whole to the config card and preview card (avoid re-spelling 20 props). Not a blocker.

### Judgment on Decision 4 (the core question)

It is mostly a genuinely independent signal — DOM control serialization and the create-mode full config body are
captured from the base's independent seeding, so a post-refactor divergence in any DOM-visible seed or any create-mode
default turns it red regardless of `openingParams`. But it has a real hole:

- **Non-DOM seeded state is not covered in edit mode.** `chartFieldMapping` (xAxis/yAxis etc.) and `tableFieldMapping`
  have no setter and no form control (`ChartKindFields` receives no mapping; sheet line 216/232). After the refactor
  they are seeded from `openingParams`, and in an untouched edit Save built==baseline tautologically. Yet
  `chartFieldMapping` IS wire-visible: `buildOutputConfig` (chart case) sends `fieldMapping: {...chartFieldMapping, ...}`
  whenever the user touches the annotation binding (or a stale slot forces `fieldMapping`). A seeding divergence there
  would pass the DOM serialization, the create-mode body (config `{}`), and all 22 configPatch tests' untouched cases.
- **Failability is demonstrated only against the old seeding site.** Task 1.2 mutates a seed on the base (the sheet's
  own `useState`). The claim the risk section makes is about the post-refactor world, where the seed lives in
  `openingParams`; it is never shown that a mutation in `openingParams` turns the characterization red.

### Verdict: REFUTE

### Change Requests

1. **Decision 4 / task 1.1: cover non-DOM seeded state in edit mode.** Add, per kind that has such state, an edit-mode
   *touched* case whose exact PATCH body exposes it — at minimum chart: stored `fieldMapping: {xAxis, yAxis, annotation?}`
   with non-default values, change the annotation binding (e.g. bound->literal or bind to another field), assert the
   exact `config.fieldMapping` sent (must carry the stored xAxis/yAxis verbatim). For table, either a touched case that
   exposes `tableFieldMapping` on the wire, or an explicit note in design.md that `tableFieldMapping` is unobservable
   (never sent unless changed, and never changeable) and therefore out of the characterization's reach by construction.
   Committed green on the base with the rest of 1.1.
2. **Task 2.1: prove failability post-refactor against `openingParams`.** After extracting `useOutputKindState`,
   temporarily mutate one seed inside `configPatch.ts`'s `openingParams` (e.g. `metricFormat` default, and the chart
   `fieldMapping` path from CR1), record that the characterization test goes red, revert. Record whether the 22
   configPatch tests stay green under that mutation — that result is the evidence that Decision 4, not the configPatch
   suite, is the load-bearing independent signal. Add this as an explicit task line with its acceptance signal.

### Non-blocking notes

- Decision 3: add a one-line comment on the kept reseed effect that it reseeds only top-level fields and that per-kind
  state requires a remount (`key` at the call site) — otherwise the next reader re-discovers the gap.
- Line budget: plan to pass the hook's return object whole to `OutputKindConfigCard` / preview card; prop-by-prop
  plumbing is what would push the sheet past ~400.
- Decision 6: the 6f2351e8^ sheet predates `configPatch.ts`/HEL-1388; if it fails to compile against current siblings,
  record that rather than patching it, and word the comment from what was actually observed.
- Task 3.3 visual comparison: since a `key` remount re-runs the Modal open path on swap, include one swap in the running
  app (deep-link A then B) to confirm no focus/flash regression.
