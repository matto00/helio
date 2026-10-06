# HEL-1326: Metric correctness: filtered headline uses first 200 rows; lone label/unit mapping picked as metric field (stores 0)

## Description

origin_kind: followup
origin_ticket: HEL-1275

The HEL-1275 (L5) lane reported two correctness gaps. Verify both against main.

1. **Filtered headline.** With no filter, the headline uses the server value computed over all rows (D3). With a
   viewer filter active, the headline is computed client-side from only the first 200 loaded rows, which is the
   original first-200-rows bug on the filtered path.
2. **Wrong metric field.** When an Output's only fieldMapping is a `label` or `unit`, both L3's resolver and the
   client pick it as the metric field. The server's summary then stores `0` instead of `null`.

## Acceptance Criteria

- Filtered headline: compute it over the full filtered set, using a server-side filtered aggregate or an existing
  filter-capable endpoint. If you can't, label it clearly as computed over the loaded rows; that wording is a
  product call, so escalate.
- Metric field: a non-metric mapping is never chosen. A metric with no valid field resolves to `null` on both
  server and client.
- Add a test for each that fails without the fix: unit and route tests for the server, RTL for the client.
- Check whether `output_snapshot_history` rows already written with a spurious `0` need a backfill or a note.

## Epic context (HEL-918 owner rulings, as recorded by the driver)

- D3: the metric is computed server-side over all rows, unfiltered; the headline switches to that value; the delta is
  hidden while a viewer filter is active. Shipped in L5 (77bdaec8).
- D1: history stores a summary (row count, column stats, server headline, chart series), not row payloads (L6 adds
  opt-in payloads).

## Driver constraints for this run

- Stay within the metric headline and reducer code; HEL-1321 (pipeline-editor frontend) and L7 HEL-1277 (history
  scrubber) are parallel. Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`.
- Any backfill/migration needs an owner ruling first (next migration number would be V117).
- New route specs extend `com.helio.testkit.HelioRouteTest`. e2e uses `isolateLivePage`.

## Owner rulings (recorded escalation.answered, chat, human)

- D5: `existing-disclosure` -- the HEL-588 disclosure "N of M loaded rows match." satisfies the spec sentence
  "labelled as computed over the loaded rows". No new copy.
- D4: `no-backfill` -- additive stored `metric {field, agg}` identity on history `current`/`baseline`; the client hides a
  delta whose baseline used a different field/agg. Raw API/MCP keep reporting old stored values until retention ages
  them out; the PR states this. No V117 migration.

## Added scope (HEL-1327 item 1, owner ruling `proceed-with-restated-scope` on HEL-1327's own escalation)

- A route test for the history read: a baseline OLDER than the 30 returned points is checkable against the current
  metric config via the new `baseline.metric` identity field (the server's baseline selection is unchanged, per HEL-918
  ruling D6). HEL-1327 items 2-4 are delivered separately by HEL-1327.
