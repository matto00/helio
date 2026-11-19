# Red evidence (C12), recorded before any implementation code

Run on d8cdfb460 plus only the new tests.

## Item 3 (backend): `cd backend && sbt -J-Xmx3g "testOnly *AskPinRealRouteSpec"`

    [info] - should create the insight on the Output's own root when the Output carries one
    [info] - should create the insight on the pipeline's real root when the in-memory Output carries no root id (no guessed pipeline id) *** FAILED ***
    [info]   body={"config":...,"kind":"insight","name":"...","rootId":"f0a9bff3-..."} response={"message":"rootId 'f0a9bff3-...' does not belong to pipeline 'f0a9bff3-...'"}: 400 was not equal to 201
    Tests: succeeded 1, failed 1

## Item 2 (jest): `npm test -- --testPathPatterns=features/ask/ui/AskPanel.test`

    a scope change clears the typed question together with the answer ...
      Expected the element to have value: ""   Received: Why is revenue up?
    Tests: 1 failed, 24 passed, 25 total

## Item 1 (Playwright): `e2e/hel1775-output-editor-chart-fills-card.spec.ts` (1280x800 and 375x812, light and dark)

    Expected: >= 236   Received: 100   (4 of 4 failed; card content height 240)
