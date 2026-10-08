# HEL-1358: Chart panels over 200 rows: show the compare overlay and flag truncation

## Description

Deferred from HEL-1351 item 2 by owner ruling on 2026-10-07: defer it to its own ticket.

### Problem

Dashboard chart panels load only the first 200 rows. The "vs" compare overlay only draws when a panel holds every row, so any chart with more than 200 rows never shows it. These charts also plot just the first 200 rows today, with nothing on the chart saying so.

### Why the stored series can't fill in

The stored history summary series is an evenly spaced 200-point sample, so it can't be matched point-for-point against the rows. Drawing a panel from that sample would drop peaks. It would also lose viewer filters, cross-filtering, sorting and click-to-select, and it would tie what a panel shows to how long history is kept.

### Needs

A product decision on how large charts should load or summarise their data. At minimum, chart panels should say on the chart when they are truncated.

## Delivery scope (driver, overnight delegation 2026-10-08)

Deliver ONLY the minimum the ticket names: a chart panel whose loaded rows are fewer than the Output's total row count visibly says so on the chart (e.g. "Showing first 200 of N rows"), in both themes, on authenticated and public dashboards if both truncate.

Out of scope (deferred pending an owner product decision): choosing a loading/summarising strategy for large charts, and making the "vs" compare overlay draw for >200-row charts. The product question is recorded in the delivery report for the owner.

## Acceptance Criteria

1. A chart panel (any chart type rendered by the chart renderer) whose loaded row count is less than the Output's total row count shows an on-chart notice naming both counts (e.g. "Showing first 200 of 1,234 rows").
2. A chart panel holding every row shows no notice.
3. The notice appears on authenticated dashboards and on public/shared dashboards (both truncate at 200), using only counts the public endpoint already returns — no new public data.
4. The notice uses existing DESIGN.md tokens / existing disclosure styling, is legible in light and dark themes, and is exposed to assistive tech.
5. The "vs" overlay gating for truncated charts is unchanged (still hidden); proposal and PR state the overlay part is deferred pending the owner's decision.
