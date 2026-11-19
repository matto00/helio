## Context

See proposal.md - Why. Ground truth read at planning time (d8cdfb460):

- Item 1: `OutputPreviewPane.tsx:130` wraps `ChartRenderer` in `.output-preview-pane__chart { height: 240px }`
  (`OutputEditorSheet.css:147`), a plain block box. `.panel-content` (`PanelContent.css:1`) sizes itself with
  `flex: 1; min-height: 0`, which only gives it height inside a flex container; on a dashboard its parent panel body is
  one, in the editor it is not, so the chart container has no definite height and zrender falls back to `parseInt("100%")` = 100px (the HEL-1681
  mechanism noted in `MobilePanelStack.css:85-92`; skeptic-design-1). HEL-1763's spec
  (`pipeline-output-sheet` "Output editor scroll extent is bounded...") and `e2e/hel1763-output-editor-preview-scroll.spec.ts`
  constrain the same box and must stay green.
- Item 2: `AskPanel.tsx:24` keeps `question` in a bare `useState`. `useAsk` already holds its state with the scope key
  it belongs to (`useAsk.ts:18-24`), so a scope change reads as idle. `AskDrawer` is mounted once in `App.tsx:356` with
  `dashboardId={selectedDashboardId}` and no `key`, so the panel survives a dashboard switch and keeps the question.
- Item 3: `AskPinBuilder.scala:34` emits `rootId = node.rootId.getOrElse(pipelineId)`. A stored step-less Output always
  has `root_id` (V98's outputs CHECK `(node_step_id IS NULL) <> (root_id IS NULL)`), and `OutputRepository` maps it into
  `NodeRef.rootId`, so the fallback is only reachable with an in-memory `Output`. V98 gave each backfilled root the
  pipeline's id, but roots created since (`POST /api/pipelines` with `roots`) get fresh ids, so the fallback names a
  root that does not exist and `OutputRootResolution.resolveExplicitRootId` returns `400 rootId '...' does not belong`.

## Goals / Non-Goals

**Goals:** each item lands with a test that fails first on the current code (C12), committed red before the fix.

**Non-Goals:** see proposal.md Non-goals. No touch of `App.tsx` (sibling lanes HEL-1782/1783 are in the shell and
`usePanelData`), `PanelContent.css`, or the create route's validation.

## Decisions

1. **Item 1 - make the preview wrapper a flex column.** `.output-preview-pane__chart` gets `display: flex;
   flex-direction: column;` (keeping `height: 240px`) so `.panel-content`'s existing `flex: 1; min-height: 0` fills it,
   the same contract the dashboard panel body provides. Alternatives rejected: changing `.panel-content` (global,
   affects every dashboard panel), hard-coding a chart height (duplicates the 240px, drifts), or the
   `OutputHistoryModal.css:94` precedent (`.panel-content--chart { height: 100% }`), which also works but bypasses the
   flex contract the chart column already relies on. If the probe shows the
   100px comes from somewhere other than the missing flex parent (e.g. a `ChartRenderer` inner wrapper), the executor
   follows the probe-confirmed root cause (systematic-debugging law) and records it in design.md before fixing.
2. **Item 2 - reset the question on scope change inside `AskPanel`.** Hold the question with the scope key it belongs
   to, the same pattern `useAsk` uses (`{key, text}`; a different key reads as `""`), so both surfaces (drawer and
   Output sheet) reset together with the answer, with no effect-driven reset and no change to `App.tsx`. Alternative
   rejected: `key={dashboardId}` on `AskPanel` in `AskDrawer` - it covers only the drawer, not the Output sheet. Going
   A -> B -> A brings back A's question together with A's answer (both held under key A); the test asserts A -> B only. Reason not to keep the question (driver decision, confirmed): the answer, its
   citations and pin all belong to the old dashboard; a kept question next to an empty answer reads as unasked and a
   re-submit asks a different board. No concrete reason to keep it was found in HEL-1746/HEL-1781's design or specs
   ("the question is kept in every state" concerns ask states within a scope).
3. **Item 3 - omit the node instead of guessing.** When the first cited Output has neither `stepId` nor `rootId`, the
   builder emits neither key; the route then runs `requireUnambiguousRootWhenNeither` and `firstRootIdAction`, binding a
   single-root pipeline to its real root (including a V98-backfilled root whose id is the pipeline id) and returning a
   named `400` for a multi-root pipeline. Alternative rejected: keep the pipeline-id guess (wrong for every post-V98
   root) or look the root up in the builder (a new DB read for a case the CHECK makes unreachable from storage).
4. **Item 3 tests go through the real route.** A route-level spec (real `ApiRoutes`/`OutputService` wiring against the
   lane DB, the pattern `AskSeamSpec`/existing output route specs use) creates a pipeline via `POST /api/pipelines`
   with a fresh root, builds the pin with `AskPinBuilder` for (a) the stored step-less Output (real `rootId`) and (b) a
   copy with `node.rootId = None`, and POSTs each body to `POST /api/pipelines/:id/outputs`, asserting status and the
   created insight's root. (b) is red on the current builder (`400`) and green after Decision 3. No model call: the
   builder is called directly; `ANTHROPIC_API_KEY` is exported empty for every lane backend.
5. **Item 1 test is Playwright, measured geometry.** A new spec (desktop 1280 and phone 375, light and dark) opens an
   existing chart Output in the editor and asserts the ECharts container/canvas height equals the preview card's
   content height within 4px, measured against `.output-preview-pane__chart` (the 240px box, not the preview card's
   header/Run row), with a seed that renders no chart footnote/annotation; it reuses the HEL-1763 seed shape. Red on current code (~100px vs ~240px). The executor
   greps `e2e/` for `.output-preview-pane__chart` and `.panel-content` and runs every spec that uses them.
6. **Item 2 test is jest.** Rerender `AskDrawer` (or `AskPanel`) with a new `dashboardId` after typing; assert the
   field is empty. A second assertion keeps the in-scope retention (error state keeps the question) green.

## Risks / Trade-offs

- [Flex change alters the chart on phone, where HEL-1763 bounded scroll] -> run the HEL-1763 spec and the new spec at
  375 and 390x844 in both themes; the wrapper's height stays 240px so the scroll extent does not grow.
- [Omitting the node on a multi-root pipeline yields a `400` at pin time] -> unreachable for stored Outputs (CHECK);
  the route's message names the problem; documented in the spec.
- [Question reset surprises a user who switched boards to re-ask the same thing] -> accepted; matches the answer's
  reset and the ticket's preferred option.

## Planner Notes

- Self-approved: Decision 2 follows the driver's stated default; no escalation needed since no concrete reason to keep
  the question exists. Decision 3 is the ticket's own "fix the builder" branch.
- No migration (Flyway max V146 unchanged), no schema/fixture change (`shared-test-fixtures/ask/*.json` pins carry a
  `nodeStepId`; the executor confirms by grep and runs `AskSeamSpec`).
