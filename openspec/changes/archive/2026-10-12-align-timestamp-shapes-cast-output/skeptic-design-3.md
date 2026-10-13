## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD `000c1dfa5769d2e2418c2494922fdb35b8c1f2d5`. The change dir is untracked, so the planning artifacts were read from disk.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/timestamp-cast-shape-followups/HEL-1502`.

**Owner rulings.** I read `.concertino/runs/HEL-1502/events.jsonl` lines 4–5 (escalation_id `HEL-1502-1791866823310-75f270`). The answers are `["accept-postgres-offsets","widen-parser","iso-instant-both","bound-epoch-range"]`, from source human over chat. They match the design.md table. The context line states that items 4 and 6 ship as written and that looksLikeTimestamp is not widened. design.md and tasks C2 now attribute this as an orchestrator commitment, not an owner directive (round-1 CR5 closed).

**Round-2 CRs:**
1. **D5 lower bound.**
   - design D5, the spec scenario "epochs outside years 0001-9999" and task 1.1 now use `-62135596800000` (accepted, 0001-01-01), `-62135596800001` (null) and `-62135596800` (accepted as 1968, millis).
   - D5 states that year 0001 is only reachable as milliseconds.
   - JDK 21 probe: `Instant.ofEpochMilli(-62135596800000)` = `0001-01-01T00:00:00Z`; `-62135596800001` = `0000-12-31T23:59:59.999Z`, which is outside the bound; `-62135596800` = `1968-01-12T20:06:43.200Z`; `253402300799999` = `9999-12-31T23:59:59.999Z`; `253402300800000` = `+10000-01-01`.
   - The spec's expected buckets (`9999-12-31`, `0001-01-01`, null, `1968-01-12`) are correct.
   - CLOSED.
2. **`seconds_between` sign.**
   - The spec scenario and task 1.3 both say `-5400`.
   - Base spec `compute-expression-language/spec.md:445` defines `end - start`, and `ExpressionDateTimeFunctions.scala` uses `Duration.between(s, e)`.
   - end 12:00Z − start 13:30Z = −5400.
   - CLOSED.
3. **`+0530:15`.**
   - It is in the D1 fixture negatives (both separators), tasks 1.1, 4.1 and 4.2, and the spec's "out-of-range offsets are rejected" scenario.
   - JDK probe: `Instant.parse` and `OffsetDateTime.parse` both reject it on `T`, `t` and space.
   - CLOSED.

**Round-1 CRs (re-checked so they do not regress):**
- CR1: D2 is now one syntactic grammar on both sides. The prefix must match the D1 regex, it is never fed to `Instant`/`OffsetDateTime`/`ZonedDateTime.parse`, and the id class `[A-Za-z0-9_+\-/:]+` is not tzdb-validated. Fixture cases pin `[Bogus/Zone]`, `[europe/paris]`, `[+05:00]`, `[UTC+01:00]`, `+00[UTC]`, space `+0530[...]` and space+`Z[UTC]` (null).
- CR2: the frontend total ≤ 18:00 is stated, and the negatives are listed.
- CR3: task 3.1 names `FirstRunPlannerSpec.scala:29` (confirmed at that line) and the `ColumnClassifier.scala:32-33` scaladoc (confirmed).
- CR4: D7 is corrected. `tapTarget.css:68-71` sets `position: relative` on `.tap-expand-44` itself, and `main.tsx:14` imports `./shared/ui/tapTarget.css` globally, as D7 now pins.
- CR5: closed (see above).

**Fresh review: D1 grammar claims probed on JDK 21.0.12**

Separators `T`, `t` and space × 18 offsets:
- `OffsetDateTime.parse` on `T`/`t` accepts `+00`, `-00`, `+05`, `+05:30`, `+05:30:15`, `+18:00`, `Z` and `z`.
- It rejects `+0530`, `-0330`, `-1800`, `+18:30`, `+18:00:01`, `+053015`, `+0530:15`, `+5`, `+05:3` and `+19`.
- Every space-separated form is rejected today.

This matches D1's "today's T-form set plus ±HHMM, now also on space" exactly. Other probes:
- `ZoneOffset.ofHoursMinutesSeconds(-3,-30,0)` = `-03:30`; `(-3,30,0)` gives ERR (mixed sign); `(18,0,1)` gives ERR. This confirms the "sign on every component" note.
- STRICT `MM/dd/uuuu` rejects `02/30/2026` and accepts `07/01/2026`. STRICT with `yyyy` rejects even valid dates, so the design's explicit `uuuu` is load-bearing and correct.

**Fresh review: code-premise claims**
- `CastStep.scala:98-99` is `looksLikeTimestamp(str) || parseInstant(raw).isDefined` and keeps `v.toString`.
- `PipelineRowJson.jsValueToAny` maps `JsNumber` to `n.toDouble`, so the scientific-notation premise holds.
- `fromEpoch` has no year bound.
- `chartTimeAxis.ts`: `ISO_ZONED` is case-insensitive and allows only `Z|±HH:MM(:SS)`. `offsetSeconds` checks `h > 18` per component, so `+18:30` is accepted today. `MAX_JS_DATE_MS` is the current bound. `US_DATE` is the frontend-only extension.
- Fixture: 41 cases, exactly two `backendParseInstant: false` (`10/01/2026`, `12/31/2025`). No existing case conflicts with the new grammar. Lowercase `t…z` is already pinned.
- `ChartTimestampParsingParitySpec` has the `extension should not be empty` test that D6 removes. `chartTimeAxis.test.ts:35` has the matching `some(!backendParseInstant)` assertion, which task 4.3 covers.
- The CSS duplication D7 consolidates is real: `PipelineDetailPage.css:2074-2107` and `UsageCard.css:46-64` share the same declarations. `UsageCard.tsx:36` summary has no `tap-expand-44` and no chevron. `.pipeline-detail-page__compute-functions-list` gap is `--space-1`, the same as `-item` (D8 premise holds).

**Spec deltas**
- Every MODIFIED requirement keeps every base scenario by name; the deltas only add.
- I diffed the full `timestamp-value-parsing` requirement. The only change to the cast clause is "either reader" becoming "exactly this parser".
- `first-run-dashboard-build` defines date-like as "parseable by the datebucket step's own date parser", so it stays true without a delta.
- `dataset-schema-validation` still describes `looksLikeTimestamp`, which is unchanged (C2).
- `openspec validate align-timestamp-shapes-cast-output --type change` returned "Change 'align-timestamp-shapes-cast-output' is valid".

**AC coverage**
- Item 1 → D1.
- Item 2 → D4.
- Item 3 → D2/D3.
- Item 4 → D7.
- Item 5 → D5.
- Item 6 → D8.

Each item has tasks with RED-first or guard signals. No item is uncovered and nothing is out of scope.

### Verdict: CONFIRM

### Non-blocking notes

1. **D2's "superset" claim and D3's "only observable narrowing" claim are slightly overstated.** JDK probe: inference's `ZonedDateTime.parse(_, ISO_DATE_TIME)` accepts `2026-07-01T12:00:00.+02:00[Europe/Paris]` (trailing-dot fraction) and `+12026-07-01T12:00:00+02:00[Europe/Paris]` (extended year). The D2 regex rejects both, so cast will newly null them as well as `02/30/2026`. This is behaviorally harmless: they are the same three quirks the Non-Goals exclude, and the downstream readers already null them today because no current reader accepts a suffix. Correct the sentence in D3, in the spec delta and in the PR body, or fold these two into the Delivery Follow-up about un-suffixed quirks.
2. **D6 is clear that dropping `backendParseInstant` is honest.** The executor should still keep a minimum-count assertion like the `cases.length >= 35` check (raised to the new count) on both sides, so an accidental fixture truncation stays red.
3. **Carried forward.** The PR body should call out that cast nulls `02/30/2026`, and that first-run now builds a time-series for `MM/dd/yyyy` and Postgres-offset columns. It must not claim that CSV inference types columns `timestamp`. Note that the escalation question text itself made that inaccurate claim; design Risks already corrects it.
