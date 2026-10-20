## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e2eac98e0b9242128793f3b8435fc6f8f57fc6b3`. The base was resolved live with `resolve-review-base.sh`: `c1add2394b2d89d6a3779c170a64eb254fc4b734`. The diff is 41 files and frontend only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned READY.
- **Code read from the diff, not from the reports:**
  - `liveOutputSource.ts` implements every row of the D3 table, in the stated evaluation order.
  - `frameRecords.ts` converts Integral values to numbers and orders columns by schema.
  - The base walk in `usePipelineDraftFrames.ts:131-142` keeps rows only for `ok`/`disabled` nodes. A node below an AI step therefore never renders base rows as if they were fresh; it falls through to saved rows.
  - `useLiveOutputBaseline` goes through the shared history cache with the default limit, and refreshes only when a real (non-dry) run settles.
  - `useSavedOutputRows` reads only when the source kind is `saved`.
- **AC1 (parity):** `LiveOutputColumn.parity.test.tsx` checks the following:
  - a line chart with an explicit mapping, and an aggregated bar chart, give `toEqual`-identical ChartRenderer inputs on the saved and live paths;
  - the metric value text is identical (`68`);
  - with history `current.value` different from the rows, the saved panel shows `1204` and the live column shows the draft `68`;
  - the schema-order divergence is pinned.
  - Live app check: with the filter set to 300, the column showed AVG MINUTES `5.44`. That is the draft mean (302..351)/60. The saved-run mean would be 5.09.
- **AC2 (no request per edit):**
  - The Playwright network log for the running app at 1280 shows exactly one `GET /api/outputs/a318.../history` at load, and nothing at all after the filter edit 260 → 300.
  - After that edit the chart, the ROWS OUT tile (`8`, `-6 vs last run`) and the marker (`live`) all updated.
- **AC3 (caption, pill, states):** all seen in the running app:
  - no draft: "Rendered from the saved pipeline over the cached sample.", no marker;
  - draft: the draft caption with a `live` success dot;
  - an invalid compute expression: a `stale` marker in warning tone, the last good render, and the step's message.
  - The AI not-previewed state is covered by `e2e/hel1632-live-output.spec.ts:334-347`, which asserts "Output is stale" and the Not-previewed caption.
- **Gates re-run by me:** targeted jest with `HELIO_JEST_MAX_WORKERS=2` and nice 19 (liveOutput, outputRenderInputs, ChartOutputPanel, MetricOutputPanel, usePanelData, PipelineDetailPage.spine): 15 suites and 202 tests passed. No existing panel test was modified, which is the evidence that the extraction preserves behaviour. The token-guard edits only bump the file count 150 → 151, for the new CSS file.
- **Design judgment against DESIGN.md, in the running app:**
  - 1280 light: no draft. 1280 dark: draft live, metric, and the error/stale state. The column has its own scroll, a subtle left border, the shared `.eyebrow` recipe, mono tile values, no accent, and tokens only.
  - The only raw values are the 6px dot, the 220px card height and 1px borders. These are acceptable.
  - The new CSS has no transitions or animations, so motion Full/Subtle/Off adds nothing new.
  - At 900 the layout falls back to the disclosure. At 375 and 430 (phone Preview tab) the column renders full width, and the caption clears the draft action bar (caption bottom 631 px, bar top 696 px).
  - The draft survived switching from desktop to phone layout.
- **Screenshots (persisted):**
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/.concertino/scratch/HEL-1632/sk-1280-dark-draft-live.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/.concertino/scratch/HEL-1632/sk-1280-dark-error-stale.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/.concertino/scratch/HEL-1632/sk-900-light-open-draft.png`
  - Unpersisted, in `/home/matt/Development/helio/.concertino/scratch/HEL-1632/`: `sk-1280-light-nodraft.png`, `sk-1280-dark-metric.png`, `sk-375-light-preview.png`, `sk-430-light.png`.
- **e2e:** I did not re-run it. I rely on evaluation-2's 27/27 under the flock, plus my own live checks of AC2 and AC3 above.
- **Test data:** I made one throwaway user. It was deleted by exact id and email through the harness's `buildUserDeleteSql`; afterwards the user, pipeline and source counts are all 0. Servers were stopped with `stop-servers.sh`.

### Verdict: CONFIRM

### Non-blocking notes

- **900px with the disclosure open** (the item the evaluator left to me):
  - The output section takes `max-height: 40vh` (320 px at 800 tall). The step editor card shrinks to 160 px of its 267 px, scrolling internally, and its "Step 1 Filter rows" heading scrolls out of view (`sk-900-light-open-draft.png`).
  - The section only opens on the user's request and the design calls for a cap, so this is not a defect.
  - At shorter viewports it gets tighter. A HEL-1685 polish candidate: a lower cap, or letting the open section push the preview table rather than the editor.
- **Two "stale" markers, two treatments.** The Output's `stale` marker is warning-toned while the preview table's `stale` is neutral grey. Both are on screen together in the error state.
- **The error message appears three times** in the error state: in the editor, in the preview table, and in the Output note. The Output note could be shortened.
- **A plain (unaggregated) chart Output shows only the ROWS OUT tile.** This is the documented D1 rule. The ticket's "a key aggregate" tile appears only for metric and aggregated-chart Outputs.
