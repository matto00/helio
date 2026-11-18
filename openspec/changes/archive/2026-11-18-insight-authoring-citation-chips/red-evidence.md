# Red evidence (HEL-1744)

## Backend (sbt testOnly OutputInsightPublicRoutesSpec OutputKindDriftSpec), log /home/matt/Development/helio/.concertino/scratch/HEL-1744/sbt-red-1.log
```
[info] - should offer every canonical kind in its create picker (HEL-1744 L5 removed the insight exclusion) *** FAILED ***
[info]   HashSet("collection", "metric", "chart", "timeline", "table", "markdown") was not equal to HashSet("insight", "collection", "metric", "chart", "timeline", "table", "markdown") (OutputKindDriftSpec.scala:100)
[info] - should name the panel on this dashboard for a placed cited Output, none for an unplaced one or one placed only elsewhere (HEL-1744 D8) *** FAILED ***
[info]   None was not equal to Some("ea36b84b-4411-494b-8b68-77c57310c5d5") (OutputInsightPublicRoutesSpec.scala:162)
[info] - should choose the lowest panel id when a cited Output is placed twice on the dashboard (HEL-1744 D8) *** FAILED ***
[info]   None was not equal to Some("5fb65316-eb5a-4e1a-8154-f50ad92623e7") (OutputInsightPublicRoutesSpec.scala:179)
[info] Tests: succeeded 20, failed 3, canceled 0, ignored 0, pending 0
[info] *** 3 TESTS FAILED ***
```

## Frontend jest, log /home/matt/Development/helio/.concertino/scratch/HEL-1744/jest-red-1.log
```
  ● OutputEditorSheet opening state (HEL-1430 characterization) › an existing insight Output (HEL-1740) › opens with its settings card, the kind locked, and a rename PATCH sends no config
  ● OutputEditorSheet opening state (HEL-1430 characterization) › create mode (kind chosen after open) › insight
  ● Output kind drift (frontend) › the editor's create picker offers every kind
    src/features/panels/insight/CitationChip.test.tsx:7:30 - error TS2307: Cannot find module './CitationChip' or its corresponding type declarations.
    src/features/panels/insight/CitationChip.test.tsx:8:38 - error TS2307: Cannot find module './insightService' or its corresponding type declarations.
    src/features/panels/insight/InsightMarkdown.test.tsx:4:33 - error TS2307: Cannot find module './InsightMarkdown' or its corresponding type declarations.
    src/features/panels/insight/InsightPanelBody.test.tsx:13:34 - error TS2307: Cannot find module './InsightPanelBody' or its corresponding type declarations.
    src/features/panels/insight/InsightPanelBody.test.tsx:14:54 - error TS2307: Cannot find module './insightChromeStore' or its corresponding type declarations.
    src/features/panels/insight/InsightPanelBody.test.tsx:15:40 - error TS2307: Cannot find module './usePipelineOwnership' or its corresponding type declarations.
    src/features/panels/insight/insightService.test.ts:3:61 - error TS2307: Cannot find module './insightService' or its corresponding type declarations.
    src/features/panels/insight/insightState.test.ts:2:60 - error TS2307: Cannot find module './insightState' or its corresponding type declarations.
    src/features/pipelines/ui/outputEditor/insightNode.test.ts:2:54 - error TS2307: Cannot find module './insightNode' or its corresponding type declarations.
  ● Test suite failed to run
  ● usePanelData for an insight Output › makes no rows request when the held metadata says the Output is an insight
```

## e2e against the unchanged UI (frontend/src stashed), log /home/matt/Development/helio/.concertino/scratch/HEL-1744/e2e-red-1.log
```
    Test timeout of 240000ms exceeded.
    Error: locator.click: Test timeout of 240000ms exceeded.
      - waiting for getByRole('option', { name: 'Insight' })
```

## Cycle 3: ownership hold (skeptic-final-1 CR1), jest red against the cycle-2 code
```
  ● InsightPanelBody › holds its state while the pipeline lookup is pending: no not-yet-rendered flash before the upsell
  ● InsightPanelBody › holds its state while the signed-in user (and so their tier) is not loaded yet
Tests:       2 failed, 13 passed, 15 total
```
