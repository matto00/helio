## Standing Constraints

- [C1] Hard rules (driver, 2026-10-12): stop dev servers ONLY with `scripts/concertino/stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`; never kill anything found via `ps -o ppid=` or any parent/grandparent of a server; no pkill/pgrep/killall; Bash timeout 600000; cap test workers at 3 with `nice -n 19`; never print or source backend/.env; no claude.ai session link or Claude-Session trailer; never act as matt@helio.dev (throwaway @example.test users only, deleted by exact (id, email) via e2e/support/userCleanupCore.cjs `buildUserDeleteSql`); follow-ups get the Follow-up label and relatedTo HEL-1502; driver statements are claims to verify.
- [C2] Do not change `TimestampParsing.looksLikeTimestamp` (schema inference / DatasetRowValidator). This is an orchestrator commitment carried in the escalation the owner answered within.
- [C3] The chart parser and the backend parser stay case-by-case equal through `shared-test-fixtures/chart-timestamp-parsing.json`; a new shape is never added to one side only.

## 1. Shared parser (backend)

- [x] 1.1 RED first: add `TimestampParsingSpec` cases for:
  - every D1 positive and negative offset case on both separators, including the negatives `+0530:15` and `+053015`;
  - D2 `MM/dd/yyyy` (`07/01/2026`; `02/30/2026`→None; `1/5/2026`→None);
  - every D2 region-suffix accepted/null case listed in design.md; and D5 (`-62135596800000` accepted as 0001-01-01, `-62135596800001` null, `-62135596800` accepted as 1968 millis, `253402300799999`, `253402300800000`, `Long.MinValue`/`Long.MaxValue` strings and numbers); confirm they fail on the unmodified tree.
- [x] 1.2 Implement in `TimestampParsing.scala`:
  - D1: the regex-driven reader per the `OFFSET` grammar (applying the sign to every component), with `ZoneOffset.ofHoursMinutesSeconds` and STRICT local parsing;
  - D2: STRICT `MM/dd/uuuu`, and the syntactic `[id]` suffix strip. The prefix must match the D1 regex, and is never passed to `ZonedDateTime`/`Instant`/`OffsetDateTime.parse`; and D5 (epoch instant bounded to 0001..9999) in `TimestampParsing.scala`; expose `epochInstant(value: Any): Option[Instant]` (D4). Update the scaladoc listing accepted shapes. Leave `looksLikeTimestamp` untouched (C2).
- [x] 1.3 Datebucket / compute / window-day-frame agreement: extend the existing agreement spec (or add one) with the spec delta's "datebucket and compute agree" and "rejected shapes" scenario values, plus the `seconds_between` Postgres-offset scenario (-5400 = end − start).

## 2. Cast (backend)

- [x] 2.1 RED first: cast tests for a JSON-number epoch (Double from row JSON) → `"2026-02-17T00:00:00Z"` for `timestamp`, `"…00.123Z"` for `date`; numeric string unchanged; `02/30/2026` → null; `2026-07-01 12:00:00+00` kept.
- [x] 2.2 Implement D3 (keep iff `parseInstant` accepts) and D4 (non-String numeric epoch → `Instant.toString` via `epochInstant`) in `CastStep.castValue`. Update the HEL-1436 D3 comment to state the new alignment.
- [x] 2.3 Guard: cast→datebucket and cast→`date_trunc` over every accepted shape in the spec delta — no value the cast keeps is read as null downstream. Label it GUARD (mutation-failable: reintroduce the `looksLikeTimestamp` disjunct with SMART `02/30/2026` input and show red).
- [x] 2.4 Check `CastRuntimeParitySpec` and every existing cast/timestamp spec still passes; fix only tests whose expectation the owner rulings change, and list each such change in files-modified.md with the ruling that justifies it.

## 3. First-run classifier

- [x] 3.1 First-run classifier (`backend/src/main/scala/com/helio/services/firstrun/ColumnClassifier.scala`, test `backend/src/test/scala/com/helio/services/firstrun/FirstRunPlannerSpec.scala`):
  - Invert `FirstRunPlannerSpec`'s "NOT treat an MM/dd/yyyy column as date-like, since datebucket cannot parse it" (line ~29). An `MM/dd/yyyy` column is now date-like.
  - Add a Postgres-offset column case.
  - Keep or confirm a case where an all-digit id column is still not date-like.
  - Update the `ColumnClassifier` scaladoc (~lines 32-33) so it no longer claims `MM/dd/yyyy` is excluded.

## 4. Chart parser parity (frontend + fixture)

- [x] 4.1 Update `shared-test-fixtures/chart-timestamp-parsing.json` per D6:
  - Drop the `backendParseInstant` field from every case.
  - Add every D1, D2 and D5 positive/negative case from design.md (including `+0530:15`), with exact `epochMillis`.
  - Keep every existing rejected case.
- [x] 4.2 Update `parseChartInstant` in `frontend/src/utils/chartTimeAxis.ts`:
  - the D1 `OFFSET` grammar on `T` or space (space never with `Z`), rejecting `+0530:15`/`+053015`, with `offsetSeconds` enforcing HH≤18, MM/SS≤59 and a total ≤ 18:00;
  - the D2 syntactic `[id]` suffix (`[A-Za-z0-9_+\-/:]+`) only after an offset/`Z`;
  - the 0001..9999 epoch bound, replacing `MAX_JS_DATE_MS`.
- [x] 4.3 Both parity sides assert a minimum fixture case count. `ChartTimestampParsingParitySpec`: remove the "frontend-only extension" test (now empty), update the doc comment; `chartTimeAxis.test.ts` iterates the same fixture — adjust only its extension handling. Both sides green.

## 5. Disclosure-summary recipe and Functions spacing (frontend)

- [x] 5.1 Add `frontend/src/shared/ui/disclosureSummary.css` with `.disclosure-summary`:
  - a chevron `::before` that rotates on `details[open] >`;
  - the native marker suppressed, including `::-webkit-details-marker`;
  - min-height `--control-sm`;
  - weight;
  - muted→full color on hover;
  - a focus-visible ring;
  - radius.

  Import it globally in `frontend/src/main.tsx`, next to `./shared/ui/tapTarget.css`.
- [x] 5.2 `ComputeFunctionReference.tsx` and `UsageCard.tsx` use `disclosure-summary tap-expand-44`; delete the duplicated declarations from `PipelineDetailPage.css` and `UsageCard.css`; confirm no ancestor `overflow` clips the usage card's 44px expander and that it overlaps no neighbouring control (no parent `position` change needed — `.tap-expand-44` sets it). Keep the compute reference's coarse-pointer `margin-top` rule.
- [x] 5.3 `.pipeline-detail-page__compute-functions-list` gap → `var(--space-2)`; item gap stays `--space-1`.
- [x] 5.4 Tests: update/extend `ComputeFieldConfig.test.tsx` and add a UsageCard assertion that each summary carries `disclosure-summary` and `tap-expand-44`; add a CSS-source guard only where the repo already uses that pattern (`*.css.test.ts`).
- [x] 5.5 (verified by evaluation-1.md Phase 3 and skeptic-final-1.md; coarse pointer at an iPad-class width and a physical device remain unverified) Visual check in the running app (both themes, desktop + 390px coarse): compute Functions summary and admin usage "View as table" show the chevron, open/close rotates it, and the 44px hit area works (real-touch / coarse-pointer check on BOTH summaries, including the usage card's overhang); entries in the Functions list are visibly more separated than lines within an entry. Screenshots go in the change dir, not repo root.

## 6. Gates

- [x] 6.1 Backend: `sbt testFull` (nice -n 19, `HELIO_TEST_JVM_XMX=3g`), not bare `sbt test`.
- [x] 6.2 Frontend: `npm run lint`, `npm run typecheck`, `npm run format:check`, `HELIO_JEST_MAX_WORKERS=3 nice -n 19 npm test`.
- [x] 6.3 `openspec validate align-timestamp-shapes-cast-output --type change`.
