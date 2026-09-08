# HEL-503: Global search across dashboards / sources / pipelines / outputs

## Description

With the command-palette shell in place, typing should surface not just actions but the user's actual resources. This ticket adds resource search results to the palette that navigate to the matched resource. It is the last leaf of epic HEL-348.

## Premise corrections (Setup, CON-136 — verdict `material-drift`, owner-ruled `proceed-with-restated-scope`)

The ticket body carries a retarget preamble (2026-08-30) that already supersedes everything naming `DataTypes`, `/api/types`, `dataTypesSlice`, metrics, or `/registry`. **Beyond that, the enumeration was invalidated. All of the following are binding.**

1. **SCOPE IS FOUR KINDS: dashboard, source, pipeline, output.**
   - **`panel` is DROPPED (owner ruling) — HEL-1038 owns it** (verified still open at Setup). Not "hard": *requires infrastructure that does not exist.* `PanelDetailModal` is driven by **local `useState` inside `DesktopPanelGrid.tsx:86`** (`detailPanelId`), there is no `selectedPanelId` in `panelsSlice`, no route or query-param convention for panels, and **no global panel registry** (`PanelsState.items` is one dashboard's panels at a time). Finding a panel is easy; *going to* one is impossible without new plumbing. Do NOT absorb it.
   - **`connector` is DROPPED (owner ruling) — HEL-1041 owns it.** There is **no `/connectors/:id` route** (`AppRoutes.tsx:105` list, `:95` complete). A connector result could only land on the list page: a row that names a specific thing and then drops you somewhere general is a broken promise, and it is **indistinguishable from working** until the user notices. Building that route inside a search ticket would invent a surface nobody scoped.
   - **`type` / `metrics` / `/registry` are dead** (HEL-903/904). Stale text, not scope.
2. **HEL-910's blocker is STALE** — it shipped as `10b6ac8d` on 2026-09-02 and is an ancestor of this base. Clear it.
3. **Outputs are affordable, and the reason matters.** The per-pipeline slice (`outputsSlice.byPipeline`, `fetchOutputs(pipelineId)`) suggests N fetches — but **`GET /api/outputs` already exists** (`OutputRoutes.scala:105`, HEL-906): a paginated list of *every* Output the caller owns, in ONE request. The frontend has no thunk for it yet; this ticket adds one. **A frontend absence is not evidence of a backend absence** — check the API before concluding data is unreachable.
4. **The Output deep-link ALREADY EXISTS** — `/pipelines/:id?outputId=<id>` (HEL-909, `usePipelineDetailPage.ts:574-594` reads the param, opens the sheet, strips it). Adopt that convention; do not invent a second one.

## Owner-ruled design constraint: INDEX EXPLICITLY

**This is ruled in, not left to the design gate.** The ticket's own "search only loaded X and say so" is **not sufficient**, because the failure is invisible.

- **Every non-dashboard kind loads lazily and NONE are loaded on `/`.** Dashboards fetch at boot (`App.tsx:174`). Sources/pipelines only via `SidebarBody.tsx:53-66`, gated on pathname. Outputs only per-pipeline, inside `PipelineDetailPage`. So a client-side search over Redux state **returns nothing on the default route, indistinguishably from a search that never indexed** — the exact defect HEL-519 shipped and its final gate caught, and it bites harder here with four sources instead of three.
- **Prove it on `/`, the default landing route, BEFORE anything else.** That is where a lazily-loaded index is emptiest. **A test suite that routes through a loading page first will pass over this exactly as it did last time.**
- **If any kind is genuinely not indexable at first paint, the UI must say WHICH kinds are covered right now** — not a generic "results may be incomplete". A vague hedge is how a wrong answer ships with a disclaimer attached; a warning must name what it is warning about.

## Acceptance criteria

* Typing a resource name shows grouped, ranked matches across **dashboard / source / pipeline / output**; selecting one navigates correctly — an Output to `/pipelines/:id?outputId=<id>` with the sheet open.
* **Search works on `/` with no prior navigation.** This is the primary acceptance test, not a secondary one.
* Results are keyboard-navigable, use tokens + `.eyebrow` group labels, correct in light/dark.
* Search is debounced and does not block the input.
* While a kind is not yet indexed, the UI names which kinds are currently searched.
* Unit tests for the search/ranking selector; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* A backend **search** endpoint (client-side over indexed state; note `GET /api/outputs` is a *list* endpoint, not a search one).
* Quick-create (HEL-516), shortcuts help (HEL-510), recents (HEL-519) — all shipped.
* **Panels — HEL-1038.** **Connectors — HEL-1041.** Both verified live at Setup.

## The interface this ticket WIDENS (authored by HEL-519, which I delivered)

`frontend/src/shared/chrome/resourceNavigation.ts` currently exports `ResourceKind = "dashboard" | "source" | "pipeline"`, `ResourceRef { kind, id }`, `hrefFor(ref): string | null` (null for dashboards — a dashboard has no address, and `"/"` would send a middle-click to the wrong place), and `useResourceNavigator()`.

**An Output is NOT expressible as `{kind, id}`** — it needs a pipeline id AND an output id. Widening `ResourceRef` for it is a **shape change, not an addition**; this was recorded on HEL-503 in advance rather than discovered. `hrefFor` must yield a real path for outputs using the existing `?outputId=` convention, so a result row supports middle-click / open-in-new-tab.

## Evidence discipline (binding on executor, evaluator, skeptic)

1. **A green gate is not evidence until you check what it scans.** Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test` — in a worktree root jest finds zero tests and turns silence into a pass. **Run gates from `frontend/`.**
2. **Hand-built fixtures find nothing.** A seeded index proves ranking and **nothing** about whether the app indexes anything.
3. **jsdom proves nothing about focus, visibility, or computed style** (HEL-1005). Prove behavior in a real browser.
4. **A deferral is only real if it names a task that exists and a ticket that owns it.**
5. **"No wire impact" != "no downstream impact."**

**VERIFY THE MUTATION ACTUALLY LANDED.** A mutation probe whose pattern silently fails to match returns a meaningless green. **Vacuity has a level above the test** — this lane has produced six false-passing or unfailable assertions, one caught only because the patch itself was inspected.

**A frontend absence is not evidence of a backend absence** (see premise correction 3). Trace to the API before concluding data is unreachable.

**CONTENT SELF-AUTHENTICATION before any visual observation.** `curl` this branch's dev server (5935) for a string that exists ONLY on this branch. A port or URL check is not sufficient — Vite auto-increments when a port is taken, so the collision is symmetric, and a URL check does not survive proxying or a stale tab.

**Motion guard (HEL-441):** `frontend/src/theme/motionTokenGuard.css.test.ts` **fails the build** on a literal duration in `transition:`/`animation:` outside its allowlist. Use `var(--app-transition)` / `var(--transition-slow)`. Verify every `var(--*)` resolves against `theme.css` BY NAME — undefined custom properties fail open and are invisible to lint, types and jest.

**For every guard, state what it PROVES and what it CANNOT.** A guard must be failable by mutation; a check that structurally cannot fail must not be added — say so instead.

**Screenshots go to `.concertino/runs/HEL-503/evidence/` ONLY** — never `openspec/**`, never `git add -f`.

## Binding standards

`CONTRIBUTING.md`, `DESIGN.md` (frontend work), `.concertino/laws/`.
