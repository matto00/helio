## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 000c1dfa5769d2e2418c2494922fdb35b8c1f2d5. The change dir is untracked; the artifacts were read from disk.

### What I verified (with evidence)

**Owner rulings.** `/home/matt/Development/helio/.concertino/runs/HEL-1502/events.jsonl` line 5 is `escalation.answered`, escalation_id `HEL-1502-1791866823310-75f270`, `answer_source: human`, `resolution_channel: chat`, sub_answers `["accept-postgres-offsets","widen-parser","iso-instant-both","bound-epoch-range"]`. That matches the design table. The line-4 `escalation.raised` context says "Items 4 and 6 ... will be delivered as written" and "Schema inference (looksLikeTimestamp) is NOT widened under any option". Those are the **orchestrator's** commitments, and the owner answered within them. The owner did not state them (see CR5).

**Design Context claims, checked against the live tree (TimestampParsing.scala, CastStep.scala:88-99, PipelineRowJson `case JsNumber(n) => n.toDouble`) and by jshell probes on JDK 21.0.12:**

| Claim | Result |
|---|---|
| `parseNonEpochInstant` order Instant / ODT / ISO_LOCAL_DATE_TIME / space / LocalDate | TRUE (TimestampParsing.scala:52-59) |
| `OffsetDateTime.parse("2026-07-01T12:00:00+00")` resolves to 12:00Z | TRUE |
| `T…+0530` fails today; space+offset fails today | TRUE (both ERR) |
| `ZonedDateTime.parse(ISO_DATE_TIME)`: bare `[Europe/Paris]` fails; `+02:00[Europe/Paris]` gives 10:00Z; `+05:00[Europe/Paris]` gives 07:00Z | TRUE |
| SMART `MM/dd/yyyy` clamps `02/30/2026` to 2026-02-28 | TRUE (also `02/31`; `02/32` fails) |
| `Instant.ofEpochMilli(Long.MIN_VALUE)` = `-292275055-05-16T16:47:04.192Z` | TRUE |
| A Double epoch stringifies as `1.7712864E9` | TRUE |
| Fixture flags only `MM/dd/yyyy` as `backendParseInstant: false` (2 cases); the parity spec has the "frontend-only extension" test with `should not be empty` | TRUE (ChartTimestampParsingParitySpec.scala:37-44; chartTimeAxis.test.ts:35 also asserts an extension exists) |
| D5 boundaries: `-62135596800`s = 0001-01-01T00:00Z, `253402300799999`ms = 9999-12-31T23:59:59.999Z, `9999999999`s = year 2286 | TRUE |
| Compute summary already has a `::before` chevron and `tap-expand-44`; `.usage-card__summary` has neither | TRUE (PipelineDetailPage.css:2074-2107, ComputeFunctionReference.tsx:28, UsageCard.tsx:36) |
| `tap-expand-44` owns `::after` | TRUE (shared/ui/tapTarget.css:68-90) |
| `tapTarget.css` is wired via a global import | TRUE (main.tsx:14) |
| Functions list and item gaps are both `--space-1` | TRUE (PipelineDetailPage.css:2109-2128) |

**Spec deltas.** All three MODIFIED requirement headers match the base specs exactly. A scenario-title diff against the base shows only additions, so no existing scenario is dropped. `first-run-dashboard-build` defines date-like as "parseable by the datebucket step's own date parser", so it follows the widening with no delta needed. No API, schema or migration impact.

**Ticket AC coverage.** Item 1 → D1. Item 2 → D4. Item 3 → D2 + D3. Item 4 → D7. Item 5 → D5. Item 6 → D8. Every item is delivered or covered by a recorded ruling.

**Focus items requested by the orchestrator.**

- **D3 (cast keeps exactly what `parseInstant` accepts).** I judge this within authority, not a hidden product call.
  - HEL-1436 owner ruling 1 is `null-on-unparseable` (archive `2026-10-10-cast-float-timestamp-runtime/ticket.md:17`). The "either reader" disjunct was a HEL-1436 *design* decision (its D3), not an owner ruling.
  - The `narrow-cast` option the owner declined nulled the *whole* `MM/dd/yyyy` and region shapes. D3 nulls only values that are not real calendar dates.
  - The chart's `utcMillis` already rejects `02/30/2026` (chartTimeAxis.ts:96-99), so STRICT keeps the chart and backend in parity.
  - I verified D3's premise that the parser covers everything inference accepts except SMART-clamped dates. It holds for offsets (incl. `+HH:MM:SS`), fractions, lowercase `t`/`z` and year widths: `01/05/12026` is rejected by both inference and `uuuu` STRICT. It holds for the region suffix **only if** the backend region reader stays at least as broad as `ISO_DATE_TIME`'s, which constrains the fix for CR1.
  - The residual gap (DatasetRowValidator/inference still call `02/30/2026` a timestamp) is pre-existing and disclosed.
- **D6 (removing the "frontend-only extension" test).** Sound. Once `MM/dd/yyyy` is backend-parsed, the extension set is empty, and every case becomes a strict parity case on both sides, which is a stronger guard. See the non-blocking note on flag ambiguity.
- **D7.** Composing `tap-expand-44` and putting the chevron on `::before` is correct: the utility owns `::after` and itself sets `position: relative` on the element. One factual error is in CR4.
- **Frontend parity port of D1/D2/D5.** D5 is fine. D1 and D2 have real divergences, in CR1 and CR2.

### Verdict: REFUTE

### Change Requests

1. **D2's "exact mirror" claim for the region suffix is false. As designed, the chart and backend disagree on four classes of input** (design.md D2, second bullet; tasks.md 4.2). Backend `ZonedDateTime.parse(s, ISO_DATE_TIME)` probed on JDK 21:
   - **Zone ids are checked against the tz database and are case-sensitive.** `+02:00[Bogus/Zone]` and `+02:00[europe/paris]` give ERR. The proposed frontend class `[A-Za-z0-9_+\-/]+` would accept both.
   - **Offset-style zone ids parse.** `+02:00[+05:00]`, `+02:00[UTC+01:00]` and `+02:00[GMT+05:00]` give 10:00Z. The frontend class has no `:`, so it would reject them.
   - **Only `Z|±HH:MM(:SS)` may precede `[`.** `T…+00[UTC]` and `T…+0530[UTC]` give ERR. "Parse the offset and ignore a trailing `[...]`" would accept them once D1 adds `+HH`/`+HHMM`.
   - **Space-separated forms with a suffix are rejected.** `2026-07-01 12:00:00+00:00[UTC]` gives ERR.

   Required: pick one region-suffix grammar that both sides can implement identically and state it exactly in D2 and the spec delta. For example, make the backend syntactic too: strip a trailing `\[[A-Za-z0-9_+\-/:]+\]` only after a `T`-separated `Z|±HH:MM(:SS)` and parse the rest with the existing offset readers. That keeps the parser a superset of inference's set, so D3's premise still holds. Then add fixture cases pinning every class above (`[Bogus/Zone]`, `[europe/paris]`, `[+05:00]`, `[UTC+01:00]`, `+00[UTC]`, `+0530[UTC]`, space + offset + `[UTC]`). C3 only enforces cases that are in the fixture, so these must be listed for parity to mean anything.

2. **D1 must pin the boundaries of the offset grammar, including the ±18:00 bound on the frontend.**
   - "Offsets are bounded to ±18:00, which `ZoneOffset` already enforces" holds only for the backend. The frontend `offsetSeconds` (chartTimeAxis.ts:102-108) checks `h > 18` per component, so `+18:30` and `+18:00:01` are accepted. Backend `OffsetDateTime.parse("…+18:30")` gives ERR (probed). This is a pre-existing `T`-form divergence that D1 spreads to every new offset form.
   - D1 also leaves the Java formatter unspecified. JDK offset patterns differ in leniency: `appendOffset("+HH:MM:ss")` rejects `+0530`, while the lenient ISO offset accepts `+00`. So the implemented grammar could silently include or exclude forms like `+053015`, `+5` or `+05:3` on one side only.
   - Required:
     - State that the frontend enforces total |offset| ≤ 18:00.
     - Add negative fixture cases: `+18:30`, `+053015`, `+5`, `+05:3`, space + `+0530:15`.
     - Add those values to task 1.1 / 4.1 / 4.2.

3. **Tasks miss two existing artifacts that this change makes wrong.**
   - `backend/src/test/scala/com/helio/services/firstrun/FirstRunPlannerSpec.scala:29` ("NOT treat an MM/dd/yyyy column as date-like, since datebucket cannot parse it") will go red. Task 3.1 says "add a classifier test" rather than invert this one.
   - The `ColumnClassifier.scala:32-33` scaladoc ("Non-ISO formats such as MM/dd/yyyy are therefore NOT date-like") becomes false.
   - Required: name both in task 3.1. Invert the existing test under the `widen-parser` ruling and record it in files-modified.md per 2.4. Update the scaladoc.

4. **D7 misstates the `tap-expand-44` positioning requirement.**
   - Design: "The usage card's parent must satisfy `tap-expand-44`'s positioning requirement ... add `position: relative` where needed". In fact `.tap-expand-44` itself sets `position: relative` on the element (tapTarget.css:69-71), and the hit-expander resolves against the summary, not the parent.
   - Required: correct the sentence so the executor does not add a stray `position: relative` to `.usage-card__details`.
   - Also pin the wiring decision rather than hedging "an import from each consumer, or the `shared/ui/index.ts` convention": `tapTarget.css` is a global import in `main.tsx:14`, so do the same or name the per-component import.

5. **Attribution of C2.** design.md says "The owner also stated: items 4 and 6 ship as written, and schema inference is not widened", and tasks.md C2 calls it an "owner directive". The record (events.jsonl line 4) shows these were the orchestrator's stated scope in the escalation context, which the owner answered within. Required: reword to "escalation context (orchestrator commitment, answered by the owner without objection)". The constraint itself stays.

### Non-blocking notes

- **D6 flag ambiguity.** "Remove ... the `backendParseInstant` flag semantics. The fixture becomes pure parity (every case `true`)" can be read as dropping the field or keeping it all-`true`. Pick one. If the field is dropped, update `FixtureCase` in chartTimeAxis.test.ts:15 and the line-35 assertion in the same commit.
- **The `widen-parser` option text was built on a wrong premise.** The escalation option said it "also fixes CSV columns inferred as timestamp from MM/dd/yyyy". Since HEL-893, CSV inference never types a column `timestamp`; JSON/REST/SQL sources do. This does not change the ruling's effect, but the PR body should not repeat the claim.
- **Usage card touch check.** The usage card summary's 44px expander overhangs by about 8px toward the chart canvas above and the table (margin-top `--space-2`) below. Include it in the 5.5 real-touch check, since the compute side needed a measured clearance fix for the same overhang.
- **New CSS-wide guards.** `theme/focusRingTokenGuard.css.test.ts` and `motionTokenGuard.css.test.ts` scan every stylesheet, so the new `disclosureSummary.css` will be checked automatically. Expect them in the gate run.
- **PR body.** It must call out both observable narrowings/widenings: cast nulls `02/30/2026`-style values, and first-run builds a time-series for `MM/dd/yyyy` and Postgres-offset CSV columns.
