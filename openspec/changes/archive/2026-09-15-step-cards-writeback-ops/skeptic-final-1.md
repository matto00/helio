## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Fresh cold spawn. Every conclusion below is re-derived from this worktree, the live app, or gates I ran
myself. The executor's and evaluators' reports were read as claims only.

**Cwd guard.** `pwd -P` → `/home/matt/Development/helio`;
`assert-cwd.sh /home/matt/Development/helio <WORKTREE_PATH> <BRANCH>` →
`READY ambient=/home/matt/Development/helio branch=feature/step-cards-three-new-steps/hel-1109`.

**Head reviewed:** `1ba690bf5056d822f09bcc60678c3e3fa9efe99a` — confirmed against my own `git rev-parse HEAD`,
which matches the pinned SHA exactly. Diff base resolved LIVE via `resolve-review-base.sh` (exit status
checked) → `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`. Working tree carries two uncommitted items, both
disclosed to me: `tasks.md` (modified) and `evaluation-2.md` (untracked) — so the orchestrator's 4.4
rewording is NOT in the reviewed commit.

### What I verified (with evidence)

**Gates, all re-run by me at this head, nothing trusted from paste:**
- `npm run lint` (`--max-warnings=0`) — exit 0, clean
- `npm run typecheck` — exit 0
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm run build` — exit 0 (PWA bundle emitted)
- `npm test` — **321 suites / 3442 tests passed**, exit 0

**Scope.** `git diff --name-only` outside `frontend/` + `openspec/` is empty: no backend, no migration, no
`helio-mcp` change. Confirmed live that `OpDropdown` has exactly 25 menu items (22 prior + the three new),
with zero grouping/filter controls — the HEL-1136 boundary holds.

**`convertformat` seed.** `defaultConfigFor` returns `{ field: "" }`; `from`/`to` genuinely absent, and
`stepNarrowing.test.ts` asserts key ABSENCE (`expect("from" in seed).toBe(false)`), not shape. I re-derived
why this is load-bearing from the backend: `ConvertFormatConfig.pairError` collects
`obj.fields.get("from").collect { case JsString(s) => s }`, so `""` yields `Some("")` and `("","")` is not
in `SupportedPairs` → 422; absent keys hit `case _ => None`.

**`outputSchema` ordering/cap.** Typed `OutputSchemaField[]`, emitted as an array, reorder changes emitted
order (asserted `b,a` → `a,b`); cap is 50 matching `AnalyzeWithAiConfig.scala:30`, enforced in
`handleAddField` AND via `disabled={atCap}` with a "Limit reached" hint. Live: both move arrows present per
row with position-bearing accessible names ("Move output field 1 up"), correctly disabled at each boundary.

**Registry drift guard — C2 satisfied, and I mutated the real source myself.** I re-implemented the guard's
parser in node against the actual `PipelineStep.scala`: it captures **27/27** registered kinds with no
truncation (total `.Kind->` occurrences in the file is also 27), resolving each kind string from each step
file's own `val Kind`. I then injected `FakeNewStep.Kind -> FakeNewStep` into the real parsed source and the
parser returned it — so the guard is failable in its purpose's direction against its true source of truth,
not a hardcoded twin. Exceptions are exactly `join` and pre-existing `groupby`. The stale
`UpsertSourceConfig.scala:17-19` "deliberately NOT registered" comment cannot mislead the guard (it reads the
Registry, where `upsertsource` IS registered).

**C1.** No `400` claim on a config-validation path in any new code, comment, test or spec; the surviving
`400` strings are the correct contrast statements (400 reserved for unknown type/decode) and reports
recording the correction.

**No `FormField`** anywhere in `stepConfigs/`; the unsaved-draft affordance is
`StatusChip intent="neutral" dashed` (`StepCard.tsx:234`), confirmed live with `border-style: dashed`,
transparent background, 12px.

**Cost disclosure (D5).** Live copy verbatim, both themes: "This step calls the AI model once per input row.
It never runs automatically, and each call draws on your account's shared daily AI budget. The pipeline's
current estimated row count is 1000." Row count attributed to the PIPELINE, never this step's call count; no
currency or token figure (`hasCurrencyOrToken: false`). Absent on `convertformat`, asserted in its test. I
accept D5's reading; the cost sentence is Description prose and the figure is parked under Open questions.
Also checked runtime safety independently: `costVerdict` is non-optional on the response type
(`pipelineStep.ts:623`) and the backend documents it as "always present on this response"
(`PipelineAnalyzeProtocol.scala:248`), so `analyzeResult?.costVerdict.estimatedRows` cannot throw.

**The cycle-1 chip defect does NOT reproduce.** Verified live on the same fixture that produced it
(`proj-2026-flat`, 124-column source, `estimatedRows: 1000`), in BOTH themes, after first confirming the
reused servers are this worktree's: `readlink /proc/1122868/cwd` → `.../hel-1109/frontend`,
`readlink /proc/1121451/cwd` → `.../hel-1109/backend`.

| measurement | dark | light |
|---|---|---|
| `--removed` diff chips on the AI draft card | 0 | 0 |
| any `step-card-diff-chip` | 0 | 0 |
| `step-card-diff` container present | no | no |
| elements computing `line-through` | 0 | 0 |
| editor offset from card-body top | 13px | 13px |

**Deferred create verified live**, not merely unit-tested: adding the AI step produced only GETs in the
network log — no create request at any point, including after edits. Zero console errors/warnings across
both themes throughout.

**Visual judgment (my own, against the running app in both themes).** The three cards stay in the existing
step-card dialect: same uppercase `__compute-label` field labels, same inline-error treatment, muted
`__compute-fields-hint` paragraph for disclosures, and the ordered rows reuse the existing
`__aggregate-groupby-row` vocabulary (32px rows, 8px rhythm, name field + type select + two chevrons + X)
rather than inventing a row primitive. Light/dark parity holds; all sampled colors resolve to theme tokens
(hint/label/move-btn `rgb(100,94,86)`, error `rgb(175,51,37)` in light). No new visual dialect — no
escalation owed on that axis.

**The three items the evaluator consciously passed on — my own rulings:**
1. *Scenario-2 test may not discriminate.* TRUE, and the test's own comment concedes it. Not a blocker: the
   shipped code is correct by construction (`getDraftFallbackSchema` branches on `meta.parentStepId` and
   reads that exact anchor's entry), and scenario 1's test IS discriminating. Test-strength gap, noted below.
2. *Scenario 4 has no draft-fallback test.* TRUE. Not a blocker for the same reason.
3. *`handleInsertStep` hardcodes `roots[0]`.* NOT a defect. The pre-existing immediate-create path in the
   same function already passes `roots[0]?.id` with the comment "this handler only ever inserts into root 0's
   own top-level lane"; the trunk-insert affordance is root-0-only by construction, so the draft path is
   consistent with it rather than asymmetric in a reachable way.

**The AC's "identical configs" half.** `addPipelineStepConfigParity.test.tsx` is a genuine parity test: it
asserts the exact key SET per op (`Object.keys(emitted).sort()`) and `outputSchema` element order after a
reorder, and quotes `write.ts`'s documented shapes inline. I checked those shapes in
`helio-mcp/src/tools/write.ts:493-521` myself: `convertformat → {field, from, to, outputField?}`,
`analyzewithai → {inputField, instruction, outputSchema: [{name,type}]}` (ordered, 1-50, four types),
`generatetext → {inputField, instruction, outputField}` required — all three match what the cards emit. It
compares against the docs by quotation rather than programmatically, which is a reasonable limit.

**On the orchestrator's `tasks.md` 4.4 narrowing:** accurate, and I verified its premise rather than
accepting it — `@testing-library/user-event` appears in no `package.json`, has 0 occurrences in either
lockfile, and is absent from the `node_modules/@testing-library/` tree (only `dom`, `jest-dom`, `react`).
The narrowed wording matches what the test actually asserts. Not an overclaim. One residue: the
`fireEvent.keyDown`/`keyUp` bracketing around the synthetic click exercises nothing and invites misreading.

### Verdict: REFUTE

One defect, found only by the live pass and reproduced twice, in exactly the class the brief warned about: a
spec requirement this change itself adds is unimplemented, its `[x]` task claims a test that does not exist,
and the whole suite is green while it is broken.

### Change Requests

1. **An empty declared output-field name is never surfaced, producing a silent, permanent dead end.**
   `openspec/changes/step-cards-writeback-ops/specs/pipeline-analyzewithai-editor/spec.md:48-50` requires:
   "The editor SHALL surface, inline on the card, a declared name that is **empty**, duplicated, or equal to
   `inputField`". `AnalyzeWithAiConfig.tsx` renders inline errors at only four places — `:118` (instruction),
   `:176` (duplicate), `:179` (input collision), `:187` (empty schema) — and both name-level checks are
   explicitly gated on `trimmedName !== ""` (`:130-132`), so the empty case is unreachable by design. The
   name input carries no `aria-invalid` and no `aria-describedby`.

   Live consequence, measured at this head in light theme with `inputField = company` and
   `instruction = "Extract the sentiment from this text"` and two declared rows left blank:
   `allInlineErrorsOnCard: []`, no red text anywhere in the card, `aria-invalid: null` on both rows, draft
   chip still present, and **no create request in the network log**. Because
   `isCompleteAiStepConfig` returns `false` on `!name` (`stepNarrowing.ts`), the deferred-create path never
   fires, so the card looks fully configured, says nothing is wrong, and can never save — the user has no way
   to learn why. Evidence:
   `/home/matt/Development/helio/.concertino/runs/HEL-1109/evidence/.playwright-mcp/skeptic-hel1109-blank-name-silent-deadend-light.png`
   (sha256 `1c8bb5ce…`).

   Required: surface the empty declared name inline (mirroring the two existing per-row errors, so the row
   the user must fix is identifiable), and add a test for that arm.

2. **`tasks.md` 2.4 is checked `[x]` while claiming verification that does not exist.** It reads "Add inline
   validation … for empty/duplicate/`inputField`-colliding declared names and an empty declared schema;
   verify a test covers each condition." `AnalyzeWithAiConfig.test.tsx` has cases for duplicate, collision
   and empty schema; there is **no** empty-declared-name test (grep for `empty` in that file returns only
   the empty-schema and `emptyConfig` fixture hits). This is the same defect class that failed cycle 1 —
   correct it together with CR1 rather than by re-wording the task.

### Non-blocking notes

1. Test-strength gaps the evaluator already identified and I confirmed: scenario 2's lane-anchor test is
   non-discriminating by its own admission, and scenario 4 (multi-root draft fallback) has no test. The
   shipped behavior is correct; only the guards are weak. A discriminating scenario-2 case is constructible.
2. Delete the decorative `fireEvent.keyDown`/`keyUp` lines around the click in `AnalyzeWithAiConfig.test.tsx`.
3. `groupby`'s `KNOWN_UNLISTED_KINDS` exception still names no Linear ticket; it is a genuine pre-existing
   gap (no `GroupByConfig.tsx` exists) and deserves a spinoff rather than a bare in-code note.
4. `helio-mcp/src/tools/write.ts` describes these config rejections as a "named 400" where the backend
   returns 422. Outside this change's diff and outside C1's scope (not new code), but it is now the
   documented contract the parity test quotes — worth a spinoff.
5. No gate defect to report on mtime/positional evidence: every claim above rests on content (command output,
   cited line numbers, computed DOM measurements, sha256-identified screenshots), not on file ordering or
   timestamps.
