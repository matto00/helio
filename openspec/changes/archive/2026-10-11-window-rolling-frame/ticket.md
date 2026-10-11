# HEL-1316: window step: rolling frame (moving average, N-row/N-day window)

## Description

Found while designing the CI Health dashboard in helio-news: a 7-day rolling baseline for pass rate / duration, computed in Python today.

Evidence: `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala:95` `SupportedFunctions = row_number, rank, dense_rank, running_sum, lag, lead`; no bounded frame.

What: Add a rolling frame option (N preceding rows, or N days over an ordered date field) with `avg`/`sum`/`min`/`max` (moving average at minimum).

## Acceptance criteria

- [ ] A 7-row moving average over ordered input matches a hand-computed fixture, including the leading partial window behaviour (documented).
- [ ] Partitioning is respected.
- [ ] apply/infer parity and step editor support.

## Linear

Priority: Medium. Project: Helio v0.9 — Insight, Distribution & Enterprise. Related: HEL-376 (original window op).
