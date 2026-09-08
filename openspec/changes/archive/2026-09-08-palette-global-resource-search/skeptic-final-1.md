## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is from a command I ran or a screenshot I looked at in this
session; the executor's and evaluator's reports were read only as claims.

### Content self-authentication (before any visual observation)

`curl localhost:5935/src/features/commandPalette/useResourceSearchActions.ts` returns the runtime
string `` `Search currently covers ${covered.length > 0 ? ... }` `` — a template literal that
survives Vite's type-stripping and exists only on this branch. `useResourceIndexing.ts` is served
at all (it does not exist on `origin/main`). Port 5935 is this branch.

### What I verified (with evidence)

**Gates, run from `frontend/` (not the worktree root):**
- `npm run lint` — clean, `--max-warnings=0`.
- `npm run typecheck` — clean.
- `npm test` (frontend jest) — **290 suites / 2930 tests passed**.
- Root `npm run check:tokens` (HEL-1037) — `every var(--*) reference ... resolves`.
- HEL-441 motion guard — `npx jest motionTokenGuard`: 5 passed.

**Mutation 1 — `Record<RecentKind, true>` exhaustiveness (scrutiny item 1).** Confirmed the shipped
code uses the `Record` form (`recentHistoryStore.ts:46`), not an array annotation. Added
`"connector"` to `ResourceKind` and ran `tsc --noEmit`: `TS2741: Property 'connector' is missing in
type '{ dashboard: true; source: true; pipeline: true; }' but required in type
'Record<RecentKind, true>'`, plus 7 further errors in `useRecentPaletteActions.ts` /
`useResourceSearchActions.ts`. **Failable. Reverted.**

**Mutation 2 — `useResourceNavigator`'s `const _exhaustive: never = ref;` (scrutiny item 2).**
Adding a kind to `ResourceKind` alone does *not* touch these switches (`ResourceRef` lists kinds
literally), so I mutated `ResourceRef`'s first arm instead. Result: `resourceNavigation.ts(38,44)
TS2366` (`hrefFor`'s value-returning switch) **and** `resourceNavigation.ts(90,15) TS2322: Type
'{ kind: ... | "connector"; id: string; }' is not assignable to type 'never'` — the explicit
assertion. I then additionally deleted the `_exhaustive` line while keeping the widened union:
`tsc` reported **only** the `hrefFor` error, and `useResourceNavigator` compiled clean with an
unhandled kind that silently does nothing. The assertion is genuinely load-bearing, not decorative.
**Reverted.**

**Scrutiny item 3 — no `?? ""` reintroducing a pipeline-less Output ref.** `grep -rn '?? ""'
features/commandPalette/ shared/chrome/` returns no hit in the palette (only pre-existing hits in
`MobileNavSheet.tsx`, `ErrorBoundary.tsx`, `SidebarItemList.tsx`, all unrelated). `SearchableItem`
(`resourceSearch.ts:22-23`) is a discriminated union with `pipelineId: string` **required** in the
output arm. Construction sites for `kind: "output"` are exactly two
(`useResourceSearchActions.ts:60` and `:133`), both supplying a real `o.pipelineId` from the slice;
`buildRef` is a straight narrowing switch with nothing to coalesce. The invalid state is
unrepresentable.

**Mutation 3 — pagination (scrutiny item 4).** `fetchAllOutputs` calls the pre-existing
`listAllOutputs()` (`outputService.ts:67-83`), which loops `offset` until `total`. I mutated the
loop to `break` after the first page (with an `assert` on the patch pattern — **"MUTATION LANDED"**
printed, so the probe did not silently no-op), then ran `outputsSlice.test.ts`: **2 failed** —
including the `>1-page` test asserting 250 items across 2 requests. **Failable. Reverted.**

**Scrutiny item 5 — the `/`-route e2e fixture, and the mutation.** `registerAndLoginWithDashboard`
(`e2e/hel503-...spec.ts:26-46`) POSTs `/api/dashboards` and asserts `201` before any search, so
`useOnboardingHost`'s zero-dashboard auto-activation never fires. Baseline: **5 passed (15.2s)**.
I then replaced the three non-dashboard `void dispatch(...)` calls in `useResourceIndexing.ts`'s
open-edge effect with no-ops (pattern-asserted, "MUTATION LANDED"): **3 failed** — the source/
pipeline test, the output test, and the source-navigation test. The primary acceptance path is
proved, not merely asserted. **Reverted; `git status` clean afterwards.**

**Scrutiny items 6 and 7.** `buildCoverageMessage` iterates `SEARCH_KINDS` reading live
`statuses[kind]`, with `failed` producing a separate "Could not be searched:" clause distinct from
"Still loading:"; returns `null` when all four `succeeded` (confirmed live — no caveat element
rendered with everything loaded, and the slow-network e2e sees `.command-palette__coverage`).
`searchResourceItems` sorts by rank first and `.slice(0, 5)` **after** (`resourceSearch.ts:60-66`),
with `overflowCount` from the remainder.

**Downstream (HEL-519 recents) — "no wire impact" is not "no downstream impact".**
`e2e/hel519-recent-navigation.spec.ts`: **8 passed**. `RecentKind = Exclude<ResourceKind,"output">`
keeps `{kind, id}` assignable to the widened `ResourceRef`, and typecheck agrees.

**Acceptance criteria traced:**
- Grouped/ranked across four kinds + navigation — live: dashboards, sources, pipelines and an
  output row all rendered for `test` on `/`, kind-ordered, with per-kind icons; the e2e proves an
  output lands on `/pipelines/:id?outputId=:id` with the sheet heading visible, a source on
  `/sources/:id`, and a dashboard selection without leaving `/`.
- Search works on `/` with no prior navigation — mutation-proved above.
- Keyboard-navigable, tokens + `.eyebrow` label, light/dark — verified live in both themes
  (screenshots below); `check:tokens` clean; `:focus-visible { outline: var(--app-focus-ring) }`
  present (HEL-1022).
- Debounced without blocking input — `useDebouncedValue(query, 150)` debounces matching only; the
  `TextField` stays bound to `query`.
- Names which kinds are covered while indexing — `buildCoverageMessage`, e2e-proved on a
  throttled `/api/data-sources`.
- Unit tests, lint/test clean, zero new warnings — above.

**Console:** 0 errors across the whole live session (login → `/` → palette open → search →
navigate).

**The shared-slice ride-along (`fetchDashboards.condition`) — my independent ruling: IN SCOPE, SAFE.**
I checked the ride-along on its own terms rather than accepting the evaluator's framing. The old
`status === "idle"` condition made a failed dashboards fetch permanently unretryable — a real
latent defect, not a hypothetical, and one this ticket's palette-open retry is the first caller to
hit. The delta is confined to the single `failed` state (`loading`/`succeeded` still blocked, both
pinned by new local tests in `dashboardsSlice.test.ts`). I enumerated dispatch sites myself:
`grep -rn "fetchDashboards()"` finds exactly two — `App.tsx:174` (mount-only) and
`useResourceIndexing.ts:77` (open-edge, `isOpen`-keyed only); `PatchSetReviewPage.tsx:230` calls
the *service*, not the thunk, and is unaffected. Neither dispatch site is render-driven, so the
widening cannot produce a retry loop. It is shape-identical to `pipelinesSlice`'s guard. I would
not escalate this: it is the minimum change that makes this ticket's own retry path work, it is
locally tested where it lives, and reverting it would leave a knowingly-broken retry.

**Two-axes question.**
*What does no source text carry:* whether the app indexes anything at all on `/` — an unindexed
search and an empty workspace are byte-identical in the DOM. Only the dispatch-removal mutation
against a real dashboard-owning account separates them, and I ran it (3 red / 5 green).
*What path the gates did not exercise:* the **overflow row** — every unit test and every e2e
assertion targets rows that match by name; nothing in the suite ever renders, focuses, or
activates a `+N more` row. That is precisely where the eighth defect was. See below.

### Verdict: REFUTE

One element — the per-kind overflow row (`useResourceSearchActions.ts:158-168`) — fails on both
axes the evaluator deferred to me. Everything else ships.

### Change Requests

1. **The overflow row is misaligned with every sibling row it sits between**
   (`useResourceSearchActions.ts:158-168`; screenshots
   `.concertino/runs/HEL-503/evidence/skeptic-light-search.png` and `skeptic-dark-search.png`).
   It is pushed with `matchesQuery: true` and no `icon`, so it renders without the
   `.command-palette__item-icon` slot every other row has. Measured live in the browser:
   sibling titles start at `x = 253`, the overflow row's text at `x = 223` — a **30px hang** into
   the icon gutter, mid-list, identically in light and dark. `builtInActions.ts` supplies an icon
   for **8 of 8** built-ins and recents/search rows all carry one, so this is the only iconless row
   in the entire palette — a one-off introduced by this ticket, not an inherited pattern.
   Required: give the row the same leading slot as its siblings (a muted `MoreHorizontal`-style
   icon, or an equivalent empty spacer of `var(--text-lg)` + `var(--space-3)`), so the text column
   is continuous down the group. Tokens only.

2. **The overflow row is a selectable option whose activation silently discards the search it
   tells you to refine** (same lines). It renders as `<button role="option">` and occupies a real
   index in the keyboard traversal (measured live: index 8 of 17 for query `test`), but its `run`
   is `() => {}`. I clicked it in the running app: **the palette closed, the URL did not change,
   and the query was gone.** A user arrowing down through source results lands on it and, pressing
   Enter, loses the query and the results — the exact opposite of "refine your search", and the
   same "a row that appears to work and goes nowhere" pattern this ticket's own scope section cites
   as the reason connectors were dropped to HEL-1041. No test in the change ever focuses or
   activates this row, which is why four green gates missed it.
   Required: make it non-interactive — render it as a plain non-`option` caption element inside
   the group (not a `<button>`, not `role="option"`, excluded from the `results` array that
   `activeIndex` traverses and from `aria-activedescendant`) — or, if it must stay actionable,
   give it a `run` that actually does something and leaves the palette open. A no-op `role="option"`
   is not an acceptable third choice. Add a test that asserts the `+N more` row is not keyboard-
   selectable (or that activating it does not close the palette), since nothing currently exercises
   this path.

### Non-blocking notes

- **The "clipped first group label" observation does not reproduce as clipping.** Measured:
  scroller top `232.5`, label rect top `232.5`, height `13`, `overflow: visible`, `scrollTop 0` —
  the label is fully rendered, merely flush against the scroll container's top edge with no
  padding. That CSS (`.command-palette__results` / `.command-palette__group-label`) is untouched by
  this diff and predates it (HEL-496), so it is neither a HEL-503 regression nor mine to block on.
  If the owner wants breathing room above the first label it belongs in its own palette-polish
  ticket, not here.
- All four kinds share the single `Search results` section, distinguished only by icon rather than
  per-kind `.eyebrow` labels. This was ruled at the design gate (D5) and survived three skeptic
  rounds; it reads fine live because the overflow rows name their kind ("+9 more **sources**
  match"). Recording it only because a reader of the AC ("grouped ... matches") might expect four
  labels.
- `AsyncStatus` was widened from module-private to exported in `outputsSlice.ts`. Fine, but it is
  now a published type on a slice that is not obviously its home; a shared `types` home would be
  tidier if a third consumer appears.
