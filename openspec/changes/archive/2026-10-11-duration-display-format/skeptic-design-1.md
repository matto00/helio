## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `bcb0e891923094c1a1e85ecc053f30a73ee6d70f` (planning artifacts untracked in the change dir; no code diff yet).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/duration-format-type/HEL-1308`.
- **The backend does not validate `format`/`columnFormats` values: CONFIRMED.** `OutputConfigValidation.scala` judges key names
  (`KnownKeys`), `chartType`, `binCount` and `aggregation` shapes only. `ConditionalFormats.validateConfig`,
  `OutputCompare` and `PayloadOptIn` do not touch `format`. The three request schemas define `format` /
  `columnFormats` as description-only, untyped properties (`create-output-request.schema.json:98-106`,
  `update-output-request.schema.json:87-95`, `create-pipeline-transactional-output-request.schema.json:95-101`).
  P7, and treating AC2's backend half as pin-and-document work, both rest on true premises.
- **HEL-1307 rules compare raw values: CONFIRMED.** The `conditionalFormatting.ts:1-7` header says so and names
  HEL-1308. `MetricRenderer.tsx:129` calls `resolveRule(conditionalFormats, data?.value)` on the raw value, and
  calls `formatMetricValue` separately at line 130.
- **Every consumer of `formatMetricValue` / `MetricFormat`** (grep across frontend/src and helio-mcp/src, tests excluded):
  - `MetricRenderer` value at line 130 and the ComparisonLine delta at line 93.
  - `CollectionRenderer`, which forwards `format` to `MetricRenderer`.
  - `MetricOutputPanel.tsx:119`: the baseline tooltip text, which also appends `cfg.unit`.
  - `HistorySummary.tsx:18-19`.
  - `OutputPreviewPane.tsx:87`, through the `isMetricFormat` guard.
  - `buildOutputConfig.ts:82`, through `readFormatOrNull` / `isMetricFormat`.
  - `configPatch.ts:90,94`, which seeds `"number"` by default.
  - `chartAppearance.ts:102` mentions it in a comment only.

  Every consumer goes through the one formatter or guard, so extending them covers every surface. design.md's
  Context omits `MetricOutputPanel`'s baseline text, but it is covered automatically (see the notes).
  `absDelta` is `Math.abs(delta)` (`metricHistoryView.ts:151`), so the delta never hits the negative path.
- **The collection editor exposes a Format select: CONFIRMED.** `OutputKindConfigCard.tsx:186-196`
  (`output-collection-format`) uses the same `METRIC_FORMAT_OPTIONS` as the metric select
  (`OutputKindFields.tsx:231,286`). So D4's "same list serves collection" holds.
- **Table path.** `formatColumnValue` (`columnFormatting.ts:44`) is shared by the render and filter paths through
  `resolveColumnFormatter`. Sort reads raw values. The alignment rule is at `TableRenderer.tsx:389`.
  `readColumnFormats` (`outputConfigTypes.ts:249`) drops unknown types and copies only the known sub-options, so it
  needs the planned `unit` handling. `TableDisplayFields.tsx:29-46` has `COLUMN_FORMAT_OPTIONS` and an
  `isColumnFormatSelection` guard, and both must gain the new values.
- **D2 against every numeric example in the spec (hand-traced): all match.** The sign is taken off first, so
  rounding the magnitude is half away from zero.

  | Input | Trace | Result |
  |---|---|---|
  | 330 | | `5m 30s` |
  | 0 | | `0s` |
  | 45 | | `45s` |
  | 45.6 | rounds to 46 | `46s` |
  | 0.25 | | `250ms` |
  | 3600 | U=h; 60 min | `1h` |
  | 3725 | 62.08 min -> 62 | `1h 2m` |
  | 3755 | 62.58 min -> 63 | `1h 3m` |
  | 90061 | 25.02 h -> 25 | `1d 1h` |
  | 59.6 | rounds to 60 | `1m` |
  | 3599.7 | 3600 | `1h` |
  | -330 | | `-5m 30s` |
  | 330000 ms | 330 s | `5m 30s` |
  | 1500 ms | 1.5 s -> 2 | `2s` |
  | 90 | | `1m 30s` |
  | 700 | | `11m 40s` |
  | 65 | | `1m 5s` |
  | 400 d | | `400d` |

  Edge cases: 0.9996 rounds to 1000 ms, falls through, and gives `1s`. -0.0004 gives `0s`, not `-0s`.
  86399 rounds to 1440 min, re-decomposes to `1d` with no stray `0h`. When rounding carries, it always lands on an
  exact higher unit, so re-decomposing can never show an unrounded lower unit.
- **Product calls P1-P7.** All are reversible display choices and consistent with each other and with D2 and the
  spec. P6 (the unit suffix is kept) can produce `5m 30s s` if an author left `unit: "s"`. That is recorded and goes
  to owner review, so it is acceptable.
- **Scope.**
  - AC1 is covered by tasks 2.1 and 4.1.
  - AC2 is covered by tasks 2.4 and 4.4 (editor), 1.1, 1.2 and 4.5 (backend and schema), and 2.5 (helio-mcp).
  - AC3 is covered by D6 and task 4.3.
  - Extending the ticket to collection matches the ticket title. No migration, no API shape change.
- **Seam-test vacuity probe.** I counted bare-word matches inside today's doc text, before any change:

  | Word | Backend `KeysDoc` | helio-mcp `OUTPUT_CONFIG_KEYS_DOC` | `create-output-request.schema.json` |
  |---|---|---|---|
  | `number` | 2 | 1 | 1 |
  | `text` | 2 | 0 | 1 |
  | `duration` | 0 | 0 | 1 |
  | `integer`, `currency`, `percent`, `durationMs`, `date` | 0 | 0 | 0 |

  `number` already appears in "whole number" text. `text` appears as "optional text". `duration` appears in the
  schema's "ISO-8601 duration" text. See change request 2.

### Verdict: REFUTE

The design is close to sound. Two gaps would let a defect through every planned test, and one spec/design
contradiction needs fixing. All three are cheap revisions to the artifacts.

### Change Requests

1. **D4 / `useOutputColumnFormats`: a stale `unit` leaks across selections (design is ambiguous on a real bug path).**
   - **The hazard.** `setFormat` builds the next spec as `{ ...existing, type }`
     (`useOutputColumnFormats.ts`, the carry-forward fix from HEL-469 eval-2). If the duration selections are layered
     onto that spread, `Duration (ms)` -> `Duration (s)` keeps `unit: "ms"`. The column still renders in ms and the
     select reopens as `Duration (ms)`. The detour `Duration (ms)` -> `Number` -> `Duration (s)` silently brings
     `ms` back.
   - **Why nothing catches it.** D4 says `duration <-> { type: "duration" }` but does not say how that squares with
     the carry-forward. Task 4.4 only tests selections starting from a fresh column.
   - **Revise D4 to state explicitly:**
     - Choosing `Duration (s)` removes `unit` (or writes `unit: "s"`; pick one).
     - Choosing `Duration (ms)` writes `unit: "ms"`.
     - Choosing a non-duration type drops `unit`. `unit` belongs to duration, and the carry-forward rule exists for
       sub-options this editor does not expose, which `unit` is not.
     - `selections` derives `durationMs` from `type === "duration" && unit === "ms"`.
   - **Add to task 4.4:** the ms -> s switch, and the ms -> number -> s round trip, each asserting the saved spec
     and the reopened selection.
2. **D8 / task 4.5: the "doc names every value" seam assertions are vacuous for part of the vocabulary.**
   - **The problem.** As measured above, a substring or bare-word check that `KeysDoc` names `number` or `text`
     passes on today's text, before any change. The same holds for the helio-mcp doc with `number`, and for the
     schema with `duration`. The check cannot fail for those values, which is exactly the vacuous-guard pattern C1
     forbids.
   - **Revise D8 to require a failable assertion.** Either works:
     - (a) Hold the vocabulary as a backend constant, e.g. a `MetricFormats` / `ColumnFormatTypes` list (like
       `ChartTypes.AllList` feeds `KeysDoc` today). `KeysDoc` is built from it, and the backend test asserts the
       constant equals fixture list (a) exactly.
     - (b) Assert the exact vocabulary fragment, e.g. a sentence or backticked or pipe-joined list, in each doc.
       helio-mcp is pinned the same way.
   - **Also:** either add the schema descriptions to the seam assertion, or state in D8 that they are pinned
     elsewhere (D7 updates them, but no test covers them).
3. **Spec vs D4: metric/collection editor labels.** The spec's "Editor selection" requirement says the metric and
   collection Format select SHALL offer `Duration`, and that saving writes `"duration"` or `"durationMs"`. It never
   names the `Duration (ms)` option that D4 adds. Add `Duration (ms)` to the requirement, and to its scenario or a
   second scenario, so the spec and D4 agree and the ms path in the editor has an acceptance signal.

### Non-blocking notes

- D2 should say explicitly that rounding runs on the magnitude, with the sign re-applied afterwards. JS
  `Math.round(-1.5) === -1` is not half away from zero, so an implementer who rounds the signed value gets
  asymmetric results.
- The Context section's consumer list omits `MetricOutputPanel.tsx:119` (the baseline tooltip text). It is covered
  automatically through `formatMetricValue`, and a test there would be cheap.
- "Days uncapped, plain digits": for huge finite inputs (around 1e21 s and up), `String(n)` switches to exponent
  notation. Either accept that or format the day count with `useGrouping: false` via `Intl.NumberFormat`. This is
  a cosmetic edge case.
- `TableDisplayFields.isColumnFormatSelection` must also accept the two new selections. Otherwise the select
  silently ignores them. Task 2.4 should name it so it isn't found only by a failing test.
