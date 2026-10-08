# HEL-1215: Flaky frontend test: PanelCard.test.tsx "PanelCardBody does not re-render when only unrelated PanelCard state changes" (Expected 2, Received 3 on CI)

## Description

origin_kind: followup
origin_ticket: HEL-1213

Observed on CI for PR matto00/helio#716 (run 36757538890, frontend job): `PanelCardBody — HEL-579 prop reference
stability across an unrelated PanelCard re-render (task 2.8) › PanelCardBody does not re-render when only unrelated
PanelCard state changes (title-edit keystrokes)` failed at PanelCard.test.tsx:625 (now line 618) with
`expect(received).toBe(expected) Expected: 2 Received: 3` (mockUsePanelPolling call count). The PR only touched
backend/build.sbt. Passed 6/6 in isolation locally and on a rerun of the failed job. Render-count assertion appears
timing/act-sensitive under CI load. Seen repeatedly since (CI, pre-commit Jest runs, HEL-1373's root-cause.md).

## Acceptance Criteria (driver-stated)

- Probe-confirmed root cause (Iron Law: systematic-debugging): is the third render a real extra render (state
  update/effect racing a timer or async load) or a test-harness artefact (StrictMode, profiler, act boundaries)?
- A measured red: reproduce at a measurable rate before fixing (at most 3-4 concurrent CPU workers, `nice -n 19`),
  and show 0/N after the fix under the identical recipe.
- If not reproducible within the cap: escalate with evidence; do not raise the cap.
- Do not loosen the assertion (e.g. `<= 3`) unless the root cause proves the extra render legitimate and the test's
  intent survives; that is a coverage call and must be escalated.
- The test must still catch a broken `PanelCardBody` memo boundary (mutation check).
- Minimal/no diff in PanelCard.tsx (contended with HEL-1304; HEL-1365 split queued after); no restructuring.
