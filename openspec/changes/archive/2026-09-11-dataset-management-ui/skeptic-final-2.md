## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed commit: `c1c689cbfea29ec7dbade26605be1dea05d69778`. Review base resolved LIVE via
`resolve-review-base.sh` (exit status checked) → `d3c8e4ae2c021b3a7b97853c4f95d51d76bbf193`.
Worktree clean (`git status --porcelain` empty). Cold spawn: every conclusion below is derived
from ground truth I produced myself; the executor's report, evaluation-1/2.md, and
skeptic-final-1.md were read as *claims*, and each load-bearing one was independently re-tested.

**Spawn guard.** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio
branch=feature/dataset-management-ui-schema/HEL-1079`.

### What I verified (with evidence)

**Gates — all re-run fresh by me, exit codes read, not taken from any report.**
- `npm run lint` → `LINT_EXIT=0` (eslint `--max-warnings=0`, clean).
- `npm run typecheck` → `TSC_EXIT=0` (`tsc --noEmit`, clean).
- `npm test` (FULL) → `JEST_EXIT=0`; frontend **315 suites / 3332 tests** passed (+1 vs round 1's
  3331 — the new rejected-confirmed-drop regression test), helio-mcp **25 suites / 248 tests**.
- `start-servers.sh` + `assert-phase.sh servers` → `PASS servers` (6511 / 9418).
- `npx playwright test e2e/hel1079-dataset-management-ui-live.spec.ts e2e/focus-presence-guard.spec.ts`
  → **6 passed (2.2m)**, including the new combined retype+drop rejection test. Focus guard: 246
  focusable elements across 10 views (both themes), **0 findings**. No flake observed (HEL-1119's
  known duplicate-dashboard flake did not appear).

**CR1 (round 1) — rejected confirmed-drop dead end: GENUINELY FIXED. Reproduced round-1's exact
scenario live, myself, against the real backend.** Fixture created via same-origin API:
`label`/`drop_me` (both `string`), one row `["not-a-number","doomed"]`
(source `c9f4e1ec-06dd-426d-9de9-6b192b2cab59`). Pre-edit server truth, queried by me:
`{"fields":[{"name":"label",...,"type":"string"},{"name":"drop_me",...,"type":"string"}]}`.
Drove the UI: retyped Field 1 → `integer` (verified applied in the DOM: `Field 1 type = "integer"`,
both fields present), then Remove field 2 → confirm dialog → "Delete field data".

Observed after the server's `409`:
- `Field 1 name=label`, `Field 2 name=drop_me` — **both fields still rendered**.
- Both Remove buttons still present: `Remove field 1/existing-label`,
  `Remove field 2/existing-drop_me`.
- Rejection reason rendered inline: `inline-error inline-error--banner :: label: 1 existing
  row(s) do not satisfy the new type`.
- `document.activeElement` = `BUTTON/Remove field 2` — focus returned to the field's own Remove
  button, never `<body>`, never a dead node.
- **Nothing shown as applied.** Server re-queried by me at that same moment:
  `{"fields":[{"name":"label",...,"type":"string"},{"name":"drop_me",...,"type":"string"}]}` and
  `rows: [{"data":["not-a-number","doomed"]}], total 1` — screen and server agree exactly.
- **Recoverable without a reload:** re-clicked "Remove field 2" → confirm dialog reappeared
  (`This will permanently delete "drop_me"'s data from 1 row.`, correct singular), focus on
  Cancel. The round-1 dead end is gone.
- Console: exactly **1** error for the whole session, and it is the expected
  `409 (Conflict)` resource log for the PATCH itself — no app-level error.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1079/evidence/.skeptic-evidence/skeptic-r2-dark-rejected.png`,
  `.../skeptic-r2-light-rejected.png`, `.../skeptic-r2-dark-confirm-dialog.png`.

Code-level, the invariant now actually holds as claimed: `submitSchema` is the sole writer that
advances `rows`, and it does so only after the `await` returns `200`; `handleConfirmDrop` never
touches `rows` (it only computes `nextRows` and a focus target). I read the whole file rather than
trusting the comment — and the previously-false comment at the old lines 193-195 is now corrected
to state the invariant that is genuinely true for every path.

**CR2 (round 1) — missing CSS: GENUINELY FIXED, and the files are real and live, not dead.**
- `FieldDeclarationTable.css` and `DatasetSchemaEditor.css` exist, are `import`ed by their
  components (`FieldDeclarationTable.tsx:4`, `DatasetSchemaEditor.tsx:3`), and use only
  `--space-*` tokens.
- **Not dead classes:** cross-checked every class the three TSX files emit against every selector
  defined across all `frontend/src/**/*.css`. Every emitted class resolves, with exactly one
  exception (`dataset-schema-editor__loading` — a bare transient "Loading schema…" `<p>`; noted
  below, harmless).
- The two error/blocked messages now route through the shared `InlineError` primitive. Verified by
  **computed style on the live rendered element**, not by reading CSS:
  - dark: `color: rgb(241,123,103)` == `--app-error` (`#f17b67`) exactly; background ==
    `--app-danger-surface` (14% wash); `role="alert"`; TriangleAlert icon present;
    padding/gap `8px` (`--space-2`); radius `6px`.
  - light: `color: rgb(175,51,37)` == `--app-error` (`#af3325`) exactly; background == its 10%
    wash. **Light/dark intent parity holds.**
  Round 1's "an error message that does not read as an error" is resolved in both themes.
- `SourceDetailPanel.css`: the new `.source-detail-panel__schema-edit` is genuinely added to both
  existing selector groups, so the Schema section inherits the same `margin-top: var(--space-3)`
  and `padding-top/border-top` rhythm as its `__preview`/`__rows` siblings. Confirmed visually in
  both themes — the Schema section is separated from Rows by the same hairline as every sibling.
- CSS-count guard bump 111→113 is **honest**: `find frontend/src -name '*.css' | wc -l` → **113**.

**Visual cohesion (my own screenshots, both themes, looked at — not inferred from the a11y tree).**
The Schema section reads as a native sibling of the existing Sources surfaces: mono uppercase
"SCHEMA" eyebrow matching "ROWS", neutral hairline borders, accent used only on the single
primary "Save schema" button (right-aligned), inputs on the token scale, error banner as a
restrained tinted wash rather than a shouting block. Accent discipline is intact in both themes
(no tinting). Cohesive with the inferred-schema table above it and the row grid below it.

**Acceptance criteria — traced to evidence.**
- Keyboard-only flow / computed accessibility names: focus-presence guard passes on
  `/sources/:id` carrying these controls (246 elements, 0 findings); every new control has an
  explicit `aria-label` (`Field N name/type/required/default value`, `Move field N up/down`,
  `Remove field N`); reorder is up/down **buttons** (keyboard-operable by construction, Decision 2).
- Create with name/type/required/default, reorder, remove: `FieldDeclarationTable` + e2e
  create-with-3-fields (keyboard-driven, incl. `timestamp` and a required+default field).
- Canonical types only, no `"double"`: `CANONICAL_FIELD_TYPES` feeds the only type `Select`
  (`TYPE_OPTIONS`), and the drift guard parses the backend Scala source directly.
- Each PATCH policy case surfaced honestly: add-required-no-default → predicted/blocked with
  inline reason + disabled Save, **no request sent** (e2e asserts zero PATCHes); drop-with-data →
  explicit `ConfirmInline` then `confirmDrop: true` (asserted on the wire); retype /
  tighten-to-required → attempt-then-surface inline 409 (verified live by me); structural 400 →
  single banner; rename/reorder submit directly.
- "A rejected multi-field edit applies nothing" / never presented as applied: **this is exactly
  what I reproduced above** — the previously-violated criterion now holds against server truth.
- Never reach a state where rows would fail `DatasetRowValidator`: every edit goes through the
  PATCH API; no client-side application of an unconfirmed edit remains.

**Scope / drift.** `git diff --stat <base>...HEAD` = 31 files. **Zero** under `backend/`,
`schemas/`, `infra/`, or any migration path — the no-backend-change scope note is true.
`files-modified.md` matches the actual diff, including the three CSS files and the guard bump.
No unrelated refactors.

**New-regression hunt (the refactor could have broken the success path).** Re-checked the
success path specifically, since round 1 confirmed it worked *before* this refactor:
`onSuccessFocus` is assigned to `pendingConfirmFocusRef` in the same synchronous turn as
`setRows(schemaFieldsToRows(response.fields))`, so the `[rows]`-keyed focus effect cannot race it;
`rows` is still rebuilt from the PATCH response's own authoritative `fields` (evaluation-1 CR1's
fix is untouched); the Redux resync dispatches still fire. Empirically confirmed by the e2e
drop-with-confirm test, which asserts post-`200` that the table shows only `keep`, `Remove field 2`
is gone, `Field 1 name` **is focused**, and the server agrees — all still passing. Decision 6's
focus contract holds on success, on failure, and on cancel. No regression found.

### Verdict: CONFIRM

Both round-1 change requests are fixed in substance, not just in narrative, and I confirmed each
against ground truth rather than against the executor's account. No blocking defect found.

### Non-blocking notes

1. **(Strongest note — worth a follow-up ticket.)** The new `Required` checkbox in
   `FieldDeclarationTable.tsx` is a bare native `<input type="checkbox">` with no styling:
   measured live at **13×13px with `accent-color: auto`**, sitting in the same row as inputs
   measured at **32px** tall (`Field 1 name` 304×32, `Field 1 default value` 304×32,
   `Field 1 type` 126×32). This is the *exact* divergence the sibling component in this very view
   already fixed — `DatasetRowGrid.css:139-150` sets `width/height: 18px; accent-color:
   var(--app-accent)` with a comment naming the hazard ("the browser's unstyled 13px default next
   to token-sized inputs"), and 9+ other sites in the repo set `accent-color: var(--app-accent)`.
   It affects both surfaces this ticket ships (create modal and schema editor). Not blocking: it
   is pure visual polish, no functional/AC/a11y impact (the control has an accessible name and
   passes the focus guard), and its own precedent was itself first raised as a non-blocking note
   in HEL-1080. The fix is ~4 lines in the now-existing `FieldDeclarationTable.css`.
2. `dataset-schema-editor__loading` is the one emitted class with no CSS rule (a transient
   "Loading schema…" paragraph). Harmless, but either style it or drop the class.
3. Carried over from round 1 and still true: the read-only "Field / Type / Nullable" inferred-schema
   summary sits directly above the editable Schema panel and refreshes on a different cadence, so
   the two can visibly disagree after an edit. Pre-existing (`SchemaFieldViewer` /
   `source.inferredSchema`), not introduced here, but more visible now. Worth a follow-up.
4. `parseDefault` is still near-duplicated between `DatasetSchemaEditor.tsx` and
   `StaticSourceForm.tsx`. Minor DRY nit.
5. Round 1's note that the create flow no longer prevents removing the **last** field still
   applies (recoverable; "All fields must have a name" blocks submit).
6. **Housekeeping hazard (not this change's fault):** Playwright MCP screenshots default to the
   **main checkout root** (`/home/matt/Development/helio/*.png`), not the worktree — the known
   stray-screenshot trap. I removed the four I created; worth keeping an eye on.

### Gate-defect check

No report in this run rests on mtime-ordering or positional evidence, and none disclosed an
unsound evidence directory, so the mtime-acceptance gate defect does not apply. All of my own
load-bearing evidence is self-authenticating: command output with exit codes, verbatim API
request/response bodies, computed styles compared numerically against the token values they must
equal, measured element geometry, and persisted screenshots I opened and looked at.
