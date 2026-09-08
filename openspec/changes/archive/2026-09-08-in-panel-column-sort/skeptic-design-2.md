## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold agent. Every claim below is derived from files in this worktree at `6b081b86`, not from
round 1's report or the design's own narrative. The three owner rulings and D9's client-side-only
ruling were taken as given and not re-argued.

### What I verified (with evidence)

**Round 1's six CRs — actually addressed, not merely acknowledged.**
- CR1 (D4 merge claim false): design now carries D6 "minimal patch, never a spread", and the
  Risks row was rewritten. Verified independently below.
- CR2 (clearing-sort persistence): genuinely moot under the two-state ruling; D6 says so
  explicitly rather than dropping it silently. ✅
- CR3 (`sort` name collision): resolved to `columnSort` in D5, tasks 3.1, and the spec's
  normative text. `outputConfigTypes.ts:71-74` `TimelineOutputConfig.sort` confirmed still there,
  read as a bare direction at `:148`. ✅
- CR4 (converges on load, not live): D8 + spec requirement rewritten, with a dedicated scenario
  "Sorting one panel does not move its sibling in the same session". ✅
- CR5 (non-owner write): D7 + task 3.5 + two spec scenarios. ✅
- CR6 (citable screenshots): tasks 5.1/5.2 now require baseline AND post-change, both themes,
  saved and referenced BY PATH. ✅

**Attack 1 — D2's sentinel `defaultSort`. The passthrough is REAL.**
`frontend/src/shared/ui/useSortedRows.ts` — `const column = columns.find((c) => c.key ===
sortState.key); if (!column) return rows;`. A sentinel key matching no column returns `rows`
unchanged, and `SortableTh`'s `direction` is `null` for every column, giving the neutral glyph.
The mechanism works. The mitigations (mutation-failable guard + comment at the sentinel) are
proportionate for a two-line, load-bearing, unspecified behaviour. I do NOT refute D2's mechanism.
Note for the executor's comment: DESIGN.md ~458 says `defaultSort` "should match the page's
backend-driven default order" — the sentinel is a deliberate documented deviation from that line,
and the comment should say so, not just point at the hook.
The sentinel does, however, create an unspecified WRITE hazard — CR2 below.

**Attack 2 — D4's two `SortableTh` incompatibilities. BOTH VERIFIED TRUE.**
1. `SortableTh.tsx` renders `<th ...><button className="sortable-th__btn">{children}...</button></th>`
   — children are inside the button. `DataGrid.tsx:240-250` renders the resize handle as
   `<span role="separator" tabIndex={0} onMouseDown=... onKeyDown=...>` inside the `<th>`.
   Nesting that in the button is invalid HTML and every drag would fire the sort. Confirmed.
2. `SortableThProps` = `{ children, direction, onSort, className?, scope? }` — no `style`.
   `DataGrid.tsx:236` sets `style={appliedWidth !== undefined ? { width: appliedWidth } : undefined}`
   on the `<th>`; that IS the column-width mechanism. Confirmed.
The reuse argument therefore stands, and D4's compensating commitment (reuse the actual
`.sortable-th__btn`/`.sortable-th__glyph` classes and the exact FontAwesome glyph set) is the right
mitigation — `SortableTh.css` shows the hover/focus/neutral treatment those classes carry, so
reusing them inherits the HEL-1022 follow-up glyph-size fix instead of re-committing that bug.

**Attack 3 — D6's minimal-patch claim. VERIFIED CORRECT.**
`OutputService.scala:247` `val mergedConfig = req.config.map(patch => mergeConfig(existingConfig, patch))`;
`:274-282` `mergeConfig` = `existing.fields ++ patch.fields` (shallow), deep-merging only
`legend`/`tooltip`/`seriesColors`/`axisLabels`. A patch omitting `fieldMapping`/`columnOrder`
cannot lose them — `existing.fields` supplies them and `++` only overwrites keys the patch names.
`validateFieldMapping` runs on the MERGED config (`:250-252`), so a `columnSort`-only patch is
judged against the already-stored `fieldMapping`, which for `kind = table` has no binding slots.
D5's flat-siblings-not-a-nested-container conclusion also follows correctly from the same code.

**Attack 4 — D9a. Truthful and anchored, but under-specified at its riskiest point.** See CR4.
The anchor exists in BOTH surfaces, which I checked rather than assumed: `PanelCard.tsx:113-115`
passes `paginationHasMore`/`onLoadMore` through to `PanelContent`, and `TableRenderer` renders the
"Load more" block under `paginationHasMore`. So the qualifier can sit beside a real affordance in
the small dashboard-grid panel as well as the modal. The `rawRows` branch has no pagination and is
correctly silent. The claim itself is truthful given Context §2. What is NOT adequate is the
escalation trigger and the evidence it must produce — CR4.

**Attack 5 — tasks/specs verifiability.** Largely good: each spec scenario maps to a task; 4.2
pre-empts the root-`npm test` false-green by name; 2.4 and 3.4 demand mutation-failable guards and
label them as guards rather than proofs. Two structural gaps: CR2 and CR3.

**Gate-scan discipline.** I did not cite any gate as evidence. Task 4.2's warning is accurate:
root `npm test` is `jest --passWithNoTests && npm --prefix frontend test`.

### Verdict: REFUTE

### Change Requests

1. **`proposal.md` is stale pre-rebase and now contradicts the owner rulings and the design.**
   It is not a scratch file — it is the archived artifact and the PR-body source. Four concrete
   contradictions, all in "What Changes":
   - "activating a header cycles ascending → descending → **unsorted**" — directly contradicts
     RULING 1 and D1's "Do not add a 'none' direction".
   - "**A shared, exported sort comparator**: numeric-aware ... blank values last ... stable" —
     mandates exactly the new comparator that D3, tasks §2 preamble, and DESIGN.md ~540
     ("Retrofit an existing table onto this pattern rather than writing a bespoke comparator")
     forbid.
   - "Sort state `{ columnKey, direction }`" — wrong shape; `SortState` is `{ key, direction }`
     (`useSortedRows.ts`), and D5/tasks 3.1 persist that shape verbatim with no translation layer.
   - Impact bullet "new optional `sort`/`onSortChange` props" — tasks 1.1 specifies `sort`/`onSort`.
   Rewrite "What Changes"/"Impact" against D1/D3/D5/D6, and add the D9a truncation qualifier to
   the proposal's scope (it is currently invisible outside design.md and tasks §3b, so a reader of
   the proposal alone would see it as unscoped work in the diff).

2. **The sentinel's WRITE path is unspecified, and the naive reading pollutes every table Output.**
   D6 says `TableRenderer` "writes back debounced ~300 ms" and nothing more. `useSortedRows` holds
   `sortState` in `useState`, so the obvious implementation — a debounced effect keyed on
   `sortState` — fires on MOUNT, with the sentinel, on every table panel a user merely views. That
   PATCHes `columnSort: { key: "<sentinel>", direction: "asc" }` into the Output config, and
   task 3.1's tolerant read (string `key`, direction exactly `asc`/`desc`) ACCEPTS it, so it
   round-trips and persists forever. It is visually benign (D2 passthrough) and therefore silent —
   the worst kind. It also makes D7's non-owner suppression path fire on every view rather than on
   a real interaction. Specify in D6, and add a task under §3: the persist fires only on a user
   activation (never on mount / never on a config-seeded state change), and the sentinel key is
   never written. Add a spec scenario under "Sort state is written as a minimal config patch":
   "merely rendering a never-sorted table panel attempts no config write".

3. **Task 2.5 ("apply on BOTH branches") is not implementable as written without a restructure no
   artifact specifies.** `TableRenderer.tsx` early-returns in three places (`paginationRows` branch
   at `:73`, `rawRows` branch at `:104`, empty skeleton at `:119`), and the two data branches derive
   *different* `rows` and *different* `columns` (`paginationRows` are already
   `Record<string, unknown>`; the `rawRows` branch builds records from `headers`/positional indices
   at `:105-107`). `useSortedRows` must be called unconditionally before the branches, and
   `eslint.config.cjs:70,79` enables `reactHooks.configs.recommended` (rules-of-hooks = error) under
   a zero-warnings policy, so the naive per-branch call will not even lint. Specify the shape in the
   design: one pre-branch normalization producing a single `{ rows, columns }` (plus the "no rows"
   case) feeding one `useSortedRows` call, with the branches reduced to presentation. Without this
   the executor improvises a component restructure under a "keep changes focused" rule and the final
   gate has nothing to judge it against.

4. **D9a's off-ramp will not fire as written, and its riskiest surface is not in the evidence set.**
   "If making it truthful costs more than 3b.1/3b.2 allow" is self-referential — an executor who has
   already written the qualifier will always read its own output as within budget, so the escalation
   never triggers. Replace it with an objective, observable trigger, e.g.: *escalate with a
   screenshot if the qualifier wraps, clips, is truncated by overflow, or displaces the "Load more"
   button at the DEFAULT dashboard-grid panel size, in either theme.* Correspondingly, amend
   task 3b (and §5) to require a screenshot of the qualifier in a **small dashboard-grid panel**
   specifically — not only the detail modal — in both themes. That is where the space is tightest
   and the truncation is worst (50 rows vs 200, per D9's own numbers), and it is the one place the
   current task list does not commit anyone to look. With those two amendments D9a is sound and I
   do not think it needs a separate design cycle; without them it is the item most likely to ship
   as an untested one-off.

### Non-blocking notes
- D10 and tasks 5.1-5.3 do commit the executor and the final gate to a real, path-referenced visual
  comparison against BOTH neighbours in both themes, with the "if they disagree, say so rather than
  adding a third variant" clause intact. That part is adequate as written. I did not capture a
  baseline myself: the REFUTE was established from static ground truth, the executor must re-render
  this surface anyway, and task 5.1 correctly assigns the baseline to the pre-change executor run.
- Round 1 cited `premise-validation.md` as carrying a false "pagination is sliced client-side —
  CONFIRMED" line. That file is no longer in the change directory, so the correction has effectively
  landed; design.md Context §2 now states the real mechanism with the right citations
  (`panelThunks.ts:295` comment vs `:309-311` code, `panelsSlice.ts:204-207` append).
- `TableRenderer.tsx:11-13` `panelId` is documented as an Output id and is still not destructured
  (`:52-59`); tasks 3.2's rename to `outputId` is the right call.
- With a sort active, "Load more" inserts rows mid-list. The spec is honest about it and D9a
  discloses it; still worth a look at the final gate for scroll-position jank.
