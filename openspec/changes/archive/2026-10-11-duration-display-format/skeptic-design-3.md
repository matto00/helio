## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `bcb0e891923094c1a1e85ecc053f30a73ee6d70f`. There is no code diff yet: the only change is the untracked change directory `openspec/changes/duration-display-format/`.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/duration-format-type/HEL-1308`.

#### Round-2 CR1 (double rounding): RESOLVED in substance, not just reworded

D2 now says `s1 = floor(|v| + 0.5)` is used ONLY to choose the units U and V, and that `total = floor(|v| / V + 0.5) * V` is "computed from the ORIGINAL `|v|`, never from `s1`". That removes reading A from round 2, and the round-2 red cases are now in the spec ("Fractional input rounds once") and in task 4.1 (3629.5, 88199.5, 3629500 ms).

**Every numeric example, run through D2 as now written.** I implemented D2 literally in a scratch script (`scratchpad/d2.js`, run with node): half-up on the magnitude, the sub-1 s ms branch, U and V chosen from `s1`, the total rounded from `|v|`, re-decomposition, and `Intl.NumberFormat("en-US", {useGrouping:false, maximumFractionDigits:0})`.

All of these match:

| Input | Output |
|---|---|
| 330 | `5m 30s` |
| 0 | `0s` |
| 45 | `45s` |
| 45.6 | `46s` |
| 0.25 | `250ms` |
| 3600 | `1h` |
| 3725 | `1h 2m` |
| 3755 | `1h 3m` |
| 90061 | `1d 1h` |
| 59.6 | `1m` |
| 3599.7 | `1h` |
| 3629.5 | `1h` |
| 88199.5 | `1d` |
| 3629500 ms | `1h` |
| -330 | `-5m 30s` |
| 330000 ms | `5m 30s` |
| 1500 ms | `2s` |
| 90 (collection) | `1m 30s` |
| 700 (rule) | `11m 40s` |
| 65 (delta) | `1m 5s` |
| 400 d | `400d` |
| 86399 (D2's own example) | `1d` |

Boundary probes also behave as the spec requires:

| Input | Output |
|---|---|
| 0.9996 | `1s` |
| 0.9995 | `1s` |
| 0.5 | `500ms` |
| -0.25 | `-250ms` |
| -0.0004 | `0s` (never `-0s`) |
| 59.5 | `1m` |
| 3599.5 | `1h` |
| 89.5 | `1m 30s` |

#### Round-1 items: still resolved

- **CR1 (unit leak).** D4 still states explicit unit handling, and the spec scenario plus task 4.4 still cover it. `isColumnFormatSelection` (`TableDisplayFields.tsx:37`) is still named.
- **CR2 (failable vocabulary seam).** D8 still uses single-source constants and exact-equality checks.
- **CR3 (labels).** The spec names `Duration` and `Duration (ms)` for metric/collection, and `Duration (s)` and `Duration (ms)` for table.
- **Round-2 note on `unit` on non-duration types.** It is now in D3: `unit` is kept only when the type is `duration`.

#### Ground truth for the design's Context and D5/D6

- `formatMetricValue` (`MetricRenderer.tsx:31-55`) returns empty or non-finite input before the switch, so D6's metric fallback holds.
- Callers of `formatMetricValue`:
  - value: `MetricRenderer.tsx:130`
  - delta: `MetricRenderer.tsx:93`
  - history: `HistorySummary.tsx:19`
  - baseline: `MetricOutputPanel.tsx:119`, a caller the design does not name. It inherits the duration formatting automatically, which is the behaviour we want.
- Collection forwards `format` to `MetricRenderer` (`CollectionRenderer.tsx:72`), and its editor reuses `METRIC_FORMAT_OPTIONS` (`OutputKindConfigCard.tsx:195`). One list serves both, as D4 assumes.
- `formatColumnValue` (`columnFormatting.ts:44-88`):
  - `null` goes to `formatCell`, which renders `—`.
  - non-numeric values go to `toFiniteNumber`, which returns undefined, so they fall back to `formatCell`.
  - `resolveColumnFormatter` is shared by the render and filter paths.
  - So D5 and D6 hold.
- The alignment rule is at `TableRenderer.tsx:389` (number/currency only), so D5's change is needed and is named.
- Every reader goes through `isMetricFormat` or `isTableColumnFormatType`, so deriving the guards from the exported arrays (D8) reaches every surface:
  - `buildOutputConfig.ts:83`
  - `outputConfigTypes.ts:255,308,325`
  - `OutputPreviewPane.tsx:87`
  - `HistorySummary.tsx:18`

#### Fresh adversarial pass

- **Placeholders.** None that block. D1's util location is a bounded, non-behavioural choice.
- **Contradictions.** The proposal, design, spec and tasks agree on:
  - the values `duration` / `durationMs`, and the column spec `{type: duration, unit?: s|ms}`
  - the labels
  - fallback, alignment, sort and filter behaviour
  - no validator and no migration
- **Acceptance-criteria coverage.**
  - AC1 is covered by tasks 2.1 and 4.1.
  - AC2 is covered by tasks 2.4 and 4.4 (editor) and 1.1, 1.2, 4.5 and 2.5 (backend, schema and MCP).
  - AC3 is covered by D6 and task 4.3.
- **Scope.** The only additions beyond the ticket are the history delta, `durationMs` for metric, and the docs. They are small and justified.
- **P1-P7** are reversible, consistent with each other, and recorded for owner review.

### Verdict: CONFIRM

### Non-blocking notes

- **Very large inputs.** For astronomically large values (above about 1e15 s), floating-point decomposition loses precision in the minor unit. For example, 1e20 s gives `...d 9h` where exact arithmetic gives 10h. This is not realistic for durations; the executor may ignore it or note it.
- **P6 (unit suffix).** P6 can still produce `5m 30s s` when an author sets a metric `unit`. It is recorded for owner review. Consider suppressing the suffix for duration formats when the owner reviews it.
- **Task numbering.** Task numbering skips section 3 (1.x, 2.x, 4.x). This is cosmetic.
