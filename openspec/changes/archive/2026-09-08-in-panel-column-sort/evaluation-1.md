# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `fe76979f` on `feature/in-panel-column-sort/HEL-448`, base `origin/main` @ `6b081b86`.
Working tree clean at review time (`git status --porcelain` empty).

## Phase 1: Spec Review — FAIL

Verified against ticket.md (incl. both owner re-baselines), design.md D1–D10/D9a, tasks.md, and both spec deltas.

PASS items:

- Every ticket AC is addressed and independently verified live (see Phase 3), not just claimed:
  two-state toggle, `aria-sort`, persistence across detail-modal open/close AND page reload,
  numeric-not-lexical sort, blanks last, no resize/density/column-order regression, Jest coverage.
- No AC silently reinterpreted. The two-state cycle, Output-scoped storage, non-owner silent
  degrade and loaded-rows-only scope are all implemented exactly as the owner rulings state, and
  the spec deltas describe them honestly (convergence "on load, not live"; nothing anywhere calls
  the sort per-panel — `grep -rni "per-panel"` over the specs and `TableRenderer.tsx` is empty).
- No scope creep: the diff is confined to the six frontend files named in `files-modified.md`
  plus the change dir. No backend change, no `SortableTh`/`useSortedRows` modification, no
  `panel.config` resurrection, HEL-451/465/469 not built.
- D9a provenance is correctly stated everywhere. The only in-code mention
  (`TableRenderer.tsx:266-270`) says "NOT part of the owner's sort-mechanism ruling … Never
  describe this as owner-approved". No artifact describes it as owner-approved.
- No existing test or fixture was altered to accommodate the change. The only edits to existing
  tests are the mechanical `panelId=` → `outputId=` prop rename required by task 3.2 — verified by
  reading the full test diff; no assertion or expected value was changed.

FAIL item (Change Request 1):

- **Task 3.6 is checked off but only half-implemented, and two shipped spec scenarios have no test
  at all.** Task 3.6 requires "persisted `columnSort` round-trips through `readTableConfig`;
  malformed and unknown-column values render source order". The only test carrying that label
  (`TableRenderer.test.tsx`, "3.1/3.6: a persisted columnSort seeds the initial sort") passes the
  `columnSort` **prop directly** and never calls `readTableConfig`. `readColumnSort`
  (`outputConfigTypes.ts:125-135`) — the new tolerant parse, the exact code the spec's tolerance
  requirement rests on — has **zero** test coverage: `grep -rn "columnSort" frontend/src --include=*.test.*`
  returns hits only in `TableRenderer.test.tsx`, and `outputEditor/` has no `outputConfigTypes` test
  file. Consequently these two ADDED spec scenarios in
  `specs/table-panel-column-sort/spec.md` ship unevidenced:
  - "A malformed stored sort is ignored"
  - "A sort naming an unknown column renders source order"

## Phase 2: Code Review — PASS

### Gates (re-run by me in `WORKTREE_PATH`, not trusted from the executor's report)

| Gate | Result | What it actually scanned |
| --- | --- | --- |
| `npm run lint` | PASS (`eslint . --max-warnings=0`) | whole repo incl. all changed `frontend/src` files; zero-warnings, so `react-hooks/rules-of-hooks` would have errored on a per-branch hook call |
| `npm run typecheck` | PASS (`tsc --noEmit`) | `frontend/tsconfig.json` project |
| `npm run format:check` | PASS (`prettier . --check`) | whole repo |
| `npm --prefix frontend test` | PASS — **272 suites / 2789 tests** | the gate that actually executes the new code |

The executor's identification of `npm --prefix frontend test` as the exercising gate is correct:
root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`, and its root jest arm
finds no tests in a worktree root, converting silence into a pass. No backend file changed, so
`sbt test` is not in scope. Note the repo's jest is new enough that `--testPathPattern` is rejected
(`--testPathPatterns` now); CLAUDE.md's single-file recipe is stale — informational only, not a
finding against this diff.

### Independent re-verification of the executor's red/mutation claims

Each claim was re-run by me by mutating the source and observing the specific failure, then
restoring from a backup copy (working tree confirmed clean afterwards):

1. **2.5a/2.5b were RED before the fix — CONFIRMED.** Replacing `getSortValue`'s body with a bare
   `return value as SortValue` passthrough turns the suite from 19/19 green to **2 failed, 17
   passed** — exactly the numeric-string proof and the blanks-last proof.
2. **2.4's guard is mutation-failable — CONFIRMED.** Mutating `useSortedRows.ts`'s no-match
   passthrough (`if (!column) return rows;`) into a `columns[0]` fallback turns the suite red with
   **exactly 1 failure**, the labelled sentinel regression guard. The guard is correctly labelled a
   regression guard, not a proof test.
3. **3.3b (flush-on-unmount)** cannot pass under a cancelling debounce by construction — it
   unmounts inside the window and asserts the call — and I additionally confirmed the flush
   behaviour live against a real Output (Phase 3).

### Design decisions that had to hold — each checked against the code

1. **D3 `getValue` coercion — HOLDS.** `TableRenderer.tsx:88-105`: empty/whitespace-only string →
   `null` **before** any numeric coercion (so the hook's `null`/`undefined`-keyed blanks-last branch
   at `useSortedRows.ts:58-60` applies); numeric strings → `Number`; objects/booleans via the
   exported `formatCell`, not `String(v)`. Per value, not per column, as specified.
2. **D6 persist on user activation only — HOLDS.** The write is invoked from `handleSort`
   (`:243-262`) only. There is no effect observing `sortState` (the sole `useEffect` in the file is
   the unmount-flush cleanup, `:227-236`). `handleSort` guards `key !== UNSORTED_SENTINEL` before
   writing. Test 3.4a pins "render alone → no write, ever".
3. **D6 debounce flushes, does not cancel — HOLDS.** The cleanup clears the timer and then issues
   the pending write from a ref (`:229-235`). Verified live: sorted inside the modal, closed the
   modal ~50 ms later, and the PATCH still landed.
4. **D6a one pre-branch normalization, one `useSortedRows` call — HOLDS.**
   `usingPagination`/`usingRaw` → `naturalKeys`/`columns`/`normalizedRows`/`sortColumns`, all
   `useMemo`-stable, feeding exactly one hook call at `:213`; the three branches below are
   presentation only. Lint (rules-of-hooks as an error) independently agrees.
5. **D7 ownership pre-check — HOLDS, and the "silently non-writable for real users" hazard does
   not materialize.** `canWrite = ownerId != null && currentUserId != null && ownerId === currentUserId`
   (`:154`) — a pre-check, no PATCH-and-swallow-403 anywhere. I chased the "optional prop defaults
   to non-writable" concern to ground truth: `PanelContent.tsx:136` passes `ownerId={output.ownerId}`;
   `Output.ownerId` is a **required** field on the frontend type (`types/output.ts:25`) and a
   **non-`Option`** field on the wire (`OutputProtocol.scala:31,106`), so it is always present; and
   `PanelContent.tsx:133` is the only non-test render site of `TableRenderer` in the codebase. The
   optional prop therefore cannot silently disable persistence for a real owner — confirmed
   empirically in Phase 3, where a real sort persisted to a real Output.
6. **D5 minimal patch — HOLDS.** `updateOutput(outputId, { config: { columnSort: next } })`
   (`:259`, and the same shape in the unmount flush at `:232`). No `output.config` spread anywhere.
   Confirmed live: after two sorts the Output's stored config still carried its original
   `fieldMapping` and `tableDensity` alongside the new `columnSort`.
7. **Reuse only — HOLDS.** No new comparator (the adapter writes no ordering logic), no new glyph
   (`faSort`/`faSortUp`/`faSortDown`, identical ternary to `SortableTh.tsx:33-38`), no new
   sort-state shape (`SortState<string>` reused verbatim, and `TableOutputConfig.columnSort` stores
   that same shape with no translation layer). The header button reuses `.sortable-th__btn` /
   `.sortable-th__glyph` / `.sortable-th__glyph--neutral` and the `ascending`/`descending`/`none`
   `aria-sort` vocabulary, and `DataGrid.tsx` imports `SortableTh.css` so the classes cannot be
   absent. A test pins the class reuse against a parallel family.
   D4's two specific incompatibilities (children-inside-`<button>` would swallow the interactive
   resize `<span>`; no `style` prop for the `appliedWidth` column-width mechanism) are real — I
   read `SortableTh.tsx` and both are accurate.

### Standards

- **CONTRIBUTING.md [mechanical]:** no inline fully-qualified names; no `any`; no `TODO`/`FIXME`
  added; no unused imports (lint is clean at `--max-warnings=0`); no dead code. The single
  `eslint-disable-next-line react-hooks/exhaustive-deps` (`:207`) is on the deliberately
  seed-once `defaultSort` memo and is documented at length immediately above it — a justified,
  narrow escape hatch, not an untyped one.
  Soft file-size budget (~250 lines): `TableRenderer.tsx` is now 319 and `DataGrid.tsx` 333. Both
  are under the ~400-line "propose a split" threshold, and much of the growth is comment prose.
  Non-blocking.
- **DESIGN.md [mechanical]:** the one new CSS rule uses only tokens (`--text-xs`,
  `--app-text-muted`, `--space-1`); no hardcoded colors, sizes or spacing anywhere in the diff. The
  sort affordance adds no CSS of its own — it inherits `SortableTh.css`, which is the strongest
  possible form of shared-component compliance short of rendering the component itself. Keyboard
  and `aria-sort` per §8 (a real `<button>`, no bespoke key handler).
- **DRY / modular / readable:** the adapter is a small pure function; normalization is memoized and
  named; no duplicated comparator. See the one drift hazard in Non-blocking Suggestions.
- **Security:** no new wire input is trusted — `readColumnSort` validates `key` is a string and
  `direction` is exactly `"asc"`/`"desc"` before use. No injection/XSS surface (no
  `dangerouslySetInnerHTML`, no URL construction).
- **Error handling:** the persist is fire-and-forget by design (owner ruling: no toast); the
  non-writable case is a pre-check rather than a swallowed error, so there is no silent failure
  masking a real one.
- **Behavior-preserving refactor:** the `TableRenderer` restructure is the one planned in D6a; the
  `panelId` → `outputId` rename is required by task 3.2; `formatCell` is exported rather than
  duplicated. No drive-by behavior change found in the diff.
- **Downstream room (evidence rule 5):** `columnSort` lands as a flat sibling of `columnOrder` with
  a comment naming HEL-451/465/469 and why nesting would be wrong (`mergeConfig` deep-merges only
  four hardcoded chart keys). Correct and verified against `OutputService.mergeConfig`.
- **Deferral is real (evidence rule 4):** server-side sort is deferred to **HEL-1027**, a named
  ticket, and the design records the false-premise correction that justified re-ruling it.

## Phase 3: UI Review — PASS

Servers started via the canonical script (`start-servers.sh` reused already-healthy servers);
`assert-phase.sh servers` → `PASS servers`. All findings below are from the running app at
`localhost:5880`, against **real seeded data** (dashboard "HEL-303 Panel Kind Sweep", Output
`hel904-output-05d14f95-…` "Full Data Grid", 30 columns × 200 rows), not fixtures.

- **Happy path, end to end.** Clicking `col_0` sorted the panel and PATCHed
  `{"columnSort":{"direction":"asc","key":"col_0"}}` onto the real Output; a re-read showed
  `fieldMapping` and `tableDensity` **untouched** — the minimal-patch/lost-update guarantee
  confirmed on the wire, not just in a mock.
- **Persistence across page reload** — reloaded, reopened the dashboard, `col_0` still
  `aria-sort="ascending"`.
- **Persistence across detail-modal open/close (the flush-on-unmount AC)** — opened the detail
  modal (200 rows, seeded from the stored config), sorted `col_1`, closed the modal ~50 ms later
  (well inside the 300 ms window); the Output config afterwards read
  `{"direction":"asc","key":"col_1"}`. A cancelling debounce would have lost this.
- **Two-state cycle + screen/stored agreement** — second activation of `col_2` gave
  `aria-sort="descending"` on screen and `{"direction":"desc","key":"col_2"}` stored.
- **Keyboard** — the affordance is a real `<button type="button">`, focusable, accessible name =
  the column label (`col_2`); pressing **Enter** sorted, persisted, and — importantly — did **not**
  open the panel detail modal, because `DesktopPanelGrid.handleCardClick` bails on
  `closest("button")`. No entry-point conflict between sort and card-click-to-expand.
- **`aria-sort` vocabulary** — exactly one header carries `ascending`/`descending`, all other
  sortable headers carry `none`; the non-sortable "Actions"-style column carries no attribute.
- **No console errors or warnings** across every flow exercised (0 errors, 0 warnings).
- **Breakpoints** — 1440 / 1100 / 768 / 380: no layout breakage; the panel table, header buttons
  and glyphs render correctly at each.
- **Unhappy paths** — no blank screens or unhandled exceptions; the empty/never-run panel branch
  renders its existing skeleton with no sort controls.

### UI-cohesion gate (binding), judged against the running app

- **Dark, panel table:** active column shows the filled caret, every other header the dimmed
  neutral `faSort`. **Dark, list table** (`/pipelines`, HEL-1022's `SortableTh`): identical glyph
  family, identical placement (glyph trailing the label, `--space-1` gap), identical active/neutral
  treatment. They read as one system because they are literally the same CSS and the same glyphs.
- **Light, panel table, hovering a header:** label **and** glyph go to `--app-accent` together,
  clearly legible on the light header fill. **No light-theme hover token collision** of the
  HEL-866 / HEL-496 kind — expected, since the hover rules come from `SortableTh.css` itself rather
  than a new parallel rule.
- **Against the panel's own neighbours:** the whole-header click target coexists with the resize
  handle (the handle stays a sibling `<span>` outside the button; the DataGrid test pins that a
  resize drag fires no sort, and live keyboard/click activation never triggered a drag or the
  card-expand). Density is unaffected. Nothing here introduces a third variant, and the two
  neighbouring surfaces do **not** disagree with each other, so there is nothing to escalate.

### The evidence gap you flagged — assessed

Confirmed and, in my view, now closed by this evaluation rather than by the executor:

- **No baseline exists.** Only `*-post.png` (4 files). Task 5.1's pre-change baseline was never
  captured, so the executor's cohesion claim was a claim, not the inherited comparison D10 asks
  for.
- **No list-table comparator existed at all** — the single most important artifact for the
  cohesion question. **I captured it myself** (`/pipelines` list table, dark) and compared it
  directly against a fresh panel-card capture in the same theme, plus a light-theme hover capture
  of the panel header. On that evidence the cohesion claim is **true** — but it was true by
  construction (shared CSS + shared glyphs), not because it was demonstrated.
- Because the affordance is not new pixels but reused CSS, the missing baseline is an evidence
  hygiene failure rather than a design risk, and I am not failing the cycle on it. It is recorded
  here so the claim rests on something.

### D9a truncation qualifier — extra scrutiny

- **Only when truncated:** rendered inside `usingPagination && paginationHasMore`
  (`TableRenderer.tsx:265`), so it is silent when fully loaded and **entirely absent on the
  `rawRows` branch** (no pagination there). Three Jest tests pin all three cases. I additionally
  confirmed live that a fully-loaded table shows no `.panel-content__truncation-note`.
- **Layout, both themes, default dashboard-grid panel:** the executor's `panel-card-light-post.png`
  and `panel-card-dark-post.png` both show it on **one line**, un-clipped, centered above an
  undisplaced "Load more". I probed the wrap/clip risk further than the screenshots do: at a 380 px
  viewport (narrowest realistic panel, card 316 px, content box 290 px) the string's intrinsic
  width is **266 px — it still fits**, so the `white-space: nowrap` cannot clip at any supported
  size. None of D9a's three objective escalation triggers fires; no escalation is warranted.
- **Trivially removable:** one `<p>` plus one CSS rule, both commented as such. The
  `.panel-content__load-more` change (row → column flex) is the only collateral, and with a single
  child it was a no-op before.
- **Never described as owner-approved** anywhere — code, comments, specs, or artifacts (only the
  prohibitions themselves mention the phrase). The in-code comment states the provenance correctly.

## Overall: FAIL

One narrow, cheap change request. Everything else in this cycle is strong: every load-bearing
design decision holds, all four gates are green under my own re-run, both mutation/red claims
reproduce, and the whole feature — including the two hardest ACs (unmount flush, minimal patch) —
was verified end to end against a real Output rather than a mock.

## Change Requests

1. **Finish task 3.6: give `readColumnSort` real tests, and cover the two spec scenarios that
   currently have none.** `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:125-135`
   ships untested, and `specs/table-panel-column-sort/spec.md`'s "A malformed stored sort is
   ignored" and "A sort naming an unknown column renders source order" have no evidence anywhere.
   Add a Jest test — a new `outputConfigTypes.test.ts` beside the existing
   `buildOutputConfig.test.ts` is the natural home — asserting `readTableConfig`:
   - round-trips `{ columnSort: { key: "n", direction: "desc" } }` unchanged;
   - yields `columnSort: undefined` for each malformed input: `null`, a non-object (`"n"`, `7`),
     a missing/non-string `key`, and a `direction` that is neither `"asc"` nor `"desc"`
     (e.g. `"ASC"`, `"none"`, absent);
   - preserves `fieldMapping`/`columnOrder` alongside a valid `columnSort`.
   Plus one `TableRenderer` test for the unknown-column scenario: a `columnSort` whose `key` names
   no rendered column renders rows in **source** order with every header at `aria-sort="none"`.
   (Note: `--testPathPattern` is no longer accepted by this repo's jest — use `--testPathPatterns`.)
   Then re-run `npm --prefix frontend test`. Either correct the task-3.6 checkbox or make it true;
   as it stands it is checked and not true.

## Non-blocking Suggestions

- **Pin `handleSort`'s duplicated toggle reducer to the hook's.** `TableRenderer.tsx:246-249`
  re-implements `useSortedRows.toggleSort`'s asc/desc math (necessarily, since `sortState` in that
  closure is pre-toggle) — two copies of the cycle rule that can silently diverge if the shared
  hook's cycle ever changes, persisting a direction that disagrees with the screen. Cheapest fix:
  in the existing 3.4 test, additionally assert the rendered `aria-sort` after the click matches the
  persisted `direction`, so a future divergence fails a test instead of shipping. (I verified live
  that they agree today, in both directions.)
- **The "Enter/Space" DataGrid test does not press Enter or Space** — it clicks and reasons in a
  comment that a real `<button>` implies native key support. The reasoning is sound and the comment
  is honest, but `fireEvent.keyDown(button, { key: "Enter" })` on a `<button>`-vs-`<div>` mutation
  would make it an actual guard. (I confirmed Enter works live.)
- **No test covers cross-column reset to ascending** (task 1.4's wording) — the shared hook owns it,
  so this is inherited coverage, but one assertion in `TableRenderer.test.tsx` would pin the
  panel surface's own use of it.
- **File-size soft budgets:** `TableRenderer.tsx` 319 lines, `DataGrid.tsx` 333 — over ~250, under
  the ~400 split threshold. Some comment blocks (notably the ~15-line `UNSORTED_SENTINEL` header)
  restate design.md at length; a one-line pointer to `design.md` D2 would carry the same warning.
- **Evidence hygiene for the next cycle:** capture the task-5.1 baseline *before* touching the
  renderer, and always include the comparator surface (here, a list table's sort) — a cohesion
  claim with no comparator screenshot is unfalsifiable. Fresh captures taken during this review
  are in `.playwright-mcp/` in the worktree.
- **Dev-DB side effect from this review:** Output `hel904-output-05d14f95-4e3a-4806-a583-b9b77cc6528d`
  ("Full Data Grid", dashboard "HEL-303 Panel Kind Sweep") now carries
  `columnSort: { key: "col_2", direction: "desc" }` in the shared dev database, written by my live
  verification. Harmless test residue, recorded so it is not later mistaken for a defect.
