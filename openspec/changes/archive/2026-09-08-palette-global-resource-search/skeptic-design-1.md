## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Base: `git log -1` → `0826b4ae HEL-519 Add recent navigation to the command palette (#600)`.
`git diff --stat main...HEAD` → **empty**. No implementation exists yet, so no branch-only
string can be curled and no visual observation is possible or required at this gate. Dev 5935
returns `200` and backend 8842 `/health` returns `200`, but I explicitly did **not** treat that
as content self-authentication — there is nothing branch-specific to authenticate. Task 5.5
correctly carries that obligation into execution.

Claims checked against the tree (all confirmed unless noted):

- `App.tsx:174` → `void dispatch(fetchDashboards());` in `frontend/src/app/App.tsx`. **TRUE.**
- `SidebarBody.tsx:53-66` → the pathname-gated `fetchSources`/`fetchPipelines` effect is at
  lines 53–66. **TRUE.**
- `?outputId=` deep-link → `usePipelineDetailPage.ts:574-594` reads the param, sets the sheet,
  strips it with `{replace:true}`. **TRUE, and it is a real pre-existing convention** (its own
  comment: "no pre-existing OutputEditorSheet deep-link convention exists to follow — this is
  the new one", HEL-909). Decision 1(c) is not invented.
- `GET /api/outputs` → `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala`,
  `listRoutes`, `outputService.listAll(user, page)`. **EXISTS.** Note the design cites
  `OutputRoutes.scala:105` without the (different) real path; harmless.
- `ranking.ts:75-78` → `if (action.matchesQuery) { matched.push({action, tier: undefined, index}) }`
  and opted-out actions sort after scored ones in registrant order. **Decision 5 is accurate**,
  and cross-section order is governed by `SECTION_DISPLAY_ORDER` via `groupBySection`
  (`CommandPalette.tsx:24-54`), so section placement is unaffected by the tier sort.
- `SECTION_DISPLAY_ORDER` at `builtInActions.ts:28-36` with the documented
  unlisted-section-sorts-last fallback. **TRUE**; task 3.3's rationale is correct.
- Palette-open signal exists: `useCommandPalette()` exposes `isOpen` (`hooks.ts`). **Decision 2
  is implementable.**
- `strict: true` in `frontend/tsconfig.json` → TS2366 makes `hrefFor`'s value-returning switch
  genuinely exhaustive. (But see CR6 for the navigator.)
- HEL-910's blocker: `git merge-base --is-ancestor 10b6ac8d HEAD` → **ancestor confirmed**
  (`10b6ac8d`, Wed Sep 2 2026). Stale, correctly cleared.
- HEL-1038 — live, **Backlog/open**, titled "Panel visits in command-palette recents (requires
  selected-panel state + a panel registry)". HEL-1041 — live, **Backlog/open**, titled
  "Connector detail route + connector results in global search". Both deferrals are real per
  evidence rule 4.

**Judgment on Decision 1 (the union shape), which I was asked to scrutinize hardest:** the shape
is **right**. (a) An Output genuinely cannot be `{kind,id}` — `usePipelineDetailPage` resolves it
only within a pipeline route, and `Output` carries `pipelineId`. (b) A union beats an optional
`pipelineId?`: the optional form permits `{kind:"output", id}` with no pipeline, which is exactly
the state `hrefFor` cannot serve. (c) Verified real, above. (d) See CR6 — achievable for
`hrefFor`, **not automatic** for the void-returning navigator. **For a future kind:** HEL-1041's
connector slots into the first arm as `{kind:"connector"; id}` with `hrefFor` returning
`/connectors/:id` once that route exists — the shape scales. I am not refuting Decision 1's shape.

**Two-axes question.** *What does no source text carry:* whether the app actually indexes
anything on `/` — an unindexed search and an empty workspace are byte-identical in the DOM, so
only a running `/`-route probe against known-existing data distinguishes them. *What path the
gates would not exercise:* the failed-fetch path (CR3) and the >200-outputs path (CR1); neither
is reachable from any test the tasks currently name.

### Verdict: REFUTE

Six required revisions. Four are factual corrections to premises the executor would otherwise
build on; CR4 is the one that would have shipped the ticket's own headline defect a second time.

### Change Requests

1. **`GET /api/outputs` does NOT return "every Output ... in ONE request", and the frontend
   already has a paginating client for it.** `Page.Default.limit = 200`, `Page.MaxLimit = 500`
   (`backend/src/main/scala/com/helio/domain/model/pagination.scala:11-12`), and the route clamps
   to those while returning `total`. Design D3 ("returns *every* Output the caller owns,
   paginated, in ONE request") and task 2.1 assert a contradiction — *paginated* means the index
   may be silently truncated, which is the same defect class as an unindexed one and is exactly
   what this ticket exists to prevent. Worse, **the premise "the frontend simply has no thunk for
   it yet" is stale**: `listAllOutputs()` already exists at
   `frontend/src/features/pipelines/services/outputService.ts:66`, already loops until `total` is
   exhausted, and already has a consumer (`frontend/src/features/panels/hooks/useOutputPickerData.ts:66`).
   Its own docstring warns: "a caller with more Outputs than one page would silently see a
   truncated list — loop until `total` is exhausted rather than assuming one page suffices."
   Revise D3 and task 2.1 to (a) drop the "ONE request" claim, (b) **reuse `listAllOutputs()`**
   rather than writing a second, single-page client for the same endpoint, and (c) state the
   truncation semantics the index guarantees.

2. **The fate of `ResourceKind` is unspecified, and it is load-bearing.** Decision 1's snippet
   defines `ResourceRef` without saying what happens to `ResourceKind`, which is imported and
   used by `frontend/src/features/commandPalette/model/recentHistoryStore.ts:16,27,100,104` —
   including `const VALID_KINDS: readonly ResourceKind[] = ["dashboard","source","pipeline"]` —
   and by `useRecentPaletteActions.ts:65` (`const ref: ResourceRef = { kind: entry.kind, id: entry.id }`).
   Two internally-consistent answers exist and the design picks neither:
   if `ResourceKind` gains `"output"`, line 65 must stop compiling and `VALID_KINDS` silently
   under-covers (a hardcoded list that decays — the exact defect D4 condemns, one file away);
   if it does not, there are now two kind vocabularies that need distinct names. Note HEL-1041's
   own scope text assumes the widening reading ("widen `ResourceKind` in `resourceNavigation.ts`").
   Rule it explicitly in design.md and name the consequence for `recentHistoryStore`. Task 1.4's
   "recents' existing tests pass UNMODIFIED" is an assertion about the outcome, not the decision.

3. **The failed-fetch path is unaddressed in D2, D4 and both specs — and task 2.2's verification
   contradicts it.** D2's guard is "dispatch if not already *succeeded*", so a **failed** fetch
   re-dispatches on every palette open, forever, with no backoff and no error surfaced. Task 2.2
   then verifies "opening twice dispatches each fetch at most once", which is only true on the
   happy path and would pass while proving nothing about failure. Separately, D4 says a kind whose
   fetch fails "automatically drops out of" the coverage message — so the user is told three kinds
   are searched, is never told the fourth *failed*, and "no results" for that kind is again
   indistinguishable from broken. No scenario in `specs/resource-search-index/spec.md` covers
   `failed` (it only covers "still being fetched"). Specify: the guard's behaviour on `failed`
   (retry-per-open is defensible — say so), and what the coverage statement says for `failed`
   versus `loading`. Also state whether the guard relies on the thunks' own `condition` dedup
   (`fetchPipelines` already has one — see `useOutputPickerData.ts:55-62`) or adds its own;
   asserting "at most once" against the wrong mechanism is how that test goes vacuous.

4. **Task 5.1's mutation-to-red is vacuity-prone on exactly the account an e2e creates — this is
   HEL-519's failure repeated one level up.** `frontend/src/features/onboarding/hooks/useOnboardingHost.ts:83-91`
   dispatches `fetchSources()` **and** `fetchPipelines()` whenever the onboarding checklist is
   visible, and `autoActivate` (line 64) is `dashboards.status === "succeeded" && dashboards.items.length === 0`.
   The checklist is rendered by `PanelList` — i.e. **on `/`**. So for a brand-new account with zero
   dashboards, sources and pipelines **are** loaded on `/` without any palette-open fetch, and the
   prescribed mutation ("remove the palette-open fetch and confirm the test goes RED") would stay
   **GREEN** while proving nothing. Revise task 5.1 to require the fixture to have **at least one
   dashboard** (so the checklist is not visible), and to state how the source, pipeline and output
   fixtures are created for the test. Also correct design.md's "On `/`, three of four kinds are
   empty" — that holds only when a dashboard exists.

5. **No result cap is specified anywhere.** Neither design, tasks nor
   `specs/palette-resource-search/spec.md` bounds how many results a kind may contribute, and
   `rankActions` never truncates `matchesQuery` actions (`ranking.ts:73-78` keeps every opted-out
   action). The dev DB is documented at ~85 Outputs alone (`useOutputPickerData.ts` comment), so a
   one- or two-character query floods the palette with hundreds of rows stacked below
   Recent/Navigation/General/Create. Decide and record a per-kind cap (and whether an
   "N more" affordance is shown), or state explicitly why unbounded is correct.

6. **D1's exhaustiveness claim is false for `useResourceNavigator`, so task 1.3's verification is
   not automatic.** D1 asserts "TypeScript forces every `switch` over `kind` to handle Output
   explicitly". That holds for `hrefFor` (value-returning switch, TS2366 under `strict: true`).
   It does **not** hold for `useResourceNavigator`, whose returned function is `void`-returning and
   branches with `if (ref.kind === "dashboard") { ... return; }` — no switch, and a void function
   falling off the end is legal. Task 1.3's "removing the output case fails typecheck" therefore
   requires an explicit `never` exhaustiveness assertion; without one the guard structurally
   cannot fail. State the mechanism in D1 and in task 1.3.

### Non-blocking notes

- **Decision 4's guard is non-vacuous** — forcing one kind to `loading` and asserting its absence
  genuinely reddens a constant message. It does *not* catch a hardcoded array that is then
  filtered by status, which still writes the kind set down twice; worth a sentence in 4.2.
- Section grouping and `.eyebrow` labels come for free from `CommandPalette.tsx:204-206` /
  `CommandPalette.css:40`, so the AC's "`.eyebrow` group labels" is satisfied by reusing the
  existing renderer — cohesion here is inherited, not reinvented. The genuinely **new** UI is the
  coverage caveat, which has no precedent in `CommandPalette.css`; tasks name only its content
  (4.1) and a screenshot (5.6), never its placement. Worth one line so 5.6 has something to judge.
- Result rows carry icon/title/subtitle in the existing markup; the tasks never say what an
  output's subtitle is. Its pipeline name is the obvious answer and is the disambiguator when two
  pipelines have similarly-named outputs.
- Decision 5's contrast with HEL-519's recents (registered + `matchesQuery` vs synthesized in the
  empty-query branch) is accurate and is a genuinely useful thing to have written down.
