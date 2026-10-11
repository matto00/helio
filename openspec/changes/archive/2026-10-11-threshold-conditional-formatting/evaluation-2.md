## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `095372b2d42ec8ad7ca624dd47c0a28175e801c9`. Diff base, resolved live: `5dceeae9d11ca1b0a8891ad31f0a2c4397b92521`.
The cycle-2 delta is `4d11b0ac6..095372b2d`. It changes five files, all in the frontend editor plus design.md; no
backend files changed.
Evaluator evidence for this cycle: `/home/matt/Development/helio/.concertino/runs/HEL-1307/evidence/evaluator/c2/`.

### Phase 1: Spec Review — FAIL

Cycle-1 items:
- **CR1 (aggregate-tail emission): RESOLVED.** `buildOutputConfig.test.ts` adds three cases:
  - rules are emitted;
  - no key when there are no rules and none were stored;
  - `[]` when stored rules were all removed.

  I re-applied mutation e7 (drop `...conditionalFormatsEntry(params)` from `buildAggregateTailConfigs`) myself in a
  throwaway detached worktree at the reviewed SHA. Result: **2 failed, 16 passed** (`c2/e7-rerun.txt`). The
  no-key case passes under e7 as expected; it guards against the opposite mutation, "always emit". The worktree
  has been removed.
- **CR2 (shared error primitive) and design.md D7: RESOLVED.** The rule error renders through `InlineError`
  (`<p class="inline-error" id=…>`). `aria-describedby` points at that id from only the control(s) the error
  concerns. design.md D7 now names `FormField`, `Select`, `TextField`, `IconButton` and `InlineError`.

Issues:
1. **Task 4.2 and the spec claim that patch-set *apply* rejects an invalid list. No test exercises it.**
   - `tasks.md:50` is ticked: "patch-set preview and apply reject an invalid list".
   - `specs/output-conditional-formatting/spec.md:37-40` says apply SHALL reject with 400 and persist nothing.
   - `ConditionalFormatsWriteSpec.scala` tests create, PATCH, preview (`:111-125`), single-call, grounding and the
     rollback exemption. Nothing drives `PatchSetApplyService.apply`. The preview test is titled "reject an
     invalid list exactly like apply would", but it only calls `preview.preview`.
   - Apply is currently covered by reasoning alone (it shares `validateConfig(ValidateWrite)`). A ticked task and
     a SHALL need a test. See CR1.

Other checks:
- Owner rulings 1-6 are unchanged and still honoured.
- Constraints C1-C5:
  - C1: the new code paths are mutation-killed (see Phase 2).
  - C2 and C3: unchanged from cycle 1.
  - C4: I re-checked on the running app in light and dark, at 1440 and 375px.
  - C5: the editor error colour is proven by computed style (see Phase 3).

### Phase 2: Code Review — FAIL

Gates I ran fresh on `095372b2d` in `WORKTREE_PATH`:

| Gate | Result |
|---|---|
| `npm run lint` | EXIT 0 |
| `npm run format:check` | EXIT 0 |
| `npm run typecheck` | EXIT 0 |
| `npm run check:tokens`, `check:schemas` | EXIT 0 |
| `npm test` (root: 44 suites / 435 tests; frontend: 513 suites / 5569 tests) | EXIT 0 |
| `npm --prefix frontend run build` | EXIT 0 |
| `cd backend && sbt testFull` (nice 19) | 6690 succeeded, 0 failed, EXIT 0 |

Mutations against the cycle-2 editor logic. I ran them in the throwaway worktree, which has since been removed;
the diffs and outputs are in `c2/`.

| Mutation | Result |
|---|---|
| c2m1: errors shown without touch-gating (`showError={true}`) | killed (1 failed) |
| c2m2: `aria-describedby` never set | killed |
| c2m3: `aria-invalid` on every control instead of only the concerned ones | killed |
| c2m4: raw server copy instead of the editor-facing "Enter a number…" | killed |

Issues:
1. **Dead duplicate declaration.** `frontend/src/features/pipelines/ui/outputEditor/ConditionalFormatsField.tsx:151-160`
   still holds the old `interface RuleRowProps` (without `showError`/`onTouch`). The new one is directly below at
   `:162-173`.
   - TypeScript declaration merging hides this, so lint and typecheck pass.
   - It is a stale, duplicated declaration that a reader has to reconcile. See CR2.

Checklist:
- **Canonical code quality:** no inline FQNs and imports are clean. The file is 313 lines, under budget.
- **DESIGN [mechanical]:** passes.
  - Tokens only.
  - `InlineError` and `FormField` are used, not hand-rolled.
  - The new CSS uses `var(--control-md)`.
- **DRY / modular:** acceptable. `describeProblem` restates the validator's conditions in editor wording, and the
  raw message is the fallback.
- **Tests:** meaningful (see the mutations above).
- **Dead code:** see issue 1.

### Phase 3: UI Review — FAIL

Servers ran via `start-servers.sh` on 6739/9646 (`assert-phase servers` PASS). I stopped them afterwards by exact
PID (sbt wrapper, launcher, JVM, npm and vite). The sbt `--client` server I started for `testFull` was shut down
with `sbt --client shutdown`.

Test data was created through the API under user `26fc77ab-9485-4637-b810-6a038a349f52`
(`hel1307-eval2-1791708456820@example.test`). Every row was deleted by exact id:
- outputs `3d2f12ab…`, `84f6ac1e…` (200)
- pipeline `0ce6bbd7…` (204)
- source `44c8f9a4…` (204)

The user row remains, with no data under it; see `c2/created-ids.json`.

Verified on the running app:
- **Touched-only errors.** After "Add rule", nothing has `role="alert"` and no control is `aria-invalid`. A muted
  hint reads "Finish or remove rule 2 to save." and Save is `disabled`. After touching:
  - The table rule shows "Rule 2: Choose the column this rule tests." Only `Rule 2 column` is `aria-invalid="true"`,
    with `aria-describedby` set to the `InlineError` `<p>` id.
  - The metric rule (typed, then cleared) shows "Rule 1: Enter a number to compare with." on `Rule 1 value` only;
    `Rule 1 label` is not invalid.
- **Error colour (C5):** computed `color` of the `.inline-error` equals the `--app-error` probe. Light is
  rgb(175,51,37) and dark is rgb(241,123,103).
- **Equal control heights:** all rule-row controls are 32px at 1440.
- **375px:** no element overflows the viewport. Selects are 44px there and inputs 32px, because of the existing
  `inputs.css:191` mobile touch floor. See the suggestions.
- **Visible labels:** present on every control (Column, Condition, Value/From/To, Colour, Applies to,
  Label (optional)).
- **Console:** no errors from this flow. The only entries were the pre-login `/api/auth/me` 401s and the known
  unrelated `/schedule` 404. Entries for port 6748 belong to another lane's session in the shared browser.
- **Screenshots** (illustration only; the load-bearing claims above rest on computed values):
  - `c2/eval2-light-1440-editor-untouched.png`
  - `c2/eval2-light-1440-editor-error.png`
  - `c2/eval2-dark-1440-editor-error.png`
  - `c2/eval2-dark-375-editor-error.png`
  - `c2/eval2-light-375-editor-metric-error.png`
  - Playwright MCP snapshots and the console log are in `c2/playwright-mcp/`.

Issues:
1. **The new visible labels do not match the accessible names (WCAG 2.5.3 Label in Name, Level A).** This was
   introduced in this cycle. Each control's `aria-label` overrides its `<label for>`, and for three controls the
   visible text is not contained in the accessible name:

   | Visible label | Accessible name |
   |---|---|
   | "Colour" | "Rule 2 tone" |
   | "From" | "Rule 2 value" |
   | "To" | "Rule 2 upper value" |

   Measured on the running app via `label[for=id]` against `aria-label`. A speech-input user saying "click Colour"
   or "click To" gets no match. Column, Condition, Value, Applies to and Label already match. See CR3.

### Overall: FAIL

### Change Requests
1. **CR1: test patch-set apply rejection** (task 4.2; spec `output-conditional-formatting/spec.md:37-40`).
   - **Test to add.** Put it in `ConditionalFormatsWriteSpec.scala`, or in `PatchSetApplyServiceSpec.scala` using
     its existing harness (`"PatchSetApplyService.apply" should`, `:217`).
   - **Edit to apply.** Build an Output-update `Edit` like the preview test at `ConditionalFormatsWriteSpec.scala:115`,
     carrying the shared fixture's `badRules`.
   - **Assertions:**
     - it is rejected with a `BadRequest` naming `conditionalFormats[1]`;
     - `storedConfig(oid)` is unchanged afterwards;
     - the same apply with `goodRules` succeeds and persists them.
   - **Red first.** Run the test red against a mutation that skips the check on the apply path, e.g. pass
     `RestorePriorStored` where apply calls the Output update. Keep that output in the run evidence dir.
   - **Planning artifacts.** If apply cannot be reached this way, correct the preview test's title
     ("exactly like apply would") and task 4.2 instead of leaving the claim unbacked.
2. **CR2: delete the stale duplicate `interface RuleRowProps`** at
   `frontend/src/features/pipelines/ui/outputEditor/ConditionalFormatsField.tsx:151-160`. Keep only the one at
   `:162-173`.
3. **CR3: make each accessible name contain its visible label** in `ConditionalFormatsField.tsx`.
   - `Rule ${n} tone` → `Rule ${n} colour`.
   - For `between`, make the value and upper-value names contain "From" and "To", e.g. `Rule ${n} from` /
     `Rule ${n} to`. Any form containing those words works; `Rule ${n} value` can stay for non-between ops.
   - Alternatively, change the visible labels to match the names (e.g. visible "Tone", "Value" / "Upper value").
   - Update the tests that query the old names.
   - Add an assertion that would fail if the two drift again. For example: for each control, its
     `label[for]` text is contained, case-insensitively, in its `aria-label`.

### Non-blocking Suggestions
- **375px heights.** At 375px the rule-row Selects are 44px (the global mobile touch floor) and the TextFields
  32px, so the "equal heights" fix holds only on desktop. Lifting `.conditional-formats__controls .ui-input` to the
  same 44px floor at the mobile breakpoint would match them and give the inputs a proper touch target. This is the
  skeptic's call.
- **No invalid styling on Select.** An `aria-invalid` Select trigger shows no visual invalid state; the border is
  unchanged (`Rule 2 column`, dark). That is pre-existing `Select` behaviour, but the error text is the only visual
  cue for which control is wrong.
- **PR description.** Still propose the `TableRenderer.tsx` / `DataGrid.tsx` split (CONTRIBUTING, >400 lines),
  carried over from cycle 1.
- **Dev-DB residue (do not delete without the owner's say).** These throwaway users remain:
  - The executor's e2e users: `3ad1f734-408d-4ba8-84da-43f488937322`, `80db7c71-b78f-4c43-b469-6351110f8818`,
    `2fc61204-8a3f-44f1-b667-91dabd4e4f17`, `f99d918b-7f3c-436c-84da-afd206cd50d8`.
  - Mine: this cycle's `26fc77ab-9485-4637-b810-6a038a349f52` and cycle 1's
    `hel1307-eval-1791706767718@example.test`. All their data rows were deleted by exact id.
