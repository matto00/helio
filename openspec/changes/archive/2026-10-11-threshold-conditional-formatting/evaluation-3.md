## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: `491397765e593b52e35a5e5e46161530a55f6983`. Diff base, resolved live with `resolve-review-base.sh`:
`5dceeae9d11ca1b0a8891ad31f0a2c4397b92521`. The cycle-3 delta is `095372b2d..491397765` and touches:
- `PatchSetApplyServiceSpec.scala` (new test);
- the `ConditionalFormatsWriteSpec.scala` test title;
- `ConditionalFormatsField.tsx`, its test, and the editor harness;
- `OutputEditorSheet.css`;
- `files-modified.md`;
- the committed `evaluation-1.md` and `evaluation-2.md`.

No production backend code changed this cycle.

Evaluator evidence for this cycle is in `/home/matt/Development/helio/.concertino/runs/HEL-1307/evidence/evaluator/c3/`.

### Phase 1: Spec Review — PASS

Cycle-2 change requests:
- **CR1 (patch-set apply rejection test): RESOLVED.** `PatchSetApplyServiceSpec.scala:1131-1159` drives
  `service.apply` with an Output-update `Edit` carrying the shared fixture's bad list. It asserts three things:
  - the reason includes `conditionalFormats[1]`;
  - the stored config is unchanged and has no `conditionalFormats` key;
  - the valid list then applies and is persisted.

  The preview test's title no longer claims to cover apply (`ConditionalFormatsWriteSpec.scala:112`).
  - **My own red run.** I applied the mutation myself in a throwaway worktree detached at the reviewed SHA:
    `PatchSetApplyForward.scala:105` now passes `OutputConfigWritePolicy.RestorePriorStored`, so the apply path
    skips validation. Result: **1 failed** ("expected a failure, got PatchSetApplyResponse(... applied ...)").
    Files: `c3/m3-apply-skip-validation.diff` and `.txt`. The throwaway worktree has been removed.
  - **Spec and task now backed.** Task 4.2 and spec `output-conditional-formatting/spec.md:37-40` (apply SHALL
    reject and persist nothing) now have a test that can go red.
- All 21 tasks are ticked; none are open.
- Owner rulings 1-6 are unchanged and still honoured.
- Constraints C1-C5 are honoured:
  - C1: the new guards were mutation-killed (see below).
  - C2 and C3: unchanged from cycle 2.
  - C4: re-verified on the running app in light and dark, at 1440 and 375px.
  - C5: no new CSS colour claim this cycle. The 44px claim rests on measured `getBoundingClientRect` heights,
    not on Jest.
- **Committed `evaluation-1.md` / `evaluation-2.md`: fine.** They are review artifacts of this change and are
  archived with it. That is the established repo practice: 1034 `evaluation-*.md` files already sit under
  `openspec/changes/archive/*/`. They are not product code and contain no secrets. `evaluation-3.md` (this file)
  is not committed yet; whoever commits next should include it so the archive is complete.

Issues: none.

### Phase 2: Code Review — PASS

Gates I ran fresh on `491397765` in `WORKTREE_PATH`:

| Gate | Result |
|---|---|
| `npm run lint` | EXIT 0 |
| `npm run format:check` | EXIT 0 |
| `npm run typecheck` | EXIT 0 |
| `npm run check:tokens` | EXIT 0 |
| `npm run check:schemas` | EXIT 0 |
| `npm test` (root: 44 suites / 435 tests; frontend: 513 suites / 5573 tests) | EXIT 0 |
| `npm --prefix frontend run build` | EXIT 0 |
| `cd backend && nice -n 19 sbt testFull` | 6691 succeeded, 0 failed, 4 canceled, EXIT 0 |

On the backend run: the new HEL-1307 apply test appears in that run's output, so it actually executed. Gate logs are
`c3/gate-*.txt`.

Cycle-2 change requests:
- **CR2 (duplicate `interface RuleRowProps`): RESOLVED.** Only one declaration remains
  (`ConditionalFormatsField.tsx:151`).
- **CR3 (WCAG 2.5.3 Label in Name): RESOLVED in code.**
  - Tone is now `Rule ${n} colour`.
  - For `between`, the value control is `Rule ${n} from` and the upper-value control is `Rule ${n} to`.
  - Other ops keep `Rule ${n} value`.
  - **Drift guard.** A new iterating test (`ConditionalFormatsField.test.tsx:51-77`) runs metric/table ×
    gt/between. For every `label[for]` in the rule group, it checks that the label text (minus "(optional)") is
    contained in the control's `aria-label`.
  - **Mutation results.** I ran both in the throwaway worktree:
    - m1: colour → `tone` makes **4 of the 4** cases fail (`c3/m1-colour-to-tone.*`).
    - m2: `to` → `upper` makes **2 failures**, exactly the two between cases (`c3/m2-to-to-upper.*`).

    So the guard is failable and not vacuous. It also asserts `labels.length` ≥ 4/6, so an empty group cannot
    pass.
  - The harness (`conditionalFormatsEditorHarness.tsx:115-117`) and the existing between-validation test were
    updated to the new names.
- **Mobile 44px rule (`OutputEditorSheet.css:179-185`).** It uses the same `(max-width: 768px), (pointer: coarse)`
  gate as `shared/ui/inputs.css`'s Select-trigger floor. It applies `min-height: 44px` to text inputs only.
  DESIGN.md "The 44px touch floor" explicitly names "grow the box (`min-height: 44px`) … text inputs and select
  triggers" as the correct mechanism. No button is inflated. The literal `44px` follows the documented
  convention: there is no touch-floor token, and 164 existing `44px` uses exist.

Checklist:
- **Canonical code quality:** no inline FQNs (the test uses imported names); imports are clean; files are within
  budget.
- **DESIGN [mechanical]:** passes. There are no new raw colours or off-scale spacing.
- **DRY / modular / readable:** acceptable.
- **Dead code:** none. The duplicate declaration is gone.
- **Tests:** meaningful and mutation-proven (m1, m2, m3).

Issues: none.

### Phase 3: UI Review — PASS

**Servers.** I started them via `start-servers.sh` on 6739/9646; `assert-phase servers` returned PASS. I stopped
them afterwards by exact PID: vite 3257407, npm 3257392, JVM 3256800, launcher 3256362 and sbt wrapper 3256318.
Ports 6739/9646 were confirmed free afterwards.

**Browser isolation.** The shared Playwright MCP browser's `localhost` cookie belonged to another lane's user
(`eval-hel1306-…`), and cookies are not port-scoped. To avoid clobbering that session, every check ran in a
fresh, isolated headless Chromium context. I drove it with a Node script that loads the repo's own Playwright
library (`c3/ui-check.cjs`; this is not the test runner) against the pinned port 6739. I logged in once over the API
and reused that storage state.

**Rate limiter.** The first attempts hit intermittent redirects to `/login`. This was consistent with the per-user
`/api` rate limiter (120/min) and the many requests each pipeline page makes. Each theme/width combination was
therefore run in its own invocation, 65s apart, and all four passed.

**Test data.** I created it through the API under user `43806787-dde5-4194-bc12-8657f67a1ee6`
(`hel1307-eval3-1791710806265@example.test`):
- two static sources;
- two pipelines;
- a metric Output with a stored `between` rule;
- a table Output with a row rule.

Ids are in `c3/created-ids.json`. Every row was deleted by exact id:
- outputs `225e66da…` and `ba8d9233…` (200);
- pipelines `b73844c3…` and `e6c18dab…` (204);
- sources `38baa37e…` and `0f89ca2c…` (204);
- then the user row, after its one `pipeline_run_rate_window` row, by exact id in one transaction.

**Verified on the running app** (`c3/ui-{light,dark}-{1440,375}.json`):

- **Label in Name, all 4 combinations.** For every rule-row control, the visible label is contained in the
  accessible name. A role-based lookup by the visible text alone (e.g. `getByRole('combobox', {name:'Colour'})`)
  resolves exactly one control.

  Metric (between):

  | Visible label | Accessible name |
  |---|---|
  | Condition | Rule 1 condition |
  | From | Rule 1 from |
  | To | Rule 1 to |
  | Colour | Rule 1 colour |
  | Label (optional) | Rule 1 label |

  Table (eq):

  | Visible label | Accessible name |
  |---|---|
  | Column | Rule 1 column |
  | Condition | Rule 1 condition |
  | Value | Rule 1 value |
  | Colour | Rule 1 colour |
  | Applies to | Rule 1 applies to |
  | Label (optional) | Rule 1 label |

- **Control heights:**
  - At 1440, every rule-row control (Selects and TextFields) is 32px, in both themes.
  - At 375, every rule-row control is **44px**, in both themes: Column, Condition, From/Value, To, Colour, Applies
    to and Label. The cycle-2 mismatch, where Selects were 44px but inputs 32px, is gone.
- **Overflow:** `scrollWidth == innerWidth` at both 1440 and 375, in both themes.
- **Theme:** `html[data-theme]` matched the requested theme on every run.
- **Console:** the only errors are the known unrelated `GET /api/pipelines/:id/schedule` 404s, for pipelines
  without a schedule. Those are pre-existing and also recorded in cycle 2. There were no page errors.
- **Screenshots** (illustration only; the load-bearing claims above rest on measured values):
  - `c3/eval3-light-1440-CF-metric.png`, `c3/eval3-light-1440-CF-table.png`
  - `c3/eval3-light-375-CF-metric.png`, `c3/eval3-light-375-CF-table.png`
  - `c3/eval3-dark-1440-CF-metric.png`, `c3/eval3-dark-1440-CF-table.png`
  - `c3/eval3-dark-375-CF-metric.png`, `c3/eval3-dark-375-CF-table.png`
  - `c3/fail-light1440.png` is a screenshot from a rate-limited attempt (a login redirect), not a product defect.
  - The Playwright MCP files from the brief shared-browser probe are in `c3/playwright-mcp/`.

Behaviour verified in cycle 2 was not re-driven this cycle, because the rendering and validation code paths did not
change in this delta:
- touched-only errors;
- the `InlineError` colour equal to the `--app-error` token;
- `aria-describedby` pointing at the error.

Issues: none.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **Uncommitted report.** `evaluation-3.md` is uncommitted in the worktree. Commit it with the next change so the
  archived change carries all three reports.
- **Select invalid state (carried from cycle 2).** An `aria-invalid` Select trigger still shows no visual invalid
  state. This is pre-existing shared `Select` behaviour, and a follow-up candidate rather than this ticket.
- **PR description (carried).** Propose the `TableRenderer.tsx` / `DataGrid.tsx` split (CONTRIBUTING, >400 lines).
- **Dev-DB residue, for deletion by exact id with the owner's or driver's go-ahead.** Nine `hel1307%` throwaway users
  remain, all from the executor's e2e and cycle-2 runs. Each owns 0 dashboards, 0 pipelines and 0 data sources
  (queried 2026-10-11). Note they may still have `pipeline_run_rate_window` rows, which block a plain
  `DELETE FROM users`; delete those first by `user_id`.
  - `2b9e3bdc-f6c1-4500-9c86-8db0df7cbcf4` (hel1307-1791704444162-2640)
  - `c1d60860-3250-4375-911a-892a3262b234` (hel1307-1791704500022-89186)
  - `b5f80e91-141d-41ff-9a4a-d3bf9cf3fbf4` (hel1307-1791704506214-94186)
  - `46280cc8-2a30-440b-bdeb-da0a786e9136` (hel1307-1791704524052-64189)
  - `9db653d4-9dc4-4b48-879c-0f6515571fe5` (hel1307-1791704528916-93545)
  - `4ac4dea0-b7f1-4244-bbd8-a54cc76cc19c` (hel1307-1791706729882-13445)
  - `138a90ac-61c3-43cf-bc9e-be5b412e156e` (hel1307-1791706738672-39815)
  - `5c1d0607-8b5a-49ff-a7e9-66b7c2cd03f3` (hel1307-c2-light-1791707254458-99542)
  - `06af6d7d-87b6-4829-b0b0-1d261df1ffe1` (hel1307-c2-dark-1791707266478-54199)

  The user ids recorded in evaluation-2 (`3ad1f734…`, `80db7c71…`, `2fc61204…`, `f99d918b…`, `26fc77ab…`, and the
  cycle-1 eval user) no longer exist in the dev DB. My cycle-3 user was deleted (see Phase 3).
