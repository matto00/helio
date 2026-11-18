# Measurements (HEL-1744 D7)

Cold load of a dashboard with one insight panel (e2e `hel1744-insight-panel.spec.ts`, request listener on
`/api/outputs/<insight id>/rows` registered before the first `page.goto`): **1** rows request, in all four runs
(light/dark x desktop/phone) -- logged as `[HEL-1744 e2e] cold-load rows requests for the insight Output: 1` and asserted `<= 1`.
Run completion and warm remount: 0 (jest `usePanelData.insight.test.tsx`: held metadata, held metadata invalidated by
`invalidatePipeline` then `refresh()`, and a cold load followed by a refresh once the kind is known). Run completion is also proved in the real
browser: `hel1744-insight-panel.spec.ts` posts a run on an already-open board and asserts a fresh `/insight` read and no new rows request
(the evaluator measured the same through the dev proxy: eval2/run-completion.txt).
The public viewer's cold load also makes one ignored rows request per insight panel (its metadata and rows are fetched together).
