## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold agent. Everything below is derived from files in this worktree, not from rounds 1/2 or the
design's narrative. The four owner rulings were taken as given and not re-argued.

### What I verified (with evidence)

**Round 2's four CRs — actually addressed in the artifacts.**
- CR1 (stale `proposal.md`): "What Changes"/"Impact"/"Non-goals" now describe two-state reuse,
  `useSortedRows` unchanged, `{ key, direction }`, the sentinel, D6a's one-hook restructure and
  D9a. I found no surviving pre-rebase claim in `proposal.md`. ✅ (one new inconsistency — CR1 below.)
- CR2 (unspecified WRITE path): D6 now carries the concrete rule ("invoked from the `onSort`
  handler, not from an effect observing `sortState`; guards `key !== UNSORTED_SENTINEL`"), tasks
  3.3a/3.4a exist, and the spec has the normative sentence plus the scenario "Merely rendering a
  never-sorted table panel attempts no config write". ✅
- CR3 (task 2.5 unimplementable): design D6a added; tasks 2.5/2.6 rewritten. ✅
- CR4 (self-referential off-ramp): D9a's trigger is now wrap / clip / displace-Load-more at default
  grid size in either theme, and task 3b.6 requires the small-grid-panel screenshot in both themes,
  saved by path. ✅

**Attack 1 — is CR2's fix airtight? YES, and for a reason the design does not state.**
I looked for the other write paths you named. `useSortedRows` (`frontend/src/shared/ui/useSortedRows.ts`)
holds `sortState` in `useState(defaultSort)` and exposes only `toggleSort` — there is no reseed path
at all, so a config refetch cannot re-enter the write. A remount re-runs `useState`, which does not
call `onSort`. An Output whose stored `columnSort` is already the sentinel is read tolerantly and
rendered via the passthrough, and the next real activation overwrites it. The only surviving hole is
the debounce timer's lifetime — CR3.
Corollary the design should record: seeding works ONLY because `PanelContent.tsx:104-110` early-returns
a skeleton while `isLoading || !output`, so `TableRenderer` never mounts before the config is
resolved (`useOutputMeta` is async). Non-blocking note 1.

**Attack 2 — D6a's restructure. CORRECT AND SUFFICIENT.**
`TableRenderer.tsx` branches at `:70` (`paginationRows`, already `Record<string, unknown>[]`), `:104`
(`rawRows`, records built from `headers ?? rawRows[0].map((_, i) => String(i + 1))` at `:105-107`) and
`:120` (skeleton). Both data branches already produce the same `{ rows: Record<string, unknown>[],
columns: ColumnDef[] }` pair via `orderedColumns`, so one pre-branch normalization plus one
`useSortedRows` call is straightforwardly derivable, and the empty case normalizes to `rows: []`
(the hook's `useMemo` is safe on an empty array). Non-sorted behaviour is preserved by D2's
passthrough. The rules-of-hooks claim is real: `eslint.config.cjs` enables the plugin as errors.

**Attack 3 — proposal vs design/tasks/specs.** One new contradiction, CR1.

**Attack 4 — D9a with fresh eyes.** The trigger is now observable from a screenshot (wrap / clip /
displacement of an existing button), and 3b.5 + 3b.6 give the final gate something to judge.
`PanelCard.tsx:113-115` → `PanelContent` → `TableRenderer`'s `paginationHasMore` block confirms the
anchor exists in the small grid panel, so 3b.6 is capturable. I do not refute D9a.

**Attack 5 — D10 / tasks §5.** 5.1 requires a BASELINE before the change, 5.2 post-change in both
themes, both referenced BY PATH, 5.3 escalates rather than adding a third variant. That is a real
path-referenced comparison, not a narrative claim.

**What both earlier rounds missed — the comparator's behaviour on THIS surface.** See CR2. I
reproduced it twice with node against the shipped comparator's exact call:
`["1.5","1.25","10.2","9.9"]` sorted with `localeCompare(..., { numeric: true, sensitivity: "base" })`
yields `1.5 < 1.25 < 9.9 < 10.2`.

### Verdict: REFUTE

### Change Requests

1. **The ticket AC "Numeric columns sort numerically, not lexically; blank cells sort last" has no
   spec scenario and no task.** Neither `specs/data-grid/spec.md` nor
   `specs/table-panel-column-sort/spec.md` contains a numeric-ordering or blanks-last scenario, and
   tasks §2 only says (2.2) not to reimplement them. Meanwhile `proposal.md`'s Capabilities section
   advertises that the new capability defines "comparator semantics (numeric-aware, blanks last,
   stable)" — content that exists in no spec file and that D3 explicitly declines to write. Fix
   both halves: either delete the comparator clause from the proposal's capability description, or
   (preferred) add scenarios to `specs/table-panel-column-sort/spec.md` covering numeric ordering
   and null/undefined-last so the AC has an acceptance signal, and add the matching Jest task.

2. **As designed, the AC in CR1 is not met on this surface: string-typed numeric columns sort
   wrongly.** `design.md:90` and `tasks.md:29` both require `getValue` to let `string` values
   "pass through". `useSortedRows.compareNonNull` takes the numeric branch (`a - b`) only when BOTH
   values are `typeof number`; strings fall to `localeCompare(..., { numeric: true })`, which
   compares digit RUNS and therefore orders `1.5` before `1.25` (reproduced twice above). This is
   not a hypothetical for panels: the `rawRows` branch is `string[][]` — every value is a string —
   and CSV-sourced snapshots carry numbers as strings on the pagination branch too. HEL-1022 never
   hit this because the four list tables' `getValue` returns real typed numbers off typed models.
   Fix at the boundary, which reopens no ruling and touches no shared code: specify in D3 and task
   2.1 that `getValue` coerces a string whose trimmed value is a finite number to `Number(...)`,
   and decide explicitly whether that is per-value (mixed columns then fall back to string compare
   in `compareNonNull`, which is fine) or per-column. Add the Jest case from CR1 against a
   decimal-valued string column, on the `rawRows` branch specifically.

3. **The persist debounce's unmount behaviour is unspecified, and the two readings differ against
   an acceptance criterion.** D6 and task 3.3 say "debounced ~300 ms" and stop there. The standard
   `useRef` + `clearTimeout`-on-cleanup idiom CANCELS the pending PATCH when the component
   unmounts — and the AC "Sort persists across panel detail-modal open/close" plus the Playwright
   step 5.4 exercise exactly that (sort, then close the modal, which unmounts `TableRenderer`).
   The other reading (fire-and-forget timer, or flush on unmount) persists it. State which one D6
   mandates — flush-on-unmount is the one that satisfies the AC — and add a task asserting it, so
   5.4 is not a timing race.

4. **D7's writability predicate is never named, in a design that otherwise pins file:line for every
   decision.** D7 and task 3.5 say only "when the caller cannot write the Output". Two plausible
   implementations are observably different: (a) a pre-check comparing `Output.ownerId`
   (`frontend/src/features/pipelines/types/output.ts:25`) against `state.auth.currentUser?.id` (the
   selector idiom used at `useOnboardingHost.ts:35`, and the ownership idiom at
   `PipelineListTable.tsx:151`), versus (b) attempting the PATCH and swallowing a 403. Only (a)
   satisfies the spec's own scenario "no config write is attempted"; (b) puts a failing request on
   the wire on every grantee sort click. Name the predicate and its source in D7 and task 3.5.

### Non-blocking notes

1. Record in D6/D6a that seeding the persisted `columnSort` through `useSortedRows`' `useState`
   initializer is only correct because `PanelContent.tsx:104-110` withholds `TableRenderer` behind
   a skeleton until `useOutputMeta` resolves. `useSortedRows` has no reseed path, so if that guard
   is ever relaxed the stored sort silently stops applying.
2. D2 does not fix the sentinel's literal value. Pick one that cannot collide with a JSON column
   key (e.g. a `__helio_`-prefixed token) at the definition site the D2 comment already requires.
3. D9a/task 3b.3 says "the DEFAULT dashboard-grid panel size" without naming it; naming the concrete
   default grid `w`/`h` would make the trigger reproducible by the final gate rather than by the
   executor's judgement of what "default" means.
4. `tasks.md` orders 3.3a, 3.4a, 3.4 — cosmetic, but 3.4a reads as if it follows 3.4.
