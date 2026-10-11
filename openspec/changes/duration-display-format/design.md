## Context

See proposal.md - Why. Formats live only in the frontend: `formatMetricValue` (`MetricRenderer.tsx`, used by metric,
collection, the metric history delta and `HistorySummary.tsx`) and `formatColumnValue` (`columnFormatting.ts`, used by
`TableRenderer` render AND filter paths; sort reads raw values). Readers are tolerant type guards in
`outputConfigTypes.ts` (`isMetricFormat`, `isTableColumnFormatType`, `readColumnFormats`); an unknown value is dropped
and renders unformatted. The backend validates only key names (`OutputConfigValidation.KnownKeys`) -- `format` and
`columnFormats` values are opaque, so nothing server-side rejects `duration` today. HEL-1307 rules compare the raw value
(`conditionalFormatting.ts` header), so a display format composes with them unchanged. HEL-1410 (V118) made metric
`format` a string.

## Goals / Non-Goals

Goals: one pure duration formatter shared by every surface; editor selection; agent/server docs list the vocabulary;
seam fixture binding client and server. Non-goals: see proposal.md; also no backend value validator.

## Decisions

D1. One pure helper `formatDuration(seconds: number): string` in `frontend/src/shared/` (or next to
`columnFormatting.ts`; executor picks the existing util location that both metric and table import without a cycle).
Callers convert ms -> s first. Alternative (two copies in the two formatters) rejected: they would drift.

D2. Algorithm (fixes the spec's rounding examples). All rounding runs on the MAGNITUDE `|v|` with an explicit half-up
`Math.floor(x + 0.5)` (never `Math.round` on a negative), and the sign is re-applied at the end. If `|v| < 1` -> round
to whole ms; if that is 0 -> `0s`; if it is < 1000 -> `<n>ms`; else fall through with 1 s. Otherwise (single rounding,
skeptic design-2): `s1 = floor(|v| + 0.5)` is used ONLY to pick the largest non-zero unit U of `s1` (d/h/m/s) and the
next unit V (seconds when U is s). Then `total = floor(|v| / V + 0.5) * V` -- computed from the ORIGINAL `|v|`, never
from `s1` -- and `total` is re-decomposed (a carry may raise U); print the largest non-zero unit of `total` and, if
non-zero, the next unit. Examples: 3599.7 -> U=h, total 3600 -> `1h`; 3755 -> `1h 3m`; 3629.5 -> 60.49 m -> `1h`;
88199.5 -> 24.499 h -> `1d`; 86399 -> 1440 m -> `1d`.
Sign printed once as a leading `-` (never `-0s`: a value that rounds to zero prints `0s`). Days uncapped (400 d ->
`400d`), plain digits with no exponent notation for huge inputs (print via
`Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 0 })`, not `String(n)`).

D3. Metric/collection: extend `MetricFormat` with `"duration"` and `"durationMs"` (string values, consistent with
HEL-1410's string `format`). Table: extend `TableColumnFormatType` with `"duration"` and `TableColumnFormatSpec` with
`unit?: "s" | "ms"`; `readColumnFormats` keeps `unit` only when the entry's type is `duration` and the unit is exactly
`s` or `ms` (an unknown unit is dropped, read as seconds -- the existing tolerant-read convention). Two shapes because each
surface already has its own shape (string enum vs spec object with options); not unified (would be a breaking change).

D4. Editor: `METRIC_FORMAT_OPTIONS` gains `{ value: "duration", label: "Duration" }` and
`{ value: "durationMs", label: "Duration (ms)" }` (same list serves collection if it reuses it; executor verifies).
Table: `COLUMN_FORMAT_OPTIONS` gains UI selections `duration` ("Duration (s)") and `durationMs` ("Duration (ms)");
`useOutputColumnFormats` maps `durationMs` <-> `{ type: "duration", unit: "ms" }` and `duration` <->
`{ type: "duration" }` (UI-only sentinel, like the existing `"none"`). Reopen must round-trip both.
`TableDisplayFields.isColumnFormatSelection` must accept both new selections (else the select silently ignores them).
Unit handling (skeptic design-1 #1): `setFormat` no longer spreads `unit` from the existing spec. Each selection writes
`unit` explicitly: `duration` -> spec WITHOUT `unit`; `durationMs` -> `unit: "ms"`; every non-duration type -> `unit`
removed (other existing options such as `decimals` keep today's behaviour). So ms -> Duration (s), and
ms -> Number -> Duration (s), both end with no `unit` and reopen as Duration (s).

D5. Table alignment: `duration` right-aligned like `number`/`currency` (`TableRenderer.tsx` align rule). Filter uses
display text automatically via `formatColumnValue`. Sort unchanged (raw).

D6. Fallback: metric path returns the input string unchanged for empty/non-numeric/non-finite (same as today's early
returns, which run before the switch). Table path returns `formatCell(value)` (same as other types).

D7. Server/agent docs: append one sentence to `OutputConfigValidation.KeysDoc` naming metric/collection `format` values
(number, integer, currency, percent, duration, durationMs) and column format types (number, currency, date, text,
duration with optional unit s|ms); mirror the same text in helio-mcp `OUTPUT_CONFIG_KEYS_DOC` and in the three request
schema descriptions (`format`, `columnFormats` property descriptions). Update existing pins (OutputConfigValidationSpec,
AssistantProposalToolSchemasSpec / RefinementEditShapeSpec if they pin the text, helio-mcp tests). No validator.

D8. Seam, built so every vocabulary check can fail (skeptic design-1 #2: today's text already contains `number`,
`text` and `duration`, so a substring check proves nothing). Single sources of truth per side:
- Backend: new `OutputFormatVocabulary` object (`MetricFormats`, `ColumnFormatTypes`, `ColumnDurationUnits`, ordered
  `Vector[String]`s) plus `val Doc: String` built from them; `KeysDoc` appends `Doc` (like `ChartTypes.AllList`).
- helio-mcp: exported `METRIC_FORMATS`, `COLUMN_FORMAT_TYPES`, `COLUMN_DURATION_UNITS` arrays and a
  `FORMAT_VOCABULARY_DOC` built from them, appended into `OUTPUT_CONFIG_KEYS_DOC`.
- Frontend: exported `METRIC_FORMATS` / `TABLE_COLUMN_FORMAT_TYPES` / `TABLE_DURATION_UNITS` arrays from which the
  type guards are derived.
`shared-test-fixtures/duration-format-seam.json` holds (a) the three ordered lists, (b) sample configs (metric
`duration`, collection `durationMs`, table column `{type: duration, unit: ms}`), (c) value -> expected text cases, (d)
the exact vocabulary sentence, and (e) the exact `format`/`columnFormats` schema property descriptions. Tests compare
EXACT equality, never substring:
- Frontend (red first): exported arrays equal (a); guards accept every (a) value and reject `"durationms"` and
  `"Duration"`; readers + formatters on (b)/(c) give the expected text.
- Backend: `OutputFormatVocabulary` lists equal (a); `Doc` equals (d) and `KeysDoc` ends with it; each of the three
  request schema files' `format` and `columnFormats` property descriptions equal (e) exactly (the schema pin lives in
  this backend spec); create + PATCH Outputs with configs (b) through the real routes and assert the stored config
  round-trips equal (labelled guard: already passes; mutation note: dropping `format` in the write path turns it red).
- helio-mcp: its arrays equal (a) and `FORMAT_VOCABULARY_DOC` equals (d).
Red first for the vocabulary tests: adding `duration` to the fixture before the code turns all three red.

## Product calls (OWNER REVIEW)

All reversible display choices taken by the orchestrator under the overnight rule; the PR parks for owner review.
- P1 Input unit: seconds by default; milliseconds as an explicit variant (`durationMs` / `unit: "ms"`). No minutes.
- P2 Output style: compact `5m 30s` (not clock `00:05:30`); unit words are not localized.
- P3 Largest unit days (no weeks); smallest `ms` (below 1 s only).
- P4 At most two units, second omitted when zero; rounded to the smallest shown unit, half away from zero.
- P5 Negative: leading `-` (`-5m 30s`).
- P6 Metric `unit` suffix is still appended if the author set one (not suppressed for duration).
- P7 No backend value validation; vocabulary documented instead.

## Risks / Trade-offs

- [Concurrent HEL-1306 edits `OutputConfigValidation.KeysDoc` and the schemas] -> keep this change to one appended
  sentence per surface; re-sync with origin/main before the PR.
- [Unit words English-only] -> acceptable compact notation; recorded as P2.
- [Agents may still write unknown format values] -> they render unformatted (existing tolerant read); unchanged.

## Planner Notes

Self-approved: no new dependency, no migration (next free V124 untouched), no API shape change. The unit-word i18n and
backend value validation are deliberately deferred (non-goals).
