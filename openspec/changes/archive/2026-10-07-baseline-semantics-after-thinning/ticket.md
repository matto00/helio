# HEL-1285: Define 'previous' baseline semantics after history thinning (compare + alerts)

## Description

origin_kind: followup
origin_ticket: HEL-1272

HEL-1272 thins `output_snapshot_history` by time bucket: 5 minutes, then 1 hour, then 1 day. Once older points are thinned, the "previous run" baseline resolves to the previous *surviving* point, not the literal previous run. The divergence is real for any lookup that reaches back past the 5-minute tier. That covers the L3 compare read API (HEL-1273, D6 nearest-at-or-before) and L8 baseline alerts (HEL-1278, which uses `listRecent`; a rolling average over N points spans thinned tiers).

## Acceptance Criteria

* Decide, and record on HEL-918, what "previous" and "rolling average of N" mean once points are thinned: surviving points, or a guarantee such as never thinning the newest K points.
* Make the code match the decision. Add a test that thins a fixture and then asserts the compare-API baseline and the alert baseline both match the stated semantics.
* Document the semantics wherever users see compare or alert baselines, such as the API docs and the alert-rule UI copy.

## Premise validation notes

See `.concertino/runs/HEL-1285/evidence/premise-validation.md` (verdict: minor-staleness). Notably: thinning collapses same-5-minute-bucket points even inside the 24h tier (sub-5-minute cadence is possible), and no alert-rule UI exists — alerts are API-only.
