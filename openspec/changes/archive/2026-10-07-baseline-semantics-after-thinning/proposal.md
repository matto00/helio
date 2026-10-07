## Why

HEL-1272 thins Output history into epoch-aligned time buckets (5 min within 24 h, 1 h to 7 d, 1 d beyond) on an hourly
pass. Compare `previous_run` (HEL-1273) and alert `previous`/`rolling_avg n` (HEL-1278) read the newest stored points,
so for any Output running faster than its bucket width the baseline is "previous surviving point" and silently changes
depending on whether the last thin pass has run. Owner ruling (HEL-1285, recorded on HEL-918): Q1 protect-newest-101,
Q2 keep-d6-and-document, Q3 re-add-here, Q4 docs-only.

## What Changes

- Thinning never deletes an Output's newest 101 history points (alert `rolling_avg` cap 100 + the triggering run). The
  tier max-age purge still deletes any point older than the pipeline owner's cap, protected or not.
- Consequently `previous_run`, alert `previous` and alert `rolling_avg n` mean the literal previous / n most recent
  recorded runs; the spec text stops saying "not necessarily the immediately previous run".
- Window compares (`1d`/`7d`/`30d`/`custom`) are unchanged (D6) and documented as resolving to the nearest surviving
  point, up to one bucket width earlier than the exact target.
- Chart Outputs offer the "Previous" compare option again (withheld by HEL-1350 D3 pending this ruling).
- Docs on every existing surface: CLAUDE.md, alerts routes README, helio-mcp compare/history descriptions, specs.
- One DB-backed test thins a fixture with the real retention SQL, then asserts both the compare-API baseline and the
  alert baseline.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-history-retention`: thinning exempts each Output's newest 101 points; age purge still applies.
- `output-history-api`: `previous_run` is the literal previous recorded point; window slack documented.
- `alert-evaluation-engine`: `previous`/`rolling_avg` baselines are unaffected by thinning (adds a requirement).
- `chart-history-overlay`: chart Compare picker offers "Previous".

## Impact

- Backend: `OutputHistoryRepository.thinAndPurge` thin SQL; a shared constant in `domain/history`;
  `HistoryBaseline.MaxRollingN` sourced from it. No migration, no API shape change.
- Frontend: `compareOptions.ts` (+ tests), a stale comment in `metricHistoryView.ts`.
- helio-mcp: `src/tools/outputs.ts` description strings (HEL-1331 also edits this file — small rebase for the second).
- Docs: CLAUDE.md API section, `backend/.../routes/alerts/README.md`.

## Non-goals

- Changing bucket widths, tier caps, purge cadence or window-compare semantics (D4/D6 stand).
- An alert-rule UI (none exists; Q4 docs-only). Measuring the thin DELETE at scale (HEL-1284).
