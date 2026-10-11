# HEL-1305: Charts: time-scale x-axis and gaps for missing multi-series points

## Description

Found while designing the CI Health dashboard in helio-news (daily pass-rate / duration trends). Days with no runs are unevenly spaced yet plotted evenly, and multi-series charts show missing days as 0, which reads as a real zero. The workaround was gap-filling days in Python.

When the x field is a date/timestamp, use an ECharts `time` axis (sorted, proportional spacing). For multi-series, emit `null` (gap) rather than 0 for missing x values.

## Evidence (from the ticket; line numbers re-derived in premise-validation.md)

- `frontend/src/utils/chartAppearance.ts` x-axis is always `type: "category"` (now ~line 206).
- `frontend/src/features/panels/ui/chartDataOptions.ts` multi-series `xAxis: { type: "category", data: allX }` and `data: allX.map((x) => lookup[g]?.[x] ?? 0)`; further category axes in the single-series and auto-detect branches.

## Acceptance criteria

- [ ] Date x values with irregular spacing render proportionally on a time axis, sorted.
- [ ] A series missing an x value renders a gap, not 0 (unit test on the option builder).
- [ ] Non-date category x fields are unchanged.

## Owner rulings

Recorded 2026-10-11 via the Planning escalation (`escalation.answered`, channel chat, answer_source human; question text in `.concertino/runs/HEL-1305/escalation-planning-subq.json`):

1. **When:** automatically when the Output's declared schema types the x field `timestamp` (no new config key, no value sniffing; a string-typed date column stays a category axis until cast).
2. **Gaps:** a multi-series chart plots `null` (line breaks, bar omitted) where a series has no value at an x — for ALL multi-series charts, category and time axis alike (today: 0).
3. **Time zone:** UTC for time-axis labels and tooltips (matches the backend's `TimestampParsing.parseInstant`).
4. **Labels:** ECharts' built-in adaptive time-axis labels (rendered in UTC); the tooltip shows `yyyy-MM-dd` when every plotted x is midnight UTC, else `yyyy-MM-dd HH:mm`.
5. **Scope:** time axis for line, vertical bar and scatter, on raw rows AND aggregated (grouped-by-timestamp) Outputs; the "vs" compare overlay is re-aligned by instant and keeps working; reference lines/bands unchanged; cross-filter click keeps working. Horizontal bar, pie, heatmap, histogram and every non-timestamp x are unchanged.
