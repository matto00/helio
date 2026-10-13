## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `73b91084aff294a469269800e22dbad87f6c1a5a` (HEAD did not move during the review).
Diff base: `000c1dfa5769d2e2418c2494922fdb35b8c1f2d5`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS

All six ticket items are delivered, and each follows the owner rulings recorded in design.md:

1. **Postgres offsets** (`accept-postgres-offsets`). `TimestampParsing.parseWrittenOffset`: one regex grammar, both separators, `ZoneOffset.ofHoursMinutesSeconds` with the sign applied to every component. Space-separated `Z` stays rejected.
2. **Epoch casts emit ISO** (`iso-instant-both`). `CastStep.castTimestamp` emits `epochInstant(raw).map(_.toString)` for non-String input on both targets. Numeric strings keep their original text.
3. **Cast aligned with the parser** (`widen-parser`). The parser gains STRICT `MM/dd/uuuu` and the syntactic `[id]` suffix. Cast keeps a value iff `parseInstant` accepts it.
4. **Shared disclosure recipe.** `frontend/src/shared/ui/disclosureSummary.css` is imported globally in `main.tsx`. Both summaries use `disclosure-summary tap-expand-44`, and the duplicate declarations are deleted.
5. **`Long.MinValue`** (`bound-epoch-range`). `fromEpoch` filters to 0001..9999.
6. **Functions list spacing.** The list gap is `--space-2` and the item gap stays `--space-1`.

Other checks:
- No acceptance criterion is reinterpreted.
- **C2 is honored:** `looksLikeTimestamp` and `DatasetRowValidator` are untouched (grep confirms).
- **C3 is honored:** the fixture dropped `backendParseInstant` and has 99 cases, all pure parity. Both sides iterate every case.
- **C1 is honored** in this review: canonical stop script only, 3 workers with nice 19, the throwaway user deleted by exact (id, email).
- Spec deltas match the implementation, and `openspec validate --type change` passes.
- Tasks 1.1 through 6.3 are done and match the code. **Task 5.5 is still unchecked;** Phase 3 below supplies that evidence.

### Executor claims, verified

| Claim | Result | Evidence |
|---|---|---|
| CSS pin 131 to 132 | True | `find frontend/src -name '*.css'` gives 132 at HEAD; `git ls-tree 000c1dfa5` gives 131. The only new file is `disclosureSummary.css`. |
| Fixture case `2026-07-01 12:00.5+00` is null | True, and consistent | The backend regex requires seconds before a fraction, and the frontend rejects `fraction && !sec`. Both sides return null. This mirrors the existing local-time rule. |
| `DateBucketCharacterisationSpec` "keep" label is stale | True | See Non-blocking Suggestions. |

### Phase 2: Code Review — PASS

Gates were re-run fresh in `WORKTREE_PATH`, all with nice 19 and at most 3 workers:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 577 suites / 6932 tests passed |
| `npm --prefix frontend run build` | exit 0 |
| `cd backend && sbt testFull` (`HELIO_TEST_JVM_XMX=3g`) | 7704 tests succeeded, 0 failed, 576 suites, 0 aborted |
| `npm run check:scala-quality` | clean (soft warnings only, all pre-existing) |
| `npm run check:tokens` | OK |
| `check:openspec` | clean |

In the `sbt testFull` run, `TimestampParsingSpec`, `CastStepSpec`, `TimestampAgreementSpec`, `ChartTimestampParsingParitySpec`, `FirstRunPlannerSpec` and `DateBucketCharacterisationSpec` all appear in the log.

Review findings:
- **Imports and qualifiers:** new `java.time` imports are top-of-file, with no inline FQNs.
- **Tokens:** new CSS uses only `--space-*`, `--control-sm`, `--weight-medium`, `--app-*` and `--app-radius-sm`. The `2px` chevron border and the `outline-offset: 2px` focus ring are moved verbatim from the deleted rules, and the focus offset is the sanctioned §8 value.
- **DRY:** both duplicate summary recipes are deleted, and cast reuses `epochInstant` rather than re-deriving the epoch rule.
- **Backend and frontend agree on the offset grammar:**
  - Both have the same regex: `HHMM|HH(:MM(:SS)?)?`, `Z` only after a `T`/`t`, and a fraction only with seconds.
  - Both enforce MM/SS ≤ 59 and a total ≤ 18:00. On the frontend the total check subsumes HH ≤ 18.
  - `-00` resolves to 0 on both sides.
- **Tests meaningful:**
  - The cast GUARD in `TimestampAgreementSpec` includes `02/30/2026` in its inputs. Reintroducing the SMART `looksLikeTimestamp` disjunct would make cast keep it and datebucket return null, so the guard can fail. I verified this by reasoning only; I did not run the mutation.
  - The non-vacuity companion test asserts that every accepted shape is kept.
- **No dead code.** `isTimestampLike` was removed and has no stale references.

### Phase 3: UI Review — PASS (covers task 5.5)

**Setup**
- Servers were started with `start-servers.sh` and passed `assert-phase.sh servers` on ports 6934/9841.
- I exported `HELIO_OWNER_EMAILS=hel1502-eval-owner@example.test` for this run's backend only. A shell-exported value wins over `.env` (`DevEnv.runEnv`), so `backend/.env` was never read or printed by me.
- A throwaway user `hel1502-eval-owner@example.test` (id `ef9b9141-4e26-46b7-9197-5d9dc052da29`) registered as `tier: owner`. That made the real admin usage page reachable without touching matt@helio.dev.
- I instantiated the `ops` template and added a Compute column step through the UI.
- I drove the app with standalone Playwright scripts. Desktop was 1440×900. The 390×844 context used `isMobile` + `hasTouch` with real `touchscreen.tap`. Both themes were covered.
- At the end the user was deleted by exact (id, email) via `buildUserDeleteSql` + `db.cjs psql`. A `SELECT count(*)` for the id then returned 0. Servers were stopped with `stop-servers.sh` (`STOPPED ports=6934,9841`; both ports refuse connections).

**Measurements.** The raw JSON is in `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/eval-1-ui-probe.json`. Both summaries behave the same in both themes:

- **Native marker:** `display: inline-flex` and `list-style: none`, so no native marker appears.
- **Chevron, closed:** `::before` with `content: ""` and transform `matrix(.707,-.707,.707,.707)`, i.e. -45° (pointing right).
- **Chevron, open:** transform `matrix(.707,.707,-.707,.707)`, i.e. +45° (pointing down).
- **Colour:**
  - dark: muted `rgb(170,164,156)`, hover `rgb(242,239,233)`
  - light: muted `rgb(100,94,86)`, hover `rgb(33,29,25)`
- **Keyboard:** focus-visible gives a 2px solid outline. Enter and Space toggle.

**44px hit area** (elementFromPoint bisection at a 0.25px step):

| Viewport | Painted height | `::after` | Vertical hit extent | Real touch tap |
|---|---|---|---|---|
| Desktop (fine pointer) | 28px | none | 29px | n/a; there is no expander here, as the gate intends |
| 390px touch | 28px | 44px | **45px** (23 up / 22 down) on both summaries, both themes | Compute: a tap 6px **above** the painted box opened it. Usage card: a tap 6px **below** the painted box opened it, and a tap 6px above closed it. |

**Overhang neighbours (390px):**
- Compute: under the top and bottom overhangs are only `compute-field`/`compute-config` containers, not a control. The existing coarse `margin-top: var(--space-4)` is intact.
- Usage card: under the overhangs are only `usage-card__details`/`usage-card` and the grid, whether the card is open or closed. No ancestor `overflow` clips the expander, and it overlaps no neighbouring control.

**Functions list spacing** (open, all four configurations): 8px between entries and 4px within an entry.

**Breakpoints:** 1440, 1100, 768, 390 and 320 all have `scrollWidth - innerWidth = 0`. Both summaries open and stay 28px painted.

**Console:** the only error is a pre-existing `404` from `GET /api/pipelines/:id/schedule` for a pipeline with no schedule. It is unrelated to this change, and there were no page errors.

**Not verified:**
- Coarse pointer at a *desktop-width* viewport (an iPad-class `(pointer: coarse)` without `max-width: 768px`). Headless emulation only exercised the narrow-width branch of the same OR gate.
- A physical-device tap.

**Screenshots.** Durable copies are under `/home/matt/Development/helio/.concertino/runs/HEL-1502/evidence/openspec/changes/align-timestamp-shapes-cast-output/`:
- Compute: `eval-1-compute-{dark,light}-{desktop,390touch}-{closed,open}.png`
- Usage card: `eval-1-usage-{dark,light}-{desktop,390touch}-{closed,open}.png`
- Plus `eval-1-compute-summary-{closed,open}-dark-desktop.png`

The element screenshots of the compute section also capture the sticky pipeline footer over the lower part of the frame. That is a capture artifact, not a layout defect.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- **`DateBucketCharacterisationSpec.scala:35` sits in the wrong group.** The `MM/dd/yyyy` row is still in `unchanged`, whose scaladoc (lines 6-8) says those rows "held before the shared parser existed". Its output did change (null to `2026-07-01`), so the test name reads "keep MM/dd/yyyy …" for a changed value. Move it to its own `widenDelta` sequence (or into `epochDelta` with a broader name) and update the scaladoc.
- **The two minimum case counts differ.** `chartTimeAxis.test.ts:33` asserts `>= 98` while `ChartTimestampParsingParitySpec` asserts `>= 99`, and the fixture has 99 cases. Align both to 99.
- **Two spec scenarios are tested only at parser level, not through the named step.** The timestamp-value-parsing scenarios "a bracketed id never overrides the written offset" (`date_trunc("hour", …)`) and the positive epoch-bound bucketing (`253402300799999` to `9999-12-31`, `-62135596800000` to `0001-01-01`) are covered by `TimestampParsingSpec` but not in `TimestampAgreementSpec`. One line each there would pin the scenarios as written.
- **Tick task 5.5** in tasks.md, citing this report's Phase 3 evidence.
- **Follow-up** (Follow-up label, relatedTo HEL-1502), as design.md Non-Goals already commits for Delivery: the three pre-existing un-suffixed backend-only `Instant.parse`/`OffsetDateTime.parse` quirks (trailing-dot fraction, leap second, extended years) are still outside the shared fixture. Not filed by me.
