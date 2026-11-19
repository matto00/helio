## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d8cdfb460f65d130af533770aeadc798dbe30daf (planning artifacts are untracked, under the change dir).

### What I verified (with evidence)

**Item 1: chart preview at 100px (root cause and fix)**
- `OutputPreviewPane.tsx:130` wraps `ChartRenderer` in `.output-preview-pane__chart`, and `OutputEditorSheet.css:147-149`
  sets only `height: 240px` on it. It is a block box, as the design says.
- `ChartRenderer.tsx:116-117` renders `.panel-content.panel-content--chart > .chart-panel__canvas`. `PanelContent.css:1-8`
  gives `.panel-content` `flex: 1; min-height: 0`, which does nothing outside a flex parent. `PanelContent.css:190-202`
  makes `--chart` a column with `.chart-panel__canvas { flex: 1 1 auto; min-height: 0 }`.
- The mechanism is slightly more specific than design.md says. `MobilePanelStack.css:85-92` has a probe-confirmed note
  (HEL-1681) that with a 0px container zrender falls back to `parseInt("100%")`, which is 100. That is where the 100px
  comes from: the container has no definite height, so this is not a "minimum height". The fix still applies. A flex
  column wrapper of definite height makes `.panel-content` definite (flex:1). The `--chart` column then gives the canvas
  a definite flexed size, so ECharts' `height:100%` resolves to about 240px. This is the same contract the dashboard
  panel body provides. Decision 1 tells the executor to probe and record the result, which covers the wording.
- The HEL-1763 evidence agrees: `evaluation-1.md:107` in the main checkout's `.concertino/runs/HEL-1763/evidence` reads
  "a 100px chart inside a 240px wrapper". That confirms the "240px card" is the `.output-preview-pane__chart` wrapper.
- e2e specs that use the selector are `hel1763-output-editor-preview-scroll.spec.ts` and
  `hel1306-chart-reference-lines.spec.ts`. Task 4.2's grep-and-run covers both.

**Item 2: question persists across dashboards**
- `AskPanel.tsx:24` holds the question in a bare `useState("")`.
- `useAsk.ts:18-24` holds its state as `{key, state}` and reads `idle` when the key differs. The claim is confirmed.
- `App.tsx:355-361` mounts `AskDrawer` with `dashboardId={selectedDashboardId}` and no `key`. `AskDrawer.tsx:56` passes
  `scope={{kind:"dashboard", id}}` to `AskPanel`. `OutputEditorSheet.tsx:419` is the second surface, with
  `scope={{kind:"output", id: output.id}}`.
- Holding the question inside `AskPanel` with its scope key changes both surfaces and leaves `App.tsx` alone. That
  satisfies the sibling-lane constraint (HEL-1782/1783). No `usePanelData` or shell file is in the plan.
- The current spec at `openspec/specs/ask-ui/spec.md:75,83` keeps the question "in every state" within one surface. The
  ADDED requirement limits that to a single scope and does not contradict it.

**Item 3: step-less pin fallback**
- `AskPinBuilder.scala:34` reads `first.node.rootId.map(_.value).getOrElse(first.node.pipelineId.value)`. Confirmed.
- `V98__pipeline_roots.sql:199-201` adds `outputs_root_id_matches_node_step_id CHECK ((node_step_id IS NULL) <> (root_id
  IS NULL))`. No later migration drops it: the only outputs CHECK change, in V141, is `outputs_kind_check`.
  `OutputRepository.scala:39` maps `root_id` into `NodeRef.rootId`. So the fallback can only be reached with an
  in-memory Output, as claimed.
- Roots created since V98 get fresh ids: `PipelineRepository.scala:412,486` and `PipelineRootRepository.scala:82,148`
  all use `UUID.randomUUID()`.
- On the real path, `OutputService.create` (lines 152-158) runs `requireUnambiguousRootWhenNeither` and then
  `resolveExplicitRootId`. `OutputRootResolution.scala:48-59` returns
  `BadRequest("rootId '<pid>' does not belong to pipeline '<pid>'")` when no root has the pipeline id. So the current
  fallback does reach a 400 for any pipeline whose root was created after V98.
- When the body omits the node, `requireUnambiguousRootWhenNeither` (lines 25-35) passes for a single-root pipeline and
  returns a named 400 for a multi-root one. `insertInternal` then takes the `firstRootIdAction` default. Omitting the
  node is therefore correct: it binds to the pipeline's real root and never invents an id. Since the case cannot be
  reached from storage, a new DB read in the builder would not be justified.
- The current tests hide the defect. `AskDataServiceSpec.scala:321-326` already sends the fallback body through
  `createService.create`, and it passes only because that fixture's root id equals `pid` (line 348 asserts
  `rootId == pid` for the stored `rev`). Decision 4 creates the pipeline through `POST /api/pipelines`, so the root is
  fresh, and sends the body to the real route. That is the right red test. `AskSeamSpec` (`HelioRouteTest` +
  `AskApiHarness`) shows the route-test pattern works.
- Delta check: the MODIFIED requirement header "Pin hand-off without render" exactly matches
  `openspec/specs/ask-your-data/spec.md:125`. The delta includes the full requirement text and all of its scenarios.

**Artifact hygiene**
- There are no TODO or TBD markers. Every acceptance criterion maps to a task: item 1 to tasks 2.1/2.2, item 2 to
  3.1/3.2, item 3 to 1.1-1.3. Every fix has a red-first commit and a mutation check (4.1).
- No API shape, schema or fixture changes. `shared-test-fixtures/ask` pins carry `nodeStepId`; the executor confirms
  this per the Planner Notes. No migration.

### Verdict: CONFIRM

### Non-blocking notes
1. Item 1 wording: in design.md's Context, write the probe-confirmed mechanism (zrender's 100% fallback against a
   container with no definite height, see `MobilePanelStack.css:85-92`) instead of "content/minimum height". A sibling
   precedent exists: `OutputHistoryModal.css:94` uses `.output-history__chart .panel-content--chart { height: 100% }`.
   Either fix is fine. Note the precedent and why the flex column was chosen.
2. Item 1 test target: measure against `.output-preview-pane__chart`, the 240px box. Do not use
   `OutputSheetPreviewCard`'s content box, which includes the header and the Run row. If the seed renders a
   `.chart-panel__annotation`, truncation note or skipped note, subtract its height or pick a seed with no footnote.
   Otherwise the 4px tolerance fails for a reason unrelated to this fix.
3. Item 2: with the `{key, text}` pattern, going A -> B -> A brings back A's question. A's answer comes back too,
   because `useAsk` holds it under key A. The two stay paired, so this is acceptable. The jest test should assert
   A -> B (empty field) and should not assert anything else for the A-again case unless it intends that behaviour.
4. Decision 2's argument against `key={dashboardId}` is weak. `fieldRef` is a ref object and would reattach on
   remount. The real reason, that it covers only the drawer, is enough on its own.
5. Task 1.3: the existing `AskDataServiceSpec` fallback test (321-326) should assert that the body has no `rootId` and
   no `nodeStepId` after the change. Keep its service-level round trip, but it does not replace the route test, because
   its fixture root id equals `pid`.
