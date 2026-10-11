## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `b8ea3ad373cac857b64a7afa85fb4267512743be` (b5e620eab + the merge of origin/main that brought in HEL-1316).
Diff base: resolved live with `resolve-review-base.sh`, giving `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39`.
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/eval1-*`.

### Phase 1: Spec Review — PASS

- **AC1:** `seconds_between(end, start)` returns the correct number for ISO timestamps, and null or unparseable input gives null. Covered by `ExpressionDateTimeFunctionsSpec` and end to end by `ComputeDateTimeRunSpec`: a real run persists `queue_s` = 90 / 0 / null.
- **AC2:** inferred types match applied types. `ExpressionDateTimeInferenceSpec` has a parity case per `DateTimeFunctions` entry. `ComputeDateTimeRunSpec` checks analyze `float`/`timestamp` against the persisted JSON kinds.
- **AC3:** documented in the editor (the "Functions" disclosure), in `docs/compute-expression-grammar.md`, and in the helio-mcp `add_pipeline_step`, `propose_pipeline` and `analyze_pipeline_proposal` descriptions.
- **Owner rulings Q1-Q6 (C1) are honoured:**
  - exactly three functions;
  - `-` stays numeric-only on timestamps;
  - the units list matches;
  - `add_days` uses exact 86400 s days;
  - float results are unrounded;
  - UTC throughout;
  - unparseable values give a per-row null;
  - an unknown or non-literal unit is a parse error;
  - no `now()`.
- **Ruling A-ship-document-spinoffs is honoured:** the `+` change shipped, and the gap is documented in `timestamp-paths-evidence.md` and in the grammar doc. See CR4 on how the doc words it.
- **Tasks:** all ticked, and they match the diff.
- **API:** no API or schema shape change, which is correct.
- **WindowRolling claim: verified.** `WindowRolling.scala:25` calls `DateBucketStep.parseToUtcDate`, which is now `TimestampParsing.parseInstant(value).map(...)` (`DateBucketStep.scala` diff). The row added to `TimestampAgreementSpec` pins it.
- **CONSTRAINTS C1-C5:** C3 is honoured except for the inline FQNs (CR1).

### Phase 2: Code Review — FAIL

**Gates, rerun fresh in WORKTREE_PATH. All green.**

| Gate | Result | Transcript |
| --- | --- | --- |
| `npm run lint` | exit 0 | `eval1-static.txt` |
| `npm run format:check` | exit 0 | `eval1-static.txt` |
| `npm run typecheck` | exit 0 | `eval1-static.txt` |
| `npm test` (root/helio-mcp) | 46 suites, 444 passed | `eval1-jest-full.txt` |
| `npm test` (frontend) | 518 suites, 5551 passed | `eval1-jest-full.txt` |
| `npm --prefix frontend run build` | exit 0 | `eval1-frontend-build.txt` |
| `cd backend && sbt testFull` | 6920 passed, 0 failed, 4 canceled, exit 0 | `eval1-backend-testFull.txt` |
| `npm run check:scala-quality` | clean | |

The testFull transcript shows `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.

**Executor claims verified independently:**

- **Red-first evidence (C2).** The transcripts exist and show real reds:
  - `red-group2.txt`: 26 of 29 FAILED;
  - `red-group3.txt`: guard failed=7;
  - `mutation-group4.txt`: `ComputeDateTimeRunSpec` red under a flipped `Duration.between`;
  - `green-group1.txt`: the Double-epoch cast row red.

  Group 1's red is a compile failure: `parseInstant` did not exist. The characterisation spec was 30/30 green by design, as a pin.
- **Datebucket characterisation: verified independently.**
  - I made a scratch worktree at HEAD and reverted `backend/src` to the base.
  - I then ran HEAD's `DateBucketCharacterisationSpec` against the base production code (`eval1-characterisation-vs-base.txt`).
  - Result: exactly the 5 enumerated D1 delta rows fail (whole Double epoch, exponent BigDecimal, `"1771286400.0"`, `"1.7712864E9"`, `"1e3"`).
  - All 25 `keep ...` rows and both `parseNonEpochDate` rows pass. No undisclosed datebucket behaviour change among the pinned shapes.
- **`[hel1468-guard]`** is present in every sbt transcript I checked, and in my own runs.
- **Shared fixture mutation**, in the scratch worktree only (`eval1-fixture-mutation-backend.txt`, `eval1-fixture-mutation-js.txt`):

  | Mutation | Backend `ComputeExpressionFunctionsSeamSpec` | Frontend `computeFunctionReference.test.ts` | helio-mcp `computeExpressionDescription.test.ts` |
  | --- | --- | --- | --- |
  | Baseline | pass | pass | pass |
  | A: fixture gains `weekday` | FAIL | FAIL | FAIL |
  | B: fixture loses `add_days` | FAIL | FAIL | **pass** |

  All three tests can fail. The MCP check is one-directional by construction (fixture ⊆ doc). The chain still holds, because the backend pins fixture == engine in both directions. Note: adding `now` to the fixture would NOT fail the MCP test, because the doc text contains "no now()" and therefore the substring `now(`. Non-blocking.
- **`VerifiedEmbeddedPostgres.start`:** the one new DB spec uses it (`ComputeDateTimeRunSpec.scala:44`).
- **No inline FQNs: NOT honoured.** See CR1.

**Code findings:**

- **[mechanical, CONTRIBUTING "Imports & Qualifiers" / C3]** `backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:70` (`case bi: java.math.BigInteger`) and `:74` (`case bd: java.math.BigDecimal`) are inline fully-qualified names. A renaming import is how the codebase does this: `JsSemantics.scala:6` has `import java.math.{BigDecimal => JBigDecimal, BigInteger}`, and `WindowRolling.scala:5` does the same. `check:scala-quality` does not catch `java.math.*`, but the rule is "never inline a FQN when an import would do", and C3 names it explicitly.
- **Semantics are sound.**
  - `secondsBetween` handles negative durations correctly (`getSeconds` plus positive nanos) and normalises -0.0.
  - `addDays` splits whole seconds from the nano remainder, so there is no 106k-day cap, and unrepresentable results become null.
  - The `date_trunc` unit is enforced at parse time. A bare word is mapped to the units error, not the `$`-prefix one.
  - The runtime non-numeric `n` is a TypeError, which gives a per-row null through `ComputeStep`, consistent with the numeric family.
  - `epochOf` bounds the exponent scale.
  - The `Long.MinValue` overflow in the old datebucket path, an unguarded `Instant.ofEpochSecond`, is now inside a `Try`.
- **Cast now passes the raw value** (`CastStep.scala:88`), so a JSON-number whole epoch is kept as its string form. This is a disclosed D1 delta, and `CastStepSpec` is updated.
- **Tests are meaningful.** The spec scenarios map one-to-one onto test cases, and the mutation runs above confirm the seam tests can fail.

### Phase 3: UI Review — FAIL

**How I tested.**
- Servers were started by `start-servers.sh` on 6746/9653, and `assert-phase servers` PASSED. I confirmed both listeners' cwd is this worktree.
- The shared Playwright MCP browser was logged in as another lane's live skeptic user (HEL-1306, created minutes earlier). Re-authenticating it would have hijacked that lane's session, so I drove an **isolated** Chromium context (the repo's own `playwright` library) against the same pinned ports instead.
- I logged in as the dev account `matt@helio.dev` and created one throwaway pipeline through the API: an inline static source plus a compute step.
- Afterwards I deleted it by exact id: pipeline `0c115717-8be8-41d9-9c25-5f2be76ac906` (204), source `9f16eb50-1ebb-405a-aa8d-60c353262266` (204). A follow-up GET returns 404, and the source is no longer listed.
- The servers I started are stopped and the ports are free.

**What I observed** (screenshots in `evidence/eval1-ui/`; sha256 in `eval1-ui/SHA256SUMS`):

- **Happy path works.** The "Functions" disclosure renders under the Expression input. Clicking opens it and lists all 14 functions with signatures, including the three date functions. Clicking again closes it, so it is not a dead control.
- **Keyboard.** Tab from the Expression input lands on `SUMMARY "Functions"`. The focus ring is 2px solid `--app-focus-ring-color` with offset 2px. Enter opens it; Space toggles it.
- **Accessible names.** The closed state exposes `group "Functions"`. The open list is `list "Expression functions"`, with one listitem per function.
- **Tokens.**
  - Every value in the new CSS is a token: `--text-xs`, `--app-text-muted`/`--app-text`, `--control-sm`, `--weight-medium`, `--app-radius-sm`, `--app-focus-ring`, `--space-1`, `--font-mono`.
  - The resolved colours follow the theme. Dark: muted `#aaa49c`, text `#f2efe9`. Light: `#645e56`, `#211d19`.
  - Light/dark parity holds.
- **Breakpoints.** At 1440 / 1100 / 768 / 375 there is no horizontal overflow (`scrollWidth == clientWidth`).
- **Console.** The only error is a 404 on `GET /api/pipelines/:id/schedule` for a pipeline with no schedule. That predates this change and is unrelated.
- **Touch floor violated.** At 375px the summary's hit area is **28 x 55 px**, with no `::after` expander and `position: static`.
- **No expand/collapse indicator.** `display: inline-flex` on the `<summary>` removes the native `list-item` disclosure marker, and nothing replaces it. Closed, "Functions" renders as plain muted text, identical in shape to a static label (`dark-closed-1440.png`, `light-open-375-full.png`). There is no visible open/closed state indicator.

### Overall: FAIL

### Change Requests

1. **`backend/src/main/scala/com/helio/domain/engine/TimestampParsing.scala:70,74`: replace the inline FQNs.**
   - Add `import java.math.{BigDecimal => JBigDecimal, BigInteger => JBigInteger}` at the top of the file, following `JsSemantics.scala:6`.
   - Match `case bi: JBigInteger` and `case bd: JBigDecimal`.
   - Rule: CONTRIBUTING "Imports & Qualifiers"; constraint C3.

2. **`frontend/src/features/pipelines/ui/PipelineDetailPage.css:2067-2074`: give `.pipeline-detail-page__compute-functions-summary` the 44px touch floor.**
   - This is DESIGN.md §3 "The 44px touch floor" [mechanical]; it is a compact painted control, so it gets the expander mechanism.
   - Add `position: relative` and a sized `::after` hit expander (full-width-strip form: `left: 0; right: 0; height: 44px; top: 50%; transform: translateY(-50%)`). Gate it under `@media (max-width: 768px), (pointer: coarse)`. Or apply the `.tap-expand-44` utility.
   - Measured today: 28 x 55 px at 375px, no expander.

3. **`PipelineDetailPage.css:2067-2068`: restore a visible disclosure state indicator.**
   - `display: inline-flex` suppresses the `<summary>` marker, so the control looks like a static label. That is the "dead-looking control" this check exists to catch.
   - Either keep the native marker (drop `display: inline-flex`, or keep `display: list-item`), or add an explicit chevron that rotates on `[open]`, e.g. a `::before` with token colour.
   - Verify in both themes that the closed and open states are visually distinguishable.

4. **`docs/compute-expression-grammar.md:212-223`, "Known gap" section: two problems.**
   - It says "both are tracked as follow-up tickets", but no spinoff ticket ids exist yet: there are none in `events.jsonl`, `timestamp-paths-evidence.md` or the doc. Either file the two spinoffs (fillnull mean/median over epoch timestamps; a union numeric-field collision) and cite their ids, or reword the sentence until they exist.
   - It cites `openspec/changes/compute-datetime-functions/timestamp-paths-evidence.md`, which moves on archive. Cite the archived path, or state the finding inline.

### Non-blocking Suggestions

- `helio-mcp/src/tools/computeExpressionDescription.test.ts`: the `${fn}(` substring check passes for a fixture name like `now`, because the doc contains "no now()". Consider matching against the list segment only, or using a word-boundary regex.
- `ComputeFunctionReference.tsx`: the list's `aria-label="Expression functions"` makes a non-exact `getByLabel("Expression")` ambiguous; the existing tests use the exact name and pass. Consider `aria-labelledby` pointing at the summary instead.
- The new summary CSS duplicates `.usage-card__summary` (`UsageCard.css:46-64`) line for line, and inherits the same marker and touch-floor gaps. A shared disclosure-summary utility would fix both sites in one place. This could be a spinoff.
- `ComputeDateTimeRunSpec`'s "unparseable row null" comes from the cast step nulling `"not a date"`, not from compute's own unparseable path. The unit specs cover compute's path; the spec title could say so.
