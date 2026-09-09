# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `4765bc66` on `feature/in-panel-column-filtering/HEL-451`, base `origin/main`
@ `36a9c1cc`. Working tree clean before and after review (mutation probes reverted with
`git checkout --`; `git status --porcelain` empty).

## Phase 1: Spec Review — FAIL

What holds (verified against the diff, not the handoff):

- D1 storage: `columnFilters` is a flat sibling of `columnSort` on `TableOutputConfig`;
  `readColumnFilters` is tolerant (`outputConfigTypes.ts:156-170`).
- D2 predicate: `tableFilterPredicate.ts:9-13` calls the exported `formatCell` — reused, not
  reimplemented. Match source and rendered text cannot drift.
- D3: filter inserted BEFORE `useSortedRows` in the same single pipeline
  (`TableRenderer.tsx:238-241` → `:262`), `useMemo`-stable, no second hook call, no second
  normalization. Lint (which enforces `rules-of-hooks` as an error) passes.
- D6 persistence: minimal patch `{ config: { columnFilters } }` (`TableRenderer.tsx:157`), no
  `output.config` spread, independent debounce timer/ref pair flushed (not cancelled) on unmount
  (`:296-299`), `canWrite` PRE-check before the timer is even armed (`:337`), local state applied
  immediately with only the PATCH debounced.
- Task 4.0: `rowsTruncated` wired at BOTH `PanelContent` call sites (`PanelCard.tsx:121`,
  `PanelDetailModal.tsx:422`) from `usePanelData.ts:146`. `usePanelData`'s `String(v)` is
  untouched — the HEL-1033 boundary held.
- Task 4.0c removal seam: one `LoadedScopeDisclosure.tsx`, one marker comment, two call sites;
  `grep -rn LoadedScopeDisclosure` returns exactly the component, its two renders and its import.
  Nothing anywhere describes D9a as owner-approved (task 4.6 holds).
- Task 4.0f supersession is structural (one `if`/`else` chain inside the component), not a pair of
  drifting conditions.
- HEL-1027 and HEL-1033 are named as the owners of the moved AC and the deferred display defect.

What does not hold:

1. **Two `[x]` boxes have no test behind them (tasks 2.3 and 4.5).** Both explicitly require the
   `rawRows` branch — "the `rawRows` branch is where BOTH of HEL-448's ordering defects actually
   lived" (2.3) and "a matrix tested only against pagination proves nothing about the case that was
   actually broken" (4.5). The `TableRenderer — column filtering (HEL-451)` describe block contains
   **zero** occurrences of `rawRows` (`sed -n '/column filtering (HEL-451)/,/filter persistence/p'
   TableRenderer.test.tsx | grep -c rawRows` → `0`). Every filtering, composition and matrix test
   renders `paginationRows`. The only `rawRows` coverage added is in the truncation-qualifier
   block (4.0d/4.0e/4.5a), which is a different task. This is the exact failure mode
   `workflow-state.md`'s evidence-discipline item 5 names, and this lane has now hit it twice.

2. Scope creep: none. Planning artifacts otherwise match the implementation.

## Phase 2: Code Review — FAIL

**Gates re-run by me, in `WORKTREE_PATH`, at `4765bc66`** (`CLEAN_WORKTREE` unset — gates ran
directly in the worktree, as configured):

| gate | what it actually scans | result |
| --- | --- | --- |
| `npm run lint` | `eslint . --max-warnings=0` — whole repo | pass, 0 warnings |
| `npm run format:check` | `prettier . --check` — whole repo | pass |
| `npm run typecheck` | `tsc --noEmit` against `frontend/tsconfig.json` | pass |
| `npm --prefix frontend test` | `jest --config frontend/jest.config.cjs` — all frontend suites | 280 suites / 2897 tests, all pass |

Root `npm test` was correctly NOT cited by the executor and is not cited here: its root `jest` arm
runs `--passWithNoTests` against a worktree root with no tests and converts silence into a pass.
No backend files changed, so `sbt test` is not a gate for this diff.

**Executor's mutation claims — independently re-verified, both genuinely failable:**

- M1 (collapse the button gate onto the note gate: `canOfferLoadMore = rowsTruncated`) → 2 tests
  red, including the labelled `4.0e REGRESSION GUARD` and `4.0a`.
- M2 (revert `truncated` to a locally re-derived `usingPagination && (paginationHasMore ?? false)`)
  → 12 tests red, including the labelled `4.5a REGRESSION GUARD`, `4.0d PROOF`, and the `4.0f`
  supersession test.

Both mutations were applied in-place and reverted; the tree is clean.

**Fixture/test accommodation check.** Three `usePanelData` mocks gained `rowsTruncated: false`
(`PanelCard.test.tsx`, `PanelDetailModal.panelSwitch.test.tsx`, `MobilePanelStack.test.tsx`) and
two `TableRenderer.test.tsx` helpers were re-scoped to exclude the new `<thead>` filter rows.
Both are legitimate consequences of a genuinely new prop and genuinely new markup, not fixtures
edited to make an assertion pass. No existing assertion was weakened.

Findings:

3. **Dangling design token, with a visible rendered consequence — [mechanical] DESIGN.md
   violation.** `frontend/src/shared/ui/DataGrid.css:208` sets `font-weight:
   var(--weight-normal)`. `--weight-normal` **does not exist** (theme.css:32-35 defines
   `--weight-regular`, `--weight-medium`, `--weight-semibold`, `--weight-bold`); this is its only
   use in the repo. The declaration is invalid at computed-value time, so the intended 400 never
   applies and the per-column filter inputs inherit `thead th`'s `--weight-semibold`. Measured live
   on 5883: `getComputedStyle(perColumnFilterInput).fontWeight === "600"`, against the
   quick-filter input's `"500"`. Neither lint nor 2897 unit tests can see this.

4. **Dead prop.** `paginationHasMore` remains declared on `TableRendererProps`
   (`TableRenderer.tsx:35`) and is still passed by `PanelContent.tsx:146`, but the destructure that
   consumed it was removed — nothing in `TableRenderer` reads it any more. Dead code per
   CONTRIBUTING; also misleading, since it is now a prop that looks like it still gates truncation.

5. **Task 4.0g was not implemented as specified, and its code comment misdescribes what it does.**
   4.0g is the single authoritative wrapper rule and requires the two children's visibility as
   named booleans FIRST, wrapper derived from them:
   `showSortNote = rowsTruncated && !filtering`, `showLoadMoreBtn = rowsTruncated && onLoadMore != null`,
   `wrapper = showSortNote || showLoadMoreBtn`. What shipped is
   `TableRenderer.tsx:355`: `const showTruncationWrapper = !isEmpty && (rowsTruncated || canOfferLoadMore)`
   — and since `canOfferLoadMore = rowsTruncated && onLoadMore != null`, that whole disjunction
   reduces to `rowsTruncated`. The wrapper is gated on `rowsTruncated` alone, which is precisely
   the shape 4.0g forbids. There is no `showSortNote` boolean anywhere.
   The empty-padded-box hazard is nevertheless AVOIDED, but by a different mechanism than the one
   4.0g reasoned about: the executor moved the filter-scoped message INSIDE the wrapper, so
   `LoadedScopeDisclosure` returns non-null whenever `rowsTruncated` is true, filtering or not. I
   verified the state 4.0g called out — `filtering && rowsTruncated && !onLoadMore`, non-empty —
   renders the wrapper containing `"N of M loaded rows match."`, which is the message design D4b's
   filter table requires there, not an empty box. So this is a **deviation from a settled,
   four-round-fought rule that happens to be behaviourally sound**, not a defect. It is
   nonetheless a Change Request because the comment at `:349-354` asserts the wrapper is "kept as
   `rowsTruncated || canOfferLoadMore` (not simplified to `rowsTruncated` alone)" — a distinction
   that does not exist, since the two are identical. A comment is not evidence, and this one is
   false. Either implement 4.0g's named-boolean shape or amend design.md/tasks.md to record the
   restructure and why it is safe.

6. **The count message renders in two different places depending on truncation.** Not truncated:
   `LoadedScopeDisclosure` is rendered ABOVE the `DataGrid` (`TableRenderer.tsx:411-418`).
   Truncated: it renders BELOW the grid inside `.panel-content__load-more` (`:437-442`). Measured
   live: `"1 result."` at viewport top 347 with the grid at 362. So the same message jumps from
   above the table to below it as soon as one more page exists upstream. Also, the non-truncation
   count reuses `class="panel-content__truncation-note"`, a class named for the thing it is not.

7. Minor: the filter inputs have no coarse-pointer tap-target bump, while the sibling
   `.panel-content__clear-filters-btn` this diff adds does
   (`TableRenderer.css` `@media (max-width: 430px), (pointer: coarse) { min-height: 44px }`).
   `--control-sm` is 28px. DESIGN.md §3 tap targets.

Positives worth recording: type safety is clean (no `any`, no escape hatches); the tolerant
`readColumnFilters` mirrors `readColumnSort`; the `.catch` swallow is deliberate and documented;
no dead imports; no TODO/FIXME added.

## Phase 3: UI Review — FAIL

Servers: `start-servers.sh` reused healthy servers; `assert-phase.sh servers` → `PASS servers`.
**Port hygiene:** the shared Playwright session was indeed pointed at another lane (5873) on
first navigation — every observation below was re-taken after forcing
`http://localhost:5883/` and confirming `location.href` and the page title.
Real data used: dashboard `HEL254WideType overview` → panel bound to Output
`hel904-output-e2ee1b2e-3b59-4334-8988-36e722a3b9bc` (30 cols × 200 rows), confirmed by the live
network log, and it is one of the legacy Outputs whose `fieldMapping` fails HEL-892 validation.

Works: quick filter narrows live (`r1c0` → 1 body row, first cell `r1c0`); clearing restores;
per-column inputs render one per column with `aria-label="Filter column <name>"`; quick input
`aria-label="Quick filter across all columns"`; keyboard-reachable native `<input>`s; light and
dark both legible (`--app-surface` input on `--app-surface-soft` row; light-theme contrast fine,
no HEL-866/HEL-496 hover collision on these controls).

**The residual gap the executor flagged is now CLOSED, and it PASSES.** I reproduced the exact
shape HEL-448's final-gate defect lived in:

```
PATCH /api/outputs/hel904-output-e2ee1b2e-3b59-4334-8988-36e722a3b9bc
  {"config":{"columnFilters":{"quick":"col"}}}
→ 400 {"message":"Unknown fieldMapping slot(s) for 'table': columns. Valid slots: "}
```

(`OutputBindingSpec.Table` has NO valid slots, so any non-empty stored `fieldMapping` on a table
Output makes every merged-config write a 400 — this is not a narrow edge, it is every legacy table
Output carrying a pre-HEL-892 `fieldMapping`.) Typing in the panel's quick filter fires that PATCH,
it 400s, and the client degrades **silently and correctly**: the only console entry on 5883 is the
browser's own `Failed to load resource: 400` network line — no unhandled rejection, no
`AxiosError` unhandled at the top level (the `AxiosError` entries in the shared console log are
from port 5880, another lane), nothing surfaced to the user, and the filter stays applied on
screen. `persistColumnFilters`'s `void ... .catch(() => {})` holds.

**BLOCKING UI DEFECT — rendered geometry (two-axes (a), task 6.3), measured not eyeballed.**

All three `<thead>` rows are `position: sticky; top: 0` — the pre-existing column-header row
(`DataGrid.css:66-68`) plus both new filter rows (`DataGrid.css:180`, `:185-187`, `:194-196`).
They therefore stack on top of each other the moment the table body scrolls. Measured on 5883,
`.ui-data-grid` scrolled to `scrollTop = 100`:

```
header row th   top = 347   height 34.5
quick filter th top = 347   height 45
column filter th top = 347  height 45
```

Screenshot of the scrolled panel shows only the per-column filter row, with the column-name header
and quick-filter row completely painted over and a clipped sliver of a data row above the first
visible one. **The user loses the column headers entirely as soon as they scroll** — a direct
regression of the sticky-header behaviour HEL-253/HEL-448 rely on, on the exact panel the
filter feature is for. This is the "no source text carries it" class the run's binding state
called out; lint, 2897 unit tests, and the six committed screenshots (all captured unscrolled)
pass over it. The CSS comment at `DataGrid.css:188-192` is a garbled half-sentence
("The quick-filter row sits above the header row's own sticky offset would require measuring its
rendered height") that reads as an unfinished admission that the offsets were never worked out.

**Second geometry finding — the filter rows consume the panel.** On the same default-sized
dashboard table panel, `.ui-data-grid` has `clientHeight = 143px`, of which header 34.5 + quick
filter 45 + column filter 45 = **124.5px is chrome**, leaving ~18px for a 35px data row. The panel
shows a fraction of one row. Two stacked full-width filter rows at 45px each is a large permanent
cost on every table panel on every dashboard, whether or not anyone is filtering; the HEL-448 sort
affordance by contrast costs zero additional height. This is a cohesion/judgment call as much as a
measurement, and the owner is the tiebreaker — but it needs to be a decision, not a side effect.
It is not raised as an ESCALATION because it is fixable within this ticket's own surface (e.g.
a collapsed filter row revealed on demand, or one combined row) and the first geometry defect
forces a cycle anyway.

Other Phase 3 checks: unhappy paths handled (no blank screens; the 400 degrades silently as
designed); filtered-empty state renders inside the live grid with the filter row still visible;
feature reachable from the dashboard grid; breakpoints not separately re-measured this cycle
because the header-overlap defect must be fixed first and will change the geometry under test.

## Overall: FAIL

## Change Requests

1. **Fix the sticky-header collapse.** `frontend/src/shared/ui/DataGrid.css:185-196`: the three
   `<thead>` rows cannot all be `top: 0`. Give each row its own sticky offset (the header row
   `top: 0`, the quick-filter row the header's height, the column-filter row the sum) — measured or
   CSS-derived, not guessed — or drop `position: sticky` from the filter rows if they are not meant
   to stick. Verify by scrolling a real table panel and asserting the three rows' `getBoundingClientRect().top`
   are distinct and monotonically increasing. Replace the garbled comment at `:188-192` with one
   that states the actual offset scheme.

2. **Reduce the vertical cost of the filter affordance, or get an explicit owner decision on it.**
   124.5px of chrome in a 143px scroll area leaves a table panel showing a fraction of one row. If
   the answer is "this is acceptable", say so in design.md with the measurement; if not, collapse
   the two rows into one, or reveal the filter row on demand. Re-measure `clientHeight` vs.
   chrome height on a default-sized dashboard panel afterwards.

3. **Fix the dangling token.** `frontend/src/shared/ui/DataGrid.css:208`: `var(--weight-normal)` →
   `var(--weight-regular)` (theme.css:32). Confirm with
   `getComputedStyle(perColumnFilterInput).fontWeight === "400"` in the running app — today it is
   `600`, inherited from the semibold header row.

4. **Add the missing `rawRows`-branch coverage that tasks 2.3 and 4.5 are checked off for.** In
   `TableRenderer.test.tsx`'s `column filtering (HEL-451)` block, add (a) filter-then-sort
   composition on `rawRows`/`headers` — filtered rows stay sorted, re-sorting does not restore
   filtered-out rows — and (b) the five D4b disclosure states on the `rawRows` branch, not only
   the pagination branch. Do not mark them `[x]` again until the assertions exist.

5. **Resolve the 4.0g divergence.** Either implement the rule as written (named `showSortNote` /
   `showLoadMoreBtn` booleans, wrapper derived from them) at `TableRenderer.tsx:349-355`, or amend
   design.md D4b and tasks.md 4.0g in the same pass to record that the filter-scoped message moved
   inside the wrapper and that this is what keeps the empty-padded-box state unreachable. Either
   way, delete or correct the comment at `:349-354` — `rowsTruncated || canOfferLoadMore` is
   identical to `rowsTruncated`, so the distinction it claims to preserve does not exist.

6. **Remove the now-dead `paginationHasMore` from `TableRenderer`.** Drop it from
   `TableRendererProps` (`TableRenderer.tsx:35`) and stop passing it at `PanelContent.tsx:146`
   (leave `PanelCard`'s own `paginationEntry?.hasMore` usage for the other props that still need
   it). Nothing in `TableRenderer` reads it, and leaving it in place suggests it still gates
   truncation, which is the misreading this whole task set exists to remove.

7. **Decide the count message's placement.** `TableRenderer.tsx:411-418` renders it above the grid
   and `:437-442` below it, so it jumps position when `rowsTruncated` flips. Pick one. If it stays
   outside the truncation wrapper in the non-truncated case, give it its own class rather than
   reusing `panel-content__truncation-note` for a message that is explicitly not a truncation note.

## Non-blocking Suggestions

- Add the coarse-pointer 44px bump to `.ui-data-grid__filter-input` to match the
  `.panel-content__clear-filters-btn` this diff already gives one (DESIGN.md §3).
- `LoadedScopeDisclosure`'s `matchCount`/`loadedCount` are documented as "ignored when
  `!filtering`" but are still required props; making them optional would let the sort-note call
  site stop passing values that are never read.
