# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `9a4b1998` on top of `fe76979f`; base still `origin/main` @ `6b081b86`.
Working tree clean apart from my own `evaluation-1.md`/`evaluation-2.md`.

## Phase 1: Spec Review — PASS

**No implementation file changed in this cycle.** `git diff fe76979f..9a4b1998 --name-only -- frontend/src`
filtered of `*.test.*` is **empty** — the delta is one new test file, one test rename/comment in
`TableRenderer.test.tsx`, `files-modified.md`, and two `.png` comparators. Everything Phase 1
established in cycle 1 (all ACs addressed, no reinterpretation, no scope creep, spec deltas honest,
D9a provenance correct everywhere) therefore stands unchanged by construction, and the one Phase 1
defect I raised is now addressed.

- **Task 3.6 is now true rather than merely checked.** The relabel of the misleading "3.1/3.6"
  test to "3.1 (seeding)" is the right correction: that test never touched the parse, and the
  comment now points at where the parse coverage actually lives.
- **No test or fixture was edited to accommodate rather than to verify.** The only change to an
  existing test is its `it(...)` title plus a comment — I read the full diff hunk; no assertion,
  no expected value, no input was altered. The new file is additive.

## Phase 2: Code Review — PASS

### Gates (re-run fresh by me, in `WORKTREE_PATH`, at `9a4b1998`)

| Gate | Result | What it scanned |
| --- | --- | --- |
| `npm run lint` | PASS (`eslint . --max-warnings=0`) | whole repo incl. the new test file |
| `npm run typecheck` | PASS (`tsc --noEmit`) | `frontend/tsconfig.json` project |
| `npm run format:check` | PASS (`prettier . --check`) | whole repo |
| `npm --prefix frontend test` | PASS — **273 suites / 2803 tests** | the gate that executes this code |

Counts moved 272→273 suites and 2789→2803 tests: **+1 suite, +14 tests**, exactly matching the 14
`it` blocks in the new file. The delta is accounted for; nothing was quietly skipped or removed.
(`npm --prefix frontend test` remains the right gate to cite — root `npm test`'s
`jest --passWithNoTests` arm still finds nothing in a worktree root.)

### CR1 — closed, and verified not to be a shadow copy

- `outputConfigTypes.test.ts:1` imports **`readTableConfig` from `./outputConfigTypes`** — the real
  module. There is no re-implementation, no local copy of the parse, and no mock of it anywhere in
  the file.
- **Mutation check (my own, not the executor's claim):** replacing `readColumnSort`'s body with a
  naive `return value as SortState<string> | undefined` passthrough turns the new suite from 14/14
  green to **9 failed, 5 passed**. The malformed-tolerance assertions are genuinely load-bearing on
  the real implementation, not vacuous. Source restored; `git status` clean afterwards.
- **Coverage vs. the spec's tolerance requirement** ("an object with a string `key` and a
  `direction` of exactly `asc`/`desc`, else `undefined`"): every clause of that sentence is
  exercised — missing `key`, non-string `key`, `direction` neither value, `direction` absent,
  non-object (`string`, `number`), `null`, array, and a both-fields-wrong case asserted
  `not.toThrow()`. Plus the positive round-trip in both directions, the absent-field default, and a
  test that `fieldMapping`/`columnOrder` still parse correctly alongside a valid `columnSort`.
  I could not find a clause of the requirement left uncovered.

### The two previously-unevidenced spec scenarios

1. **"A malformed stored sort is ignored" — COVERED.** Seven malformed shapes, all asserting
   `undefined` (the unsorted default) and one asserting no throw. Mutation-failable, per above.
2. **"A sort naming an unknown column renders source order" — the executor's split argument is
   correct, and the scenario does have an acceptance signal — but not the one it points at.**
   - The claim itself checks out: the parse deliberately does not know the column set (the design
     says so at D5), so asserting it "still parses" is the right assertion *for that file*. The new
     test asserts exactly that and says why.
   - The renderer half has **no dedicated Jest test** for a *stored* unknown key. It does, however,
     have a **mutation-failable guard over the identical code path**: `defaultSort` is
     `columnSort ?? { key: UNSORTED_SENTINEL, … }` (`TableRenderer.tsx:205-208`), so a stored
     unknown key and the sentinel enter `useSortedRows` through the *same* line and rely on the
     *same* no-match passthrough. The 2.4 sentinel regression guard is precisely that guard, and I
     re-confirmed in cycle 1 that mutating the passthrough makes exactly it go red. The behaviour
     is not unguarded; only the stored-origin *entry point* is untested.
   - **I closed the residual gap with direct end-to-end evidence rather than accepting the
     argument.** I PATCHed a real Output's config to
     `{"columnSort":{"key":"no_such_column","direction":"desc"}}` (200 OK, value confirmed stored),
     reloaded the dashboard, and the panel rendered **rows in source order (`r0c0, r1c0, r2c0,
     r3c0`) with all 30 headers at `aria-sort="none"`**. The scenario is behaviourally true against
     real persisted data.
   - Verdict: this does not fall between the two files — but the automated signal for it is
     inherited rather than direct. One-line suggestion below; not a blocker.

## Phase 3: UI Review — PASS

### CR2 — cohesion comparison, judged by me against the committed evidence and the running app

Both comparators are committed (`.gitignore` excludes `*.png`, so the force-add was necessary) and
show the `/pipelines` list table's `SortableTh` header row in each theme. Compared against my own
fresh panel captures from cycle 1 and a re-check today:

- **Same glyph set, same placement, same states.** Neutral columns: dimmed `faSort` double-chevron
  trailing the label with a `--space-1` gap. Active column: filled directional caret. Identical on
  both surfaces, in both themes — necessarily so, since `DataGrid` renders the same
  `.sortable-th__btn` / `.sortable-th__glyph` / `--neutral` classes from the same `SortableTh.css`
  and the same three FontAwesome icons, with the same `ascending`/`descending`/`none` vocabulary.
- **Light theme, hover:** label and glyph both go to `--app-accent`, legible against the light
  header fill on **both** surfaces. No HEL-866 / HEL-496-style hover token collision.
- **The two neighbouring surfaces do not disagree with each other**, and no third variant was
  introduced. There is nothing here for the owner to break a tie on, so **no escalation is
  warranted** — I am not deferring a visual disagreement, I am reporting that I looked and found
  none.
- One wording correction for the PR body: the executor describes an "accent-colored **active**
  glyph". The accent is the **hover** state (`.sortable-th__btn:hover`); the *active* state is
  carried by the filled caret plus `aria-sort`, with no color rule at all. Both committed
  comparators happen to capture the active column *while hovered*, which conflates the two. The
  cohesion conclusion is unaffected (identical CSS on both surfaces), and I verified the
  un-hovered active state separately on the panel side. Evidence-quality note only.

### Cycle-1 regression re-check

The implementation is byte-identical to `fe76979f`, so nothing *can* have regressed; I spot-checked
the live behaviour anyway rather than reasoning alone:

- Sorting a column persisted `{"key":"col_0","direction":"asc"}` as a **minimal patch** — the
  Output's `fieldMapping` and `tableDensity` survived untouched.
- Screen and stored state agree (`col_0:ascending` on screen, `asc` stored).
- **D9a:** the fully-loaded panel shows **no** truncation note and no "Load more" — silent when not
  truncated, as specified; the `rawRows` branch cannot render it at all (it lives inside
  `usingPagination && paginationHasMore`); nothing anywhere describes it as owner-approved (the one
  in-code hit is the prohibition itself, `TableRenderer.tsx:266-270`).
- Zero console errors or warnings across every flow exercised.
- The seven load-bearing design decisions (D3 coercion, D6 activation-only persist, D6 flush-on-
  unmount, D6a single hook call, D7 ownership pre-check, D5 minimal patch, reuse-only) are
  unchanged code and were each verified in cycle 1 — see evaluation-1.md §Phase 2.

## Overall: PASS

CR1 is genuinely closed (real function under test, 9/14 red under mutation, every clause of the
tolerance requirement covered). CR2 is closed and I confirmed the cohesion call myself rather than
inheriting it. All four gates green under my own fresh run, with the test-count delta fully
accounted for. Nothing regressed.

## Non-blocking Suggestions

(carried forward from evaluation-1.md where still open, plus two new)

- **One line would make the unknown-column scenario directly tested** instead of inherited: in
  `TableRenderer.test.tsx`, render with `columnSort={{ key: "no_such_column", direction: "desc" }}`
  and assert source order plus every header at `aria-sort="none"`. Today that path is covered only
  via the sentinel guard (same code line) and by my live check recorded above.
- **PR body wording:** say the shared *hover* state is accent-colored and the *active* state is the
  filled caret + `aria-sort` — not "accent-colored active glyph". If the comparators are ever
  recaptured, move the pointer off the header first so hover and active are not conflated.
- Pin `handleSort`'s duplicated asc/desc reducer to the hook's, by asserting the rendered
  `aria-sort` matches the persisted `direction` in the existing 3.4 test (evaluation-1.md).
- The DataGrid "Enter/Space" test still clicks rather than pressing keys (evaluation-1.md); I have
  now confirmed Enter live in both cycles.
- File-size soft budgets: `TableRenderer.tsx` 319, `DataGrid.tsx` 333 — over ~250, under the ~400
  split threshold (evaluation-1.md).
- **Environment notes, not findings:** (a) the dev server on `DEV_PORT` 5880 had died and was
  restarted via `start-servers.sh`; mid-review the shared Playwright session was momentarily
  hijacked to another lane's port (5942) — the known parallel-worktree hazard, worth remembering
  when reading any browser-derived evidence in a parallel run. (b) Dev-DB residue from this review:
  Output `hel904-output-05d14f95-…` ("Full Data Grid") now carries
  `columnSort: { key: "col_0", direction: "asc" }` — I deliberately restored it from the
  `no_such_column` value I set for the unknown-column probe.
