# HEL-1600: PanelCard.crossFilter metric-describe tests make unmocked axios calls (jsdom XHR AggregateError)

## Description

Follow-up from HEL-1596 (PR matto00/helio#1028).

Two tests in the metric describe of `PanelCard.crossFilter.test.tsx` make real, unmocked axios requests, to
`/api/output...` and `/api/outputs/output-1/history`. jsdom logs these as XHR `AggregateError` console errors, and they
show up in CI logs, including run 38553599277. HEL-1596 found no link between them and that flake. They are still real
network attempts from unit tests, and they add noise to every failure log. Mock the history/output service calls those
tests reach.

origin_kind: followup
origin_ticket: HEL-1596

## Acceptance Criteria

From the ticket:

1. `PanelCard.crossFilter.test.tsx` makes no real network request: the history/output service calls its tests reach are
   mocked, and running the file prints no jsdom XHR `AggregateError`.

From the delivery brief for this run (driver scope, recorded here so every gate traces it):

2. Every other unmocked network call in the frontend jest suite is found by running the suites and capturing the
   console, and mocked at the right seam (the narrowest service-module function the test reaches, `requireActual`
   spread, matching the HEL-1353 precedent in `PipelineDetailPage.createPlacement.test.tsx`) -- except in files owned
   by parked lanes, which this run must not edit (see design.md).
3. Decide whether a global guard is warranted (a jest setup that fails a test on an unmocked network call). If one is
   added: it is proven red-first, it does not break unrelated suites, and any exception it carries can expire.
4. The full frontend jest suite passes, verified by a run that shows this worktree's paths and non-zero counts.
5. The console is never silenced in place of fixing the call.
