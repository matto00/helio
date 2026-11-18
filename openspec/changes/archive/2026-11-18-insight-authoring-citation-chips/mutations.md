# Mutations (HEL-1744 D10)

## picker drift (drop insight from picker)
mutation: sed '/value: "insight"/d' on src/features/pipelines/ui/outputEditor/outputKinds.ts
```
  ● Output kind drift (frontend) › the editor's create picker offers every kind
Tests:       1 failed, 2 passed, 3 total
```

## allow-list (map costMicros through)
mutation: sed 's/const optional: Partial<InsightCitation> = {/const optional: Partial<InsightCitation> \& Record<string, unknown> = { costMicros: raw.costMicros,/' on src/features/panels/insight/insightService.ts
```
  ● insightService › maps the authenticated read through an allow-list with no model, token or cost key
  ● insightService › maps the public read, carrying only the panel id of a placed citation
Tests:       2 failed, 1 passed, 3 total
```

## viewer quota collapse (show quota to non-owner)
mutation: sed 's/i.isPipelineOwner ? "quota" : "notUpdated"/"quota"/' on src/features/panels/insight/insightState.ts
```
  ● deriveInsightState › render + budget, not the pipeline owner
  ● deriveInsightState › render + quota, not the pipeline owner
Tests:       2 failed, 17 passed, 19 total
```

## ownership keyed on wrong identity
mutation: sed 's/usePipelineOwnership(isPublic ? null : pipelineId, ownershipMatters)/("ownerId" in output \&\& output.ownerId === useAppSelector((s) => s.auth?.currentUser?.id))/' on src/features/panels/insight/InsightPanelBody.tsx
```
  ● InsightPanelBody › a free-tier non-owner with no render sees not-yet-rendered, not the upsell
  ● InsightPanelBody › a free-tier pipeline owner with no render sees the upsell with a beta-access link
  ● InsightPanelBody › quota note goes to the PIPELINE owner even though an editor created the Output
  ● InsightPanelBody › the Output's creator who is not the pipeline owner sees the neutral note, no quota wording
Tests:       4 failed, 9 passed, 13 total
```

## sanitizer (render a link element for markers)
mutation: sed 's|<code key={key}>{m\[1\]}</code>|<a key={key} href={m[1]}>{m[1]}</a>|' on src/features/panels/insight/InsightMarkdown.tsx
```
  ● InsightMarkdown › leaves a marker inside code as text
  ● InsightMarkdown › renders emphasis, strong, code and lists
Tests:       2 failed, 4 passed, 6 total
```

## public panelId (drop the map)
mutation: OutputInsightResponses.public(record, panels) -> public(record)
```
[info] - should name the panel on this dashboard for a placed cited Output, none for an unplaced one or one placed only elsewhere (HEL-1744 D8) *** FAILED ***
[info] - should choose the lowest panel id when a cited Output is placed twice on the dashboard (HEL-1744 D8) *** FAILED ***
[info] Tests: succeeded 7, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```

## e2e: sanitizer: allow the `a` element
mutation in frontend/src/features/panels/insight/InsightMarkdownView.tsx; run: playwright -g 'light desktop'
```
Error: expect(locator).toHaveCount(expected) failed
Expected: 0
Received: 2
1 failed
```

## e2e: footer: revert to panel.meta.lastUpdated
mutation in frontend/src/features/panels/ui/PanelCard.tsx; run: playwright -g 'light desktop'
```
Error: expect(locator).toBeVisible() failed
Expected: visible
Received: <element(s) not found>
1 failed
```

## e2e: phone overflow: grid track no longer shrinks
mutation in frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css; run: playwright -g 'light phone'
```
1 passed (11.0s)
```

## e2e: phone overflow: refresh options keep the default padding (the grid-track rule alone did not turn it red)
mutation in frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css; run: playwright -g 'light phone'
```
Error: {"cardOver":26,"bodyOver":5}
- Expected  - 2
+ Received  + 2
1 failed
```

## jest: rows gate forgets the kind after an invalidation
mutation: usePanelData reads `getOutputMetaCached(outputId)?.kind` (the held, invalidatable metadata) instead of `getKnownOutputKind`
(this was the cycle-1 code). `usePanelData.insight.test.tsx` "makes no rows request after a run invalidates the held metadata" then fails
(rows request made after `invalidatePipeline` + `refresh()`); run for real (see below), then restored.

## jest: ownership/auth hold removed (hook returns false while pending; skeleton hold dropped)
Two InsightPanelBody cases (pending pipeline lookup; auth not loaded) go red; restored.
```
  ● InsightPanelBody › holds its state while the pipeline lookup is pending: no not-yet-rendered flash before the upsell
  ● InsightPanelBody › holds its state while the signed-in user (and so their tier) is not loaded yet
Tests:       2 failed, 13 passed, 15 total
```

## e2e: run-completion step with the rows gate reading invalidatable metadata
```
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: 2
    Received: 3
  1 failed
```
(rows requests after the run: 3 instead of the 2 before it.)
