## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `bcb0e891923094c1a1e85ecc053f30a73ee6d70f`. The planning artifacts are untracked in the change dir and there is no code diff yet.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/duration-format-type/HEL-1308`.

#### Round-1 change requests, re-checked against the code

**CR1 (stale `unit`): RESOLVED.**
- Today `useOutputColumnFormats.ts` `setFormat` builds `existing ? { ...existing, type } : { type }`. That is the carry-forward hazard.
- D4 now says `setFormat` stops spreading `unit`, and that each selection writes `unit` explicitly:
  - `duration`: no `unit`
  - `durationMs`: `unit: "ms"`
  - any non-duration type: `unit` removed
- Other sub-options keep today's carry-forward.
- The spec's Editor-selection requirement has a matching scenario ("Switching a column away from milliseconds drops the unit"). Task 4.4 tests both ms -> s and ms -> Number -> s.
- D4 and task 2.4 name `TableDisplayFields.isColumnFormatSelection`. Today it lists only none/number/currency/date/text (`TableDisplayFields.tsx:37-45`), so it does need the change.

**CR2 (vacuous vocabulary checks): RESOLVED.**
- D8 now uses single-source constants on each side and exact-equality checks against the fixture: lists (a), sentence (d) and schema descriptions (e).
- Every check I looked at can fail before the change:
  - **Frontend arrays and helio-mcp arrays:** missing `duration` before the change, so they fail.
  - **Backend `OutputFormatVocabulary`:** does not exist before the change, so the test does not compile.
  - **Schema descriptions:** today the descriptions are exactly `"Metric and collection kinds."` and `"Table kind only."`, so an exact check fails. They are identical in all three files (`schemas/outputs/create-output-request`, `schemas/outputs/update-output-request`, `schemas/pipelines/create-pipeline-transactional-output-request`, measured with a JSON walk). That means one fixture pair (e) works for all three.
- The round-trip test is honestly labelled a guard, with a mutation that turns it red.
- Both sides can read `shared-test-fixtures/`: backend seam specs (e.g. `ConditionalFormatsSeamSpec`) and helio-mcp (`joinStepSeam.test.ts`) already do.
- `KeysDoc` currently ends with "...lives on the panel's appearance.chart.", so "ends with Doc" is a well-defined check.
- Existing pins are all `should include` (`OutputConfigValidationSpec:161-166`, `AssistantProposalToolSchemasSpec:284,293`, `RefinementEditShapeSpec:387,391`). Appending text does not break them.

**CR3 (editor labels): RESOLVED.**
- The spec names `Duration` and `Duration (ms)` for metric/collection, and `Duration (s)` and `Duration (ms)` for table, and has a collection `durationMs` scenario.
- `OutputKindConfigCard.tsx:195` reuses `METRIC_FORMAT_OPTIONS` (`OutputKindFields.tsx:231`), so a single list does serve collection.

**Round-1 non-blocking notes:** all addressed.
- D2 now says rounding runs on the magnitude with `Math.floor(x + 0.5)`.
- Exponent notation is avoided by using `Intl.NumberFormat` with `useGrouping: false`.

#### Fresh checks of the current artifacts

- **Ground truth for D6 (fallback).**
  - `formatMetricValue` (`MetricRenderer.tsx:31-55`) returns empty or non-finite input unchanged before the switch.
  - `formatColumnValue` (`columnFormatting.ts:44-88`) falls back to `formatCell`, which gives `—` for null.
  - The comparison delta goes through `formatMetricValue(String(absDelta), format)` at `MetricRenderer.tsx:93`.
  - The rule is resolved on the raw value at `MetricRenderer.tsx:129`.
  - The design's claims match.
- **Every numeric spec example against D2.** I implemented D2 literally in a scratch script under both possible readings of "round the total" (see CR1 below):
  - These all match the spec under both readings: 330, 0, 45, 45.6, 0.25, 3600, 3725, 3755, 90061, 59.6, 3599.7, -330, 330000 ms, 1500 ms, 90, 700, 65 and 400 d.
  - So do these edge cases: 86399 -> `1d`, 0.9996 -> `1s`, -0.0004 -> `0s`.
- **The divergence: fractional inputs.** The two readings disagree on fractional inputs, which the spec's rounding rule decides:

  | Input | D2 reading A (round the seconds-rounded total) | D2 reading B (round the original magnitude) | Spec ("round to the smallest unit shown") |
  |---|---|---|---|
  | 3629.5 s, also 3629500 ms | `1h 1m` | `1h` | `1h` (60.49 min) |
  | 88199.5 s | `1d 1h` | `1d` | `1d` (24.4999 h) |

  Reading A is the more natural reading of "round to whole seconds, decompose ... round the total to whole V". It double-rounds, which contradicts the spec's requirement and P4. Task 4.1 contains no case that tells the two readings apart, so either implementation passes every planned test.

  This is realistic data: an integer-ms CI duration of 3629500 ms becomes exactly 3629.5 s. An `avg` aggregation of seconds is fractional as well.
- **P1-P7.** All are reversible display choices, consistent with each other and with D3/D4/D6. P4 is the one that D2 can violate (above).
- **Scope and AC coverage.**
  - AC1 is covered by tasks 2.1 and 4.1.
  - AC2 is covered by tasks 2.4 and 4.4 (editor), 1.1, 1.2 and 4.5 (backend and schema), and 2.5 (helio-mcp).
  - AC3 is covered by D6 and task 4.3.
  - There is no migration and no API shape change.
- **Placeholders.** None that block. D1's "executor picks the util location" is a bounded, non-behavioural choice.

### Verdict: REFUTE

One internal contradiction: D2 can be read in a way that double-rounds, which contradicts the spec's rounding requirement and P4, and no planned test can tell the readings apart. The fix is one sentence plus two test cases.

### Change Requests

1. **D2 / task 4.1: remove the double-rounding ambiguity.**
   - **Revise D2** so the second rounding is explicitly applied to the original magnitude `|v|` (in seconds), not to the value already rounded to whole seconds. For example: "if U is d, h or m, set total = floor(|v| / V + 0.5) * V and re-decompose". The whole-second rounding is used only to choose U.
   - **Add to task 4.1** (and optionally to the spec's "Rounding carries" or a new scenario) at least `3629.5` -> `1h` and `88199.5` -> `1d`, both as seconds. Also add a ms case such as `3629500` ms -> `1h`.
   - **Why this fails today.** These cases go red under the double-rounding implementation (`1h 1m`, `1d 1h`), so they are failable guards for the spec's "round to the smallest unit shown" rule.

### Non-blocking notes

- `readColumnFormats` should keep `unit` only when `type === "duration"`, not on any type. D3 says only "keeps `unit` only when it is exactly s or ms". Otherwise an agent-written `{ type: "number", unit: "ms" }` survives a read and is carried forward by the editor for no reason. This is harmless, because the formatter ignores it.
- An agent-written `{ type: "duration", unit: "minutes" }` is read as seconds, because the unknown unit is dropped. That is consistent with the existing tolerant-read policy. It may be worth stating in the vocabulary sentence that the default is `s`.
- P6 can produce `5m 30s s` when a metric has a `unit` column. It is already recorded for owner review.
