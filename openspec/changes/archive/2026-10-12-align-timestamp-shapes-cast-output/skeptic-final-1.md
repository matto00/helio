## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `73b91084aff294a469269800e22dbad87f6c1a5a`. HEAD did not move during the review.
Diff base: `000c1dfa5769d2e2418c2494922fdb35b8c1f2d5`, resolved live with `resolve-review-base.sh` (exit 0).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/timestamp-cast-shape-followups/HEL-1502`.

**Owner rulings come from ground truth.** In `.concertino/runs/HEL-1502/events.jsonl`:
- Line 4 is the `escalation.raised` with four sub-questions.
- Line 5 is the `escalation.answered`: `answer_source: human`, `escalation_id: HEL-1502-1791866823310-75f270`, and `sub_answers` `["accept-postgres-offsets","widen-parser","iso-instant-both","bound-epoch-range"]`.

These match design.md's rulings table.

**Each acceptance criterion traced to code.**
1. **Postgres offsets.** `TimestampParsing.scala` `OffsetDateTimeRegex` + `parseWrittenOffset` + `offsetOf` use `ZoneOffset.ofHoursMinutesSeconds` with the sign on every component. A space separator with `Z` is excluded.
2. **Epoch cast to ISO.** `CastStep.castTimestamp`: non-String values go through `epochInstant(raw).map(_.toString)`, and String values keep their original text.
3. **Cast/datebucket/compute alignment** (`widen-parser`):
   - The parser gains STRICT `MM/dd/uuuu` and a syntactic `[id]` suffix.
   - Cast keeps a value iff `parseInstant` accepts it, and the `looksLikeTimestamp` disjunct is gone.
   - `looksLikeTimestamp` itself is untouched (C2): it does not appear in the diff.
4. **Shared disclosure recipe.** `frontend/src/shared/ui/disclosureSummary.css` is imported in `main.tsx`. Both summaries use `disclosure-summary tap-expand-44`, and the duplicate declarations are removed from `PipelineDetailPage.css` and `UsageCard.css`.
5. **Long.MinValue.** `fromEpoch` filters to `0001-01-01T00:00:00Z..9999-12-31T23:59:59.999999999Z`.
6. **Functions list spacing.** Measured live: list `row-gap` is 8px, item `row-gap` is 4px, and the distance between entries is 8px.

**Differential parity fuzz (C3).** This is my own probe, not the fixture.
- **Inputs:** 209,731 generated inputs covering:
  - 8 dates, 5 separators and 13 times;
  - 31 offsets, including every D1 positive and negative, `+0060`, `+05:30:60` and `+05:30Z`;
  - 13 suffixes: valid, empty, space, unclosed, double, `[ü]` and tz-style;
  - US dates, including `07/01/12026`, `07/01/+2026`, `00/..` and `13/..`;
  - 30 epoch strings at and around the D5 bounds, exponent forms, `-0` and `1e40`;
  - whitespace-padded variants.
- **Backend side:** the compiled HEAD `TimestampParsing.parseInstant`, called directly from a javac probe (classes newer than the source).
- **Frontend side:** the HEAD `parseChartInstant`, transpiled with the repo's `typescript`.
- **Result:** 149 disagreements, and **0 on any shape this change adds** (space or `T` offsets, `HHMM`, `[id]` suffix, `MM/dd/yyyy`, numeric epochs).
- **The 149 are all pre-existing**, on code paths this diff does not touch. Base frontend output is identical, and the backend paths `Instant.parse`/`OffsetDateTime.parse`/`ISO_LOCAL_DATE_TIME`/`SpaceSeparatedFormatter` are unchanged:
  - trailing-dot fraction;
  - year 0000 (frontend accepts);
  - fraction without seconds on a local date-time (frontend accepts);
  - the space-separated local `24:00` and `2026-02-29 12:00` SMART clamp (backend accepts);
  - leap second;
  - extended year.

**Fixture against the base and HEAD frontend parser.**
- The base `parseChartInstant` fails 30 of the 99 cases: every new offset, suffix and bound case, plus `+18:30` and `+18:00:01`, which the base accepted.
- The HEAD parser fails 0.

**RED (backend), genuinely red without the fix.**
- **Setup:** I took a scratch copy of HEAD's `backend/` + `shared-test-fixtures/` and restored the three main sources to base `000c1dfa5`. The only addition was an `epochInstant` stub with base (unbounded) behavior, needed so the new tests compile. I then ran the 6 changed specs.
- **Result:** `Tests: succeeded 204, failed 50`. The 50 failures span:
  - every offset, suffix, `MM/dd/yyyy` and epoch-bound case in `TimestampParsingSpec`;
  - the fixture parity test;
  - all 5 `RED:` cast tests in `CastStepSpec`, including the Double epoch to ISO case;
  - both new `FirstRunPlannerSpec` cases;
  - the `TimestampAgreementSpec` agreement, GUARD and `seconds_between` -5400 tests.
- **Evidence:** `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/skeptic-final-1-red-base.log`

**GUARD is failable by mutation.** The evaluator only reasoned about this; I ran it.
- **Mutation:** on HEAD sources, change `CastStep` to `looksLikeTimestamp(str) || parseInstant(str).isDefined`.
- **Result:** `failed 2`, including `keep no value that datebucket or date_trunc then reads as null`, which reports `cast kept 02/30/2026 as 02/30/2026: None was empty (TimestampAgreementSpec.scala:53)`.
- **Evidence:** `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/skeptic-final-1-guard-mutation.log`

**Gates re-run fresh on HEAD.**
- **Backend:** `sbt testFull` (`HELIO_TEST_JVM_XMX=3g`, nice 19) gave `Suites: completed 576, aborted 0` / `Tests: succeeded 7704, failed 0, canceled 4` / `All tests passed.` (exit 0).
- **Frontend:**
  - `npm run lint` 0, `typecheck` 0 and `format:check` 0.
  - Targeted jest (`chartTimeAxis|disclosureSummary|ComputeFieldConfig|AdminUsagePage|TokenGuard|UsageCard`, 3 workers, nice 19) gave 7 suites and 165 tests passed.
  - I did not re-run the full jest suite. The evaluator reports 577/6932, and the untouched suites cannot be affected by this diff's files.

**UI judgment (DESIGN.md).**

Setup:
- Servers started with `start-servers.sh` and passed `assert-phase.sh servers`.
- I used a throwaway user `hel1502-skeptic-1791871296303@example.test` (id `f4d44009-1e30-4185-b5ea-0f3030f48f85`), instantiated the `ops` template, and added a Compute column step through the UI.

Live computed style of the compute summary:
- class `disclosure-summary tap-expand-44`;
- `inline-flex`, `list-style: none`, min-height 28px (`--control-sm`);
- chevron `::before` at -45° when closed and +45° when open.

Colours:
- dark: muted `rgb(170,164,156)`;
- light: `rgb(100,94,86)`.

Screenshots, dark and light:
- `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/skeptic-final-1-compute-dark-viewport.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/skeptic-final-1-compute-light-viewport.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/skeptic-final-1-compute-dark-open.png`

What the screenshots show:
- The chevron and label sit on the same muted text tone as the step's field labels.
- The entries read as separated groups, with signature and description tight inside each entry.
- Parity holds between themes.

Usage card:
- I reviewed the evaluator's usage-card screenshots, `eval-1-usage-{light-desktop-open,dark-390touch-closed}.png`.
- The new chevron matches the compute recipe. The card's own `font-size: var(--text-xs)` keeps it subordinate to the chart.
- I found nothing off-pattern. All recipe values are tokens (`--space-2`, `--control-sm`, `--weight-medium`, `--app-*`), and the 2px border and focus offset are carried over verbatim from the deleted rules.

Cleanup:
- The user was deleted by exact (id, email) with `buildUserDeleteSql` + `db.cjs psql`, and the follow-up `SELECT count(*)` returned 0.
- Servers were stopped with `stop-servers.sh`, which printed `STOPPED ports=6934,9841`.

**Mtime-ordering evidence.** None is relied on. Every claim above rests on content, test output or code.

### Verdict: CONFIRM

### Non-blocking notes
- **Follow-up candidate** (Follow-up label, relatedTo HEL-1502). Design.md's Non-Goals list three pre-existing backend-only quirks: trailing-dot fraction, leap second and extended years. My fuzz found four more pre-existing chart/backend divergences, which that Follow-up should also cover:
  - The backend `SpaceSeparatedFormatter` uses the SMART resolver, so `2026-02-29 12:00` is read as 2026-02-28T12:00Z. That is the same fabricated-date class D2 rejected for `MM/dd/yyyy`, and cast still keeps it.
  - The same formatter accepts `2026-07-01 24:00` as the next midnight.
  - The frontend accepts year `0000`.
  - The frontend accepts a fraction without seconds on a local date-time (`2026-07-01 12:00.5`).

  None is introduced by this diff. Note that the chart spec's "no frontend-only extension" wording is only literally true over the fixture.
- **Spec scenarios pinned only at parser level.** As the evaluator noted, "a bracketed id never overrides the written offset" (`date_trunc("hour", …)`) and the positive epoch bounds through datebucket are not exercised through the named step.
- **Minimum-count asserts differ.** `chartTimeAxis.test.ts:33` asserts `>= 98` and the backend spec asserts `>= 99`.
- **Task 5.5 is still unticked** in tasks.md, although the evaluator's Phase 3 and this report supply its evidence.
- **Misfiled `DateBucketCharacterisationSpec` row.** The `MM/dd/yyyy` row still sits in the `unchanged` group although its output changed (evaluator note, confirmed).
