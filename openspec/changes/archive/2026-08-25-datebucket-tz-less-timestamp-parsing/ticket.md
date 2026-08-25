# HEL-639: datebucket silently buckets every row to null on timezone-less timestamps

## Description

`datebucket` produces `null` for **every row** when its input timestamps carry no timezone designator (e.g. `2026-03-14T22:08:39`). Nothing errors. The run reports `succeeded`. A following `aggregate` then collapses all rows into a single `null` group, so a chart that should show one point per month shows **one point total**.

This is a silent-wrong-answer bug, not a crash — the only symptom is a row count that looks plausible until you actually check it.

## Root cause

`DateBucketStep.parseToUtcDate` (`backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala`, `parseToUtcDate` private method) accepts exactly:

* an epoch number,
* `Instant.parse` — **requires a trailing** `Z`,
* `OffsetDateTime.parse` — **requires an explicit offset**,
* a bare `yyyy-MM-dd` `LocalDate`.

A local-time ISO string like `2026-03-14T22:08:39` matches none of them. Per the step's documented contract, an unparseable value yields `null` for that row rather than dropping it (parity with `CastStep`) — which is reasonable per-row behaviour, but when *every* row fails the result is a silently empty bucketing.

`LocalDateTime` is the one ISO-8601 shape in between the two that are handled.

## Reproduction

Upload a CSV with a timezone-less timestamp column:

```csv
ticket,completed_at
HEL-1,2026-03-14T22:08:39
HEL-2,2026-04-02T11:30:00
```

Then:

```json
[{ "type": "datebucket", "config": { "field": "completed_at", "granularity": "month", "outputColumn": "month" } },
 { "type": "aggregate",  "config": { "groupBy": [{ "name": "month", "type": "timestamp" }],
                                     "aggregations": [{ "alias": "n", "fn": "count", "field": "ticket" }] } }]
```

Expected 2 rows (one per month); actual **1 row** with `month: null`. Add a `Z` to both timestamps and it returns 2 rows correctly.

Note the schema inference layer types the tz-less column as `timestamp` on upload (`SchemaInferenceEngine.scala` already recognizes `LocalDateTime.parse` with `ISO_LOCAL_DATE_TIME`), so `analyze_pipeline` reports a perfectly healthy schema — the projection gives no hint that every value will fail to parse.

## Suggested fix

Add `LocalDateTime.parse` to `parseToUtcDate`'s accepted forms, interpreting it as UTC (consistent with the method's existing UTC-normalising contract and its name).

Beyond that, the silence is the real hazard. Two options worth considering:

1. Have `datebucket` surface a `validationError` (the mechanism `inferCompute` / `inferSplitText` already use) when it can parse **no** row in the input — an all-null bucketing is never intentional.
2. Have the run result carry a per-step null-output count so an all-null step is visible without manually inspecting rows.

Option 1 is the cheaper guard and matches the "guard at terminal boundaries" pattern from HEL-373.

## Evidence

Found while building the delivery-analytics dashboard (2026-07-27). Two month-bucketed panels silently rendered a single aggregated point instead of a five-month series; the CSV had been written with `datetime.isoformat()[:19]`, which strips the offset. The PR-based panel in the same dashboard worked, because the GitHub API emits `...Z`.

## Acceptance Criteria (to be finalized after the scope-decision escalation)

- `parseToUtcDate` correctly parses timezone-less ISO-8601 local-datetime strings (e.g. `2026-03-14T22:08:39`) instead of silently returning `None`/null for every such row.
- The interpretation of a timezone-less timestamp (UTC vs. configured timezone vs. loud rejection) is decided explicitly by the human, not assumed.
- A test demonstrates the RED (current main fails: all rows null) then GREEN (after the fix: rows land in correct buckets, zero null-bucket count) on the exact trigger shape from the reproduction above.
- Related date/time parsing surfaces are inventoried for consistency but not modified without a separate escalation/ticket.
