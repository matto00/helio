## 1. Widen `ResourceRef` — the shape change everything else sits on

- [x] 1.0 **Rule on `ResourceKind` first — it is load-bearing** (design.md D1). `ResourceKind` GAINS
      `"output"`. **The fix is to RETYPE THE STORE, not to annotate an array** (round-2 CR1):
      `RecentEntry["kind"]` (`features/commandPalette/model/recentHistoryStore.ts:16`) and the `kind`
      parameters of `recordVisit`/`pruneMissing` (`:100`,`:104`) become `RecentKind`, where
      `type RecentKind = Exclude<ResourceKind, "output">`.
      Without that retype, widening `ResourceKind` widens `entry.kind` and BREAKS two call sites:
      `features/commandPalette/useRecentPaletteActions.ts:65` (`{ kind: entry.kind, id: entry.id }` no longer
      assignable — the Output arm requires `pipelineId`) and `:12`
      (`Record<RecentEntry["kind"], LucideIcon>` missing an `"output"` key). Note the path is
      `features/commandPalette/useRecentPaletteActions.ts`, NOT under `hooks/`.
      **Exhaustiveness must use a keyed map, NOT an array annotation** — `const VALID_KINDS: readonly
      RecentKind[]` CANNOT fail the build when a kind is added, because an array annotation does not require
      exhaustiveness. Use `const RECENT_KINDS: Record<RecentKind, true> = {...}` and derive `VALID_KINDS`
      from its keys; a `Record` IS checked for missing keys.
      Verify: add a dummy kind to `ResourceKind` and confirm the build BREAKS at `RECENT_KINDS`. RUN that
      mutation and confirm it landed — an array-annotated version would pass this vacuously, which is
      exactly why the construct is specified.
- [x] 1.1 In `frontend/src/shared/chrome/resourceNavigation.ts`, make `ResourceRef` a DISCRIMINATED UNION:
      `{ kind: "dashboard"|"source"|"pipeline"; id: string } | { kind: "output"; id: string; pipelineId: string }`.
      **NOT an optional `pipelineId?` on one flat record** — that compiles while letting a caller build an
      Output ref with no pipeline. The union makes the invalid state unrepresentable.
      Verify: `tsc --noEmit` clean, and a test constructing an output ref without `pipelineId` fails to
      compile (assert via a `@ts-expect-error` line, which itself errors if the code becomes legal).
- [x] 1.2 `hrefFor` returns `/pipelines/${pipelineId}?outputId=${id}` for outputs — **the convention HEL-909
      already established** (`usePipelineDetailPage.ts:574-594` reads the param, opens the sheet, strips it).
      Do NOT invent a second convention. Dashboards still return `null` (unchanged, deliberate).
      Verify: unit test per kind, plus a real-browser check that the URL opens the sheet directly.
- [x] 1.3 `useResourceNavigator` handles the output kind, with an **explicit `never` exhaustiveness
      assertion** in its final branch (`const _exhaustive: never = ref;`). This is REQUIRED, not stylistic:
      TypeScript enforces exhaustiveness automatically only for VALUE-returning switches (`hrefFor` gets
      TS2366). `useResourceNavigator` returns a `void` function that branches with `if (...) { return; }`,
      and a void function may legally fall off the end — so without the assertion an unhandled kind silently
      does NOTHING, i.e. a result row that appears to work and goes nowhere (round-1 D1 claimed TS would
      catch this; it does not — skeptic CR6).
      Verify: removing the output case fails typecheck. RUN that mutation and confirm it landed.
- [x] 1.4 Confirm HEL-519's recents still work unchanged against the widened union. Verify: its existing
      tests pass UNMODIFIED.

## 2. Index explicitly (owner ruling)

- [x] 2.1 **REUSE the existing paginating client `listAllOutputs()`**
      (`frontend/src/features/pipelines/services/outputService.ts:66`) — do NOT write a new single-page
      thunk. `GET /api/outputs` is PAGINATED (`Page.Default.limit = 200`, `MaxLimit = 500`,
      `pagination.scala:11-12`), so a single-page read SILENTLY TRUNCATES the index — the same defect class
      as not indexing at all. `listAllOutputs()` already loops until `total` is exhausted and its own
      docstring warns about exactly this; it already has a consumer (`useOutputPickerData.ts:66`).
      Store the result so search can read outputs across ALL pipelines (`byPipeline` is per-pipeline and is
      NOT sufficient). Verify: unit test over the reducer, plus a test that a >1-page response is fully
      indexed (mock `total` greater than one page and assert every item is present).
- [x] 2.2 On palette OPEN, ensure each of the four kinds is fetched — dispatching each kind's list thunk
      only if its slice has not already succeeded. **The guard reads each slice's own status**, NOT a thunk's
      `condition` option (`fetchPipelines` has one, not all kinds do — asserting against the wrong mechanism
      is how this test goes vacuous).
      **On `failed`, RETRY on the next palette open** (design.md D2): opening the palette is user-initiated,
      so one retry per explicit open is proportionate — no backoff loop, no background polling, no
      permanently dead kind after a transient error.
      Verify: (a) opening twice with all kinds `succeeded` dispatches nothing the second time; (b) opening
      twice with one kind `failed` DOES re-dispatch that one — the round-1 "at most once" assertion was true
      only on the happy path and proved nothing about failure.
- [x] 2.3 Do NOT index at app boot — that charges every session four requests for a feature many never use
      (design.md D2). Verify: no fetch is dispatched until the palette opens.

## 3. Search + results

- [x] 3.1 A search selector matching over the four indexed collections by name, ranked so closer matches
      lead. Verify: unit tests for ranking order across kinds.
- [x] 3.2 Contribute results as `CommandAction`s with `matchesQuery: true` (`ranking.ts:75-78`) so the
      contributor's own scoring is preserved rather than re-scored. Note this is the OPPOSITE case to
      HEL-519's recents, which deliberately do not use it. Verify by test.
- [x] 3.3 Add the search section to `SECTION_DISPLAY_ORDER` (`builtInActions.ts:28-36`). An unlisted section
      is not dropped — it sorts after every listed one — so omitting this would bury results below Create.
      Verify: a test asserting declared position.
- [x] 3.4 Results must not displace existing palette actions; both are presented. Verify by test.
- [x] 3.4a **Cap results per kind** (design.md D7) — a small fixed cap (5), applied AFTER ranking so the best
      matches survive, defined in ONE place. `rankActions` never truncates `matchesQuery` actions
      (`ranking.ts:73-78`), and the dev DB alone has ~85 Outputs, so an uncapped one-character query buries
      the palette's own actions under hundreds of rows and destroys keyboard usability. When a kind has more
      matches than the cap, state how many more exist rather than truncating silently. Verify by test.
- [x] 3.5 Debounce MATCHING (not rendering) so typing is never blocked, and ensure a stale in-flight match
      cannot overwrite a newer one. Verify: a test typing two queries in quick succession asserts the results
      correspond to the SECOND.

## 4. Coverage reporting — derived, never hardcoded

- [x] 4.1 While any kind is not yet indexed, show which kinds ARE being searched, **computed from each
      kind's live slice status at render time** — never a constant string or hardcoded array (design.md D4:
      a hardcoded list is a claim that decays, and is wrong in a way nothing detects).
      **`failed` and `loading` must read DIFFERENTLY**: a failed kind must NOT silently drop out of the
      covered list, or the user is told three kinds are searched and never that the fourth broke — making
      "no results" for that kind indistinguishable from broken again. `loading` = still completing;
      `failed` = that kind could not be searched. Verify both states by test.
- [x] 4.2 **Guard that fails if the message is hardcoded**: render with one kind's status forced to loading
      and assert that kind is ABSENT from the message. If the message is a constant, this test fails. RUN
      the mutation (hardcode the list) and watch it go red — and **verify the mutation actually landed**.
- [x] 4.3 Full coverage shows no caveat at all. Verify by test.
- [x] 4.4 A query matching nothing WHILE still indexing must NOT say "no results" — it must say the search is
      still in progress. Verify by test; this is a spec requirement, not a nicety.

## 5. Real-browser evidence — the `/` route first

- [x] 5.1 **THE PRIMARY ACCEPTANCE TEST: search works on `/` with NO prior navigation.** Open the app at `/`,
      navigate NOWHERE, search for a source and a pipeline that exist, and assert they are found.
      **A test that navigates anywhere before searching does not test this** — that is exactly how HEL-519's
      suite stayed green while the feature was broken on `/`.
      **THE FIXTURE MUST HAVE AT LEAST ONE DASHBOARD** (skeptic CR4 — this is the difference between a real
      test and a vacuous one). `useOnboardingHost.ts:83-91` dispatches `fetchSources()` AND
      `fetchPipelines()` whenever the onboarding checklist is visible, and it auto-activates when
      `dashboards.status === "succeeded" && items.length === 0` — **exactly the account a fresh
      `registerAndLogin` creates**. On a zero-dashboard account sources and pipelines are ALREADY loaded on
      `/`, so the mutation below would stay GREEN while proving nothing. State in-test how the dashboard,
      source, pipeline and output fixtures are created.
      **Break indexing deliberately (remove the palette-open fetch) and confirm this test goes RED**, then
      restore. Verify the mutation actually landed before judging the result — a probe whose pattern silently
      fails to match returns a meaningless green.
- [x] 5.2 Selecting an output result opens `/pipelines/:id?outputId=<id>` with the sheet PRESENTED, not just
      the pipeline. Verify in a real browser.
- [x] 5.3 Each of the four kinds opens correctly from a result. Real browser.
- [x] 5.4 Commit as `e2e/hel503-*.spec.ts`. Its own `registerAndLogin` MUST carry the post-mount precondition
      wait — `c317e244` fixed only 2 of the 8 duplicated copies, and omitting it reintroduces the race that
      took main red.
- [x] 5.5 **CONTENT SELF-AUTHENTICATION before any visual observation**: `curl` port 5935 for a string that
      exists ONLY on this branch. A port/URL check is not sufficient — Vite auto-increments when a port is
      taken so the collision is symmetric, and a URL check does not survive proxying or a stale tab.
- [x] 5.6 VISUAL COHESION (owner-mandated; a token check does NOT substitute). Screenshot the search results
      section beside the existing Recent/Navigation/General/Create sections, BOTH light and dark, at rest AND
      hovered AND focused (HEL-866). Screenshots to `.concertino/runs/HEL-503/evidence/` ONLY.

## 6. Gates and handoff

- [x] 6.1 Run lint, typecheck, `npm test`, format:check **from `frontend/`** — root `npm test` is
      `jest --passWithNoTests && npm --prefix frontend test`, which in a worktree root turns silence into a
      pass. State what you ran and what it scanned.
- [x] 6.2 Motion guard (`frontend/src/theme/motionTokenGuard.css.test.ts`) stays green — it FAILS THE BUILD
      on a literal duration. Use `var(--app-transition)`/`var(--transition-slow)`. Verify every `var(--*)`
      resolves against `theme.css` BY NAME (undefined custom properties fail open, invisible to every gate).
- [x] 6.3 For EACH guard, state in-file what it PROVES and what it CANNOT, and make it failable by mutation —
      **RUN the mutation, confirm it landed, and watch it go red.** If a check structurally cannot fail, say
      so and DO NOT add it.
- [x] 6.4 Answer the two-axes question in `files-modified.md`: what does no source text carry, and what path
      did the gates not exercise?
- [x] 6.5 (orchestrator) Re-verify **HEL-1038** and **HEL-1041** are still live and OPEN with matching titles before the PR.
      A deferral that has silently gone Done reads as handled.
- [x] 6.6 Re-check `origin/main` hasn't moved; if it has, rebase and RE-RUN the 5.6 visual comparison.
- [x] 6.7 Write `files-modified.md` (every path in FULL, bullet-prefixed — an abbreviated path fails the
      squash guard) and COMMIT. Staging without committing is an incomplete handoff.
