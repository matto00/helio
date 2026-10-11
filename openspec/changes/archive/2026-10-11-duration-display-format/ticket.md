# HEL-1308: Add a duration format type for metric, collection and table

## Description

Found while designing the CI Health dashboard in helio-news: queue and job durations are seconds (330) but should read
"5m 30s". The workaround was precomputing `*_label` string columns in Python.

Evidence: `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` (`MetricFormat = "number" | "integer" |
"currency" | "percent"`, now line 116); table column formats (`TableColumnFormatSpec`, applied in
`renderers/columnFormatting.ts`) cover number/currency/date/text only.

What: add a `duration` format (input unit seconds, optionally ms) rendering compact human text (e.g. 330 -> "5m 30s"),
for metric, collection and table columns, plus schema/validation and editor UI.

## Acceptance criteria

- [ ] 330 renders "5m 30s"; 0, sub-minute, and hour+ values render sensibly (unit tests).
- [ ] The format is selectable in the Output editor for metric and table columns and accepted by backend validation and
  JSON schema.
- [ ] Null/non-numeric values fall back like other formats.

## Premise validation (orchestrator, 2026-10-11)

Verdict minor-staleness. The backend validates only Output config KEY names (`OutputConfigValidation.KnownKeys`); the
values of `format` and `columnFormats` are opaque to it and the JSON schemas leave them untyped, so a `duration` value is
already accepted. The backend half of AC 2 is therefore satisfied by pinning tests plus documenting the format vocabulary
in the agent-facing docs, not by a new value validator. HEL-1307's conditional-format rules compare the raw value
(confirmed in `conditionalFormatting.ts`), so the duration format composes with them without touching rule evaluation.

## Assumed product calls (owner asleep; overnight rule (a) -- reversible, recorded, PR parks for owner review)

See design.md "Product calls (OWNER REVIEW)" -- P1..P7.
