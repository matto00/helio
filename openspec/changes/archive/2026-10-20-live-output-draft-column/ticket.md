# HEL-1632: Live draft preview (f): live Output column rendered from draft rows, with render parity test

## Description

Split from HEL-1581 by owner ruling `split-and-restate` (2026-10-16, escalation HEL-1581-1792170613043-ae7694). Design: `docs/live-draft-preview.md` §7 and §12 item (f). Boards: `.concertino/design/HEL-1570/` (PipelineLive*, PipelineDesktop, HANDOFF.md). Parent epic HEL-1570.

origin_kind: escalation-split
origin_ticket: HEL-1581

## What

* **Live Output column** on the right of the pipeline page, about 340-380 px wide. It shows the pipeline's Output rendered from **draft rows** with the same renderer panels use.
  * Use the `OutputPreviewPane` path (`ChartRenderer`/`MetricRenderer` over in-memory rows plus the unsaved Output config). Do **not** use `OutputPanelContent` unchanged: its metric headline is the last saved run's value (`metricHistoryView.ts`), and it fetches history.
  * No snapshot is written, and no history is fetched per edit.
* **Summary tiles:** rows out, a key aggregate (via `computeAggregate`), and the difference vs the last run.
  * The baseline is **one** `GET /api/outputs/:id/history` per page load (and after a run), cached.
* **Caption:** "Rendered from the draft. Nothing is written until you save and run."
* **"live" pill:** on when frames are fresh. It is off or stale while a server fallback is in flight or a step is in error.
* **Not-previewed nodes:** an Output on a node that is not previewed (downstream of an AI step, per HEL-1580 ruling F) renders its saved data, labelled stale.

## Acceptance criteria

- [ ] The Output render matches the saved-panel render for the same rows (parity test): identical tile values and chart series. A metric whose saved history differs from the draft rows shows the **draft** headline.
- [ ] Editing a client-evaluable step updates the Output render with no network request (the network log shows only the one-time baseline fetch at load).
- [ ] The caption, the live pill states and the not-previewed state render as above.

## Order

Blocked by HEL-1629 (c) and HEL-1630 (d) (both merged). Delivered after (e) HEL-1631 (merged, c1add2394).

## Driver constraints (run brief, binding for this run)

- Draft-mode perf budget (owner ruling on HEL-1631): edit 1 < 100 ms, edits 2-10 < 50 ms; `e2e/hel1631-draft-mode.spec.ts` edit-speed test must stay green unchanged.
- Stay out of HEL-1684 (drafting structural ops), HEL-1685 (draft-mode polish), HEL-1683 (client regex freeze), HEL-1677. No backend step files (HEL-1676 lane).
- DESIGN.md binding; compare the running app at 1280, one width in 769-1100, phone 375 and 430, light/dark, motion Full/Subtle/Off.
