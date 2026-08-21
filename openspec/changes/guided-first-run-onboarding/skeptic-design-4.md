## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold spawn at `82186dd7` (`HEL-774`). I read `skeptic-design-3.md` to learn what its three CRs
were, then re-derived every verdict from the artifacts and from source. Where I agree with a prior
round it is because I checked it myself; where I disagree I say so.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas,
`skeptic-design-3.md`, the shipped `openspec/specs/frontend-panel-empty-state/spec.md`, the current
`DESIGN.md` (373 lines, last touched by `82186dd7`), and `openspec/config.yaml`.

**Source read as ground truth:** `PanelList.tsx`, `PanelList.css`, `app/App.tsx`, `main.tsx`,
`AppRoutes.tsx`, `ProtectedRoute.tsx`, `CommandBar.tsx`, `UserMenu.tsx`, `UserMenu.css`,
`UserMenu.test.tsx`, `authSlice.ts`, `sourcesSlice.ts`, `pipelinesSlice.ts`, `dashboardsSlice.ts`,
`panelsSlice.ts`, `panelThunks.ts`, `SourcesPage.tsx`, `TypeRegistryPage.tsx`, `dataTypeService.ts`,
`sections.ts`, `store/store.ts`, `test/renderWithStore.tsx`, `InlineError.tsx`, `StatusMessage.tsx`,
and all four HEL-548 hooks **plus their tests**.

`openspec validate guided-first-run-onboarding --strict` → `Change 'guided-first-run-onboarding' is
valid`. No `TODO`/`TBD`/deferred-decision placeholder anywhere in the four artifacts.

**Every citation re-checked. All exact:**

| Citation | Verdict |
| --- | --- |
| `PanelList.tsx:400` = `{!(showPanelGridSkeleton \|\| showBootstrapSkeleton) ? (` | TRUE (line-exact) |
| `PanelList.tsx:190-192` "harmless, since the flag starts `false`"; `:193-197` the cleanup | TRUE, verbatim |
| `PanelList.css:48-62` = the Primary recipe; header `.panel-list__add` mounted unconditionally inside `<section className="panel-list">` (no branch above it) | TRUE |
| `PanelList.tsx:437-441` CTA-less "Select a dashboard" inside the line-400 gate | TRUE |
| `PanelList.tsx:456-457` — "No panels yet" uses `LayoutGrid` (D8's step-4 glyph) | TRUE |
| `dashboardsSlice.ts:281-283` `createDashboard.fulfilled` auto-selects; `:254-256` empty payload leaves `selectedDashboardId` null | TRUE |
| `SourcesPage.tsx` F-072 `status === "idle"` guard pattern | TRUE (effect at `:28-42`, guard `:35-37`) |
| `main.tsx:57` `<React.StrictMode>`; `App.tsx:39-45`/`:67-73` try/catch'd `helio.sidebarCollapsed` | TRUE |
| `App.tsx` dispatches only `fetchDashboards`/`fetchPanels` | TRUE (`:118-129`; design says `:119-128`, a 1-line rounding, not drift) |
| `CommandBar.tsx:160` = `onClick={onOpenMobileNavSheet}` (HEL-773's fence); `:254` = `<UserMenu`, gated on `authStatus === "authenticated" && currentUser !== null` | TRUE |
| `UserMenu.css:138-140` `.user-menu__item { min-height: 44px }` at `≤768` | TRUE |
| `UserMenu.test.tsx` uses a bare `render()` with no Provider/Router → task 4.6 genuinely required | TRUE |
| `renderWithStore.tsx:159-171` = the reducer map, eleven reducers, no `onboarding` | TRUE (line-exact) |
| `theme.ts:3-4` hyphen key family (`helio-theme` / `helio-accent`) | TRUE |
| `DESIGN.md:224-225` "Where Fraunces goes … main empty-state titles" | TRUE (the only line-cite in the artifacts, and it is exact) |
| §3 Control metrics: 44px floor at 430/768 + HEL-774's `::after` hit-expander clause | TRUE, `DESIGN.md:193-211` |
| §3 Motion: `--transition-slow` 0.28s entrances, "animate in once (fade + 4–10px rise)", "one entrance per surface" | TRUE, `:236-246` |
| §5 "One primary per view/section" (`:264`), Ghost one of the four (`:267`), IconButton's **required** `aria-label` (`:292-293`, inside §5) | TRUE |
| §6 "**StatusChip** (intent-colored status pill — the one pill recipe)" (`:320-321`) and "Use these; do not hand-roll equivalents" (`:333`) | TRUE |
| §7 "never a flash of empty content" / "never swallow a failed fetch" (`:356-360`) | TRUE |
| §8 focus ring `2px solid var(--app-accent)`, offset `2px`, `-2px` where it clips (`:367-369`) | TRUE |

No fabricated section, rule or exception. Every `§` reference in `design.md`/`tasks.md` (§3 ×4, §5
×5, §6 ×2, §7 ×4, §8 ×1) resolves to text I read in the current file.

**New ground truth this round establishes (not checked by rounds 1–3):**

- **The Type Registry genuinely has no create path** — the load-bearing copy claim is TRUE, not
  assumed. `dataTypeService.ts` exports only `fetchDataTypes`/`updateDataType`/`validateExpression`/
  `fetchDataTypeRows`/`deleteDataType`/`fetchAssertionStatus`; `TypeRegistryPage.tsx`'s only `cta`
  is a Retry on its error state. D8's "you never create one directly" is a true statement about the app.
- **`fetchPipelines` carries a `condition` guard** (`pipelinesSlice.ts:177-180`) that rounds 1–3
  never looked at. It is `status !== "loading" && status !== "succeeded"` — its own comment says it
  "still allow[s] a retry from `failed`, unlike a bare `status === "idle"` check, which would
  permanently block retries after one failure." `fetchSources` has no `condition` at all. This is
  what makes CR2's Retry actually work; see below.
- **Step completion is reachable without a reload for all four resources**:
  `createStaticSource`/`createSqlSource.fulfilled` append to `sources.items`;
  `createPipeline.fulfilled` pushes to `pipelines.items` (F-104 note); `createDashboard.fulfilled`
  pushes + auto-selects; `createPanel` itself dispatches `fetchPanels(dashboardId)` before it
  resolves. The delta's "shown as complete without the user reloading the page" is satisfiable.
- **`PanelList` already holds its own `useCreateDashboardAction()`/`useCreatePanelAction()`
  instances** (`:45-46`), and `useCreateDashboardAction` holds `error`/`isPending` in **local
  `useState`** — so a second call site gets a second, independent error. Consequence recorded in the
  notes.
- **`PanelList` mounts only when `auth.status === "authenticated"`** (`ProtectedRoute.tsx:10-25`),
  and every authenticated transition in `authSlice` sets `currentUser` alongside the status — so
  D7's "`currentUser.id`, non-null under `ProtectedRoute`" holds.

---

### Round-3 CR checklist — per CR

| # | Round-3 CR | Status |
| --- | --- | --- |
| 1 | Dismissal lost on re-open (split owner) | **Genuinely closed** (one residual execution finding, note 1) |
| 2 | Failed collections rendered as incomplete | **Genuinely closed** |
| 3 | Completed state undefined / D2 ↔ task 1.12 contradiction | **Genuinely closed** |

**CR1 — genuinely closed. I traced the exact failing path round 3 gave and it now persists.**
`dismissed` lives in the slice next to `active` (task 1.2), is written by exactly one effect watching
the slice value (task 1.4), and `UserMenu` **dispatches** and "must NEVER write `localStorage`
itself" (task 4.4, D7 ¶2, and the delta's own "the re-open affordance SHALL request the change rather
than writing storage itself"). Trace: dismiss → `dismissed: false→true`, the one effect writes the
key. Re-open from `UserMenu` **while on `/`** → dispatch sets `dismissed: false`, `active: true`;
`PanelList` does not remount, but it is a Redux subscriber, so the same effect re-runs on the new
value. Dismiss again → `dismissed: true` → **the same** effect writes. Reload → key present → no
auto-activation. The React bail-out that swallowed the second dismissal is structurally gone, because
there is no second holder to fall out of sync. Test 6.5 asserts exactly this sequence and requires it
proven red against a `useState`-owned variant first.

I also traced the **re-open from a route other than `/`** (the case round 3 did not): the dispatch
lands while `PanelList` is unmounted, so the storage write is deferred to the mount that follows
`navigate("/")`. I enumerated the three possible orderings of the hydrate effect and the persist
effect on that mount, and **all three converge on a correct user-visible outcome**, because `active`
is already `true` and `visible = active || autoActivate` does not consult `dismissed`.

**On the hydration story specifically (the brief's question): the plan is correct for the ordinary
load and has one under-specified window.** On a direct load of `/`, React runs effects child-first,
so `PanelList`'s hydrate effect dispatches **before** `AppShell`'s `fetchDashboards` is even
dispatched (the fetch lives in `AppShell`, `App.tsx:118-120`, which is `PanelList`'s parent route
element) — `dismissed` is therefore hydrated long before `dashboards.status` can become `succeeded`,
and there is no window at all. The window exists only on the *mount-later* path (land on `/sources`,
then navigate to `/` with dashboards already resolved-empty), where the first render evaluates
`autoActivate` against the slice's pre-hydration default. That is a real defect, but it needs no new
decision — the spec already binds the outcome ("A stored dismissal suppresses automatic
activation") — so it is **note 1**, not a change request.

**CR2 — genuinely closed, and I verified the retry against the real thunks rather than the prose.**
The three artifacts now say the same thing: task 1.10 (`indeterminate` for `"idle"`/`"loading"`,
`failed` for `"failed"`, "must NEVER fall through to `incomplete`"), D10 (four named states, with
both rejected alternatives and *why* each was rejected), and the delta — whose indeterminate
requirement was narrowed from the old "**until** … has completed a fetch" to "unstarted or in
flight", which is what removed the contradiction, plus a separate `failed` paragraph and two
scenarios. Task 2.7 renders it, task 5.6 verifies it on the running app, test 6.6 covers it.

**The retry genuinely re-dispatches.** The `status === "idle"` guard lives inside the host hook's own
effect (task 1.9) and is not a barrier to a user-initiated dispatch. `fetchSources` has no
`condition`. `fetchPipelines`'s `condition` is `status !== "loading" && status !== "succeeded"` —
`failed` passes it, and the comment above it says so in as many words. Nor can the hook loop: after a
rejection the status is `"failed"`, not `"idle"`, so the effect stays quiet until the user asks.

**CR3 — genuinely closed, all three sub-parts.** (a) The contradiction is gone: D2 now reads
"**`active` is cleared only by explicit dismissal.** Reaching all-four-complete writes `dismissed` …
but leaves `active` set", task 1.12 says the same, and task 1.3 adds "neither must reaching
all-four-complete" so an implementer cannot reintroduce it. (b) The re-open affordance can never be
inert: `visible = active || autoActivate` consults content nowhere, and task 4.1 mounts the surface
**outside** the line-400 gate, so it renders above a populated grid — which is what makes the delta's
"An affordance that mutates stored state but presents nothing SHALL NOT be shipped" satisfiable
rather than aspirational. (c) The copy exists, verbatim, and the re-opener/just-finished split was
answered rather than dodged: one surface serves both (D8 ¶2, task 2.4 "do NOT build a separate
completion screen"), with a spec scenario for each.

---

### Nothing that rounds 1–3 closed has regressed

I re-derived rather than re-read: the line-400 placement (`PanelList.tsx:400` is still the gate, and
a conditional sibling rendered *before* `.panel-list__zoom-container` occupies its own stable child
slot, so `useContainerWidth`'s one-time `ResizeObserver` target is not re-identified — the
`1280 → 1152 → 0` hazard documented at `:355-375` is not re-entered); the no-hero-flash frame trace;
navigate-only step 1 plus the `SourcesPage` cleanup; the Ghost assignment; `renderWithStore`. I
diffed the `frontend-panel-empty-state` delta against the **shipped** file: both MODIFIED
requirements carry their shipped prose verbatim, all five shipped scenarios of the first requirement
survive (two gaining "AND no guided first-run surface is active"), both shipped scenarios of the
third survive, and the untouched "Empty state CTA opens the panel create form" requirement is
correctly absent from the delta.

All five of round 3's non-blocking notes were absorbed, which is the behaviour I want to see: the
redundant `visible || autoActivate` is now plain `visible` (task 1.9); the "Type" marker is now
explicitly inline and explicitly **not** a pill (task 2.6, §6); the `PanelList.test.tsx` fixture
hazard is in Risks and task 6.10; "Select a dashboard" is explicitly excluded from suppression (D5,
task 4.2); the Primary-vs-Secondary switch is pinned to task 4.2's value (task 2.13).

---

### Design judgement — formed before re-reading rounds 1–3's view

**The copy ships.** It is ~60 words for the whole surface and every one of them is about *this*
product. "Shape that source into a type. Types are only ever a pipeline's output — you never create
one directly." is the sentence the ticket demands, it is one sentence, and — I checked — it is
**true of the code**, not a plausible-sounding claim. "Bind a panel to that type" borrows the app's
own verb (`updatePanelBinding`) and `SourcesPage`'s own vocabulary, so it teaches a word the user
meets again ten minutes later. The lede's "each one feeds the next" earns the four-steps/five-concepts
asymmetry, and D8's instruction not to "fix" it into five steps is right.

**The completion copy, judged to the same bar and independently: it clears it.** "That's the whole
chain" is a callback the lede has already set up, and the ticked four-step chain sits directly under
it, so even a re-opener who never saw the lede this session has the referent on screen. "Source,
pipeline, type, panel — every dashboard you build follows it." names all four resources in order —
including the one with no create path — in thirteen words, and it is a *restatement of the model*
rather than congratulation. There is no "You're all set", no exclamation mark, no emoji, no "🎉".
The decision that a re-opener sees the same ticked chain rather than a celebration is the right one:
a celebration for someone who just clicked "Getting started" would be nonsense.

It does not read as patronising, cluttered, or as a generic product tour. My only copy reservations
are notes 5 and 6 below, neither of which is worth a round.

---

### Verdict: CONFIRM

All three of round 3's change requests are genuinely closed — verified by tracing, not by reading
the rewrite. Nothing rounds 1–3 closed has regressed, `openspec validate --strict` passes, there are
no placeholders, and every DESIGN.md citation resolves against the file as HEL-774 left it today.
The plan is executable as written.

I found nine further things. **None of them requires a decision the plan does not contain** — each
is either resolvable inside the plan's stated intent by an executor, or a preference. Per this
round's budget instruction they are recorded below as execution findings rather than as change
requests, and I have said for each what would go wrong if it is ignored so none of them is lost.

---

### Non-blocking notes

**Execution findings — an executor would hit these; each is fixable without a new decision.**

1. **The pre-hydration window (the one most likely to actually ship broken — read this one).**
   `dismissed` starts at the slice's default and is hydrated by an effect, while `autoActivate`
   (D2, task 1.7) reads `!dismissed`. On a direct load of `/` this is safe — `PanelList`'s effects
   run before `AppShell` even dispatches `fetchDashboards`, so hydration always wins the race. It is
   **not** safe on the mount-later path: land on `/sources` (deep link, refresh, or just navigating
   there first), then go to `/`. `dashboards` is already `succeeded` + empty, so `PanelList`'s
   **first** render computes `autoActivate === true` off an un-hydrated `dismissed`, the surface
   paints, and task 1.8's effect sets `active` — which is sticky, so hydrating `dismissed: true` one
   tick later no longer suppresses anything. A user who dismissed sees it again, for the whole
   session. Fix inside the plan's shape: make the pre-hydration value distinguishable from a known
   `false` (e.g. `dismissed: boolean | null`, with `autoActivate` requiring `dismissed === false`),
   or gate the set-`active` effect on hydration having run for the current user id.
   **Make the guard able to fail:** task 6.1's "a stored dismissal suppresses it" and task 6.10's
   "preloading a stored dismissal" must mean **`localStorage`** with `dashboards` preloaded as
   `succeeded` + empty. Preloading `onboarding.dismissed = true` into the slice instead satisfies
   both task texts, passes, and proves nothing — exactly the "test that cannot fail" the ticket's
   verification standard names.

2. **Two `useCreateDashboardAction()` instances will not see each other's error.** `PanelList`
   already calls it at `:45`, and the hook holds `error`/`isPending` in **local `useState`**
   (`useCreateDashboardAction.tsx:31-32`) — so if the checklist invokes its own instance's
   `cta.onClick` but renders `PanelList`'s `createDashboardAction.error` (or the reverse), a failed
   create reports **nowhere**, silently failing task 2.16 and the delta's "A superseding guided
   surface reports a failed create too". Use one instance for both the click and the error. The other
   three hooks are pure flag-flips (`error: null, isPending: false` by construction) and are immune.

3. **Task 2.7's failed-step affordance should reuse a shared primitive, and §6 requires it.** §6
   lists `InlineError` and `StatusMessage` and says "Use these; do not hand-roll equivalents" — this
   is the same class of §6 trap round 3 caught with the "Type" pill. `InlineError`
   (`variant="banner"`, `kind="error"`, `onRetry`, `retrying`) and `StatusMessage`
   (`status="failed"`, `onRetry`, `retrying`) each already render an `role="alert"` box with a Retry
   that disables itself and swaps to "Retrying…" while in flight. That in-flight handling matters
   beyond consistency: `fetchSources` has **no** `condition` guard, so a hand-rolled retry button
   that stays enabled will fire duplicate `GET /api/data-sources` requests on a double-click.

4. **`sections.ts` exports no icon bindings**, so task 2.5's "imported from `shared/chrome/
   sections.ts`" cannot be taken literally — the file exports `sections`, `sectionForPathname`,
   `pickerIdForPathname`, `sectionLabel`, `isNavSection`. Derive via `sectionForPathname("/sources")`
   etc. (which is what the delta's "taken from the shared section registry" actually asks for).
   `SectionEntry` is a discriminated union whose `icon` is absent on `showInNav: false` entries, so
   narrow with the provided `isNavSection` guard rather than a non-null assertion.

5. **The step buttons' labels are the one piece of copy D8 does not specify.** Three steps can
   inherit their hook's own `cta.label` — "New pipeline", "New dashboard", "Add panel" (and
   `useCreateDashboardAction` swaps its own label to "Creating…" while pending, which the checklist
   gets for free). Step 1 has no hook by design, so its label is invented at execution time on a
   surface whose copy is the deliverable: it must not promise a modal it does not open. "Go to Data
   Sources" is honest; "Add source" would be a small lie, since the click navigates and the user must
   then press the page's own CTA.

6. **Copy nit, step 1.** "Connect a data source" over "A CSV, a database, or an API." — a CSV is
   uploaded, not connected, and the control the user lands on says "Add source". "Add a data source"
   would be true of all three inputs and would match the app's own word. Not worth a round; D8 is
   otherwise strong enough that I would rather it shipped intact than be re-opened.

7. **Stale cross-reference.** Task 3.4 reads "safe only because 3.4 leaves the flag `false` at
   mount" — self-referential. It means **3.3** (renumbering drift from round 3, where the
   navigate-only task was 3.4).

8. **Neither placement's *layout* is decided, only its button recipe.** D6/task 2.12 vary
   Primary↔Secondary by placement, but nothing says whether the card compacts when it sits above a
   populated grid (the re-open and just-finished cases) rather than alone in an empty region. A hero
   sized for the empty region will push a real dashboard's first panel row below the fold. Keep it
   compact enough that a row of panels stays visible at a ~900px viewport, and do not vertically
   centre it in the second placement.

9. **`active` leaks across a same-browser user switch.** `logout` clears only the auth slice
   (`clearAuth`; there is no root reset in `store/store.ts`), so a second user signing in without a
   reload inherits the first user's `active`. `dismissed` is protected by the per-user-id hydration;
   `active` is not. One `clearAuth` case in `onboardingSlice` closes it.

**Preferences, not findings.**

- **`design.md` at 164 lines against `openspec/config.yaml:48`'s "Maximum 150 lines" — not worth
  fixing, and I would rather it were not.** The rule is real, but it is soft guidance every sibling
  in this epic exceeded by more: the four HEL-349 leaves this ticket builds on archived at 181, 410,
  356 and 288 lines (`anchor-mobile-command-bar`, `empty-state-ctas-primary-sections`,
  `liquid-glass-bottom-nav`, `skeleton-loaders-list-detail-panel`), and proposals routinely run past
  the 300-word rule too (571, 693 words; this one is 702). Fourteen lines over. The only material
  cuts available are D2–D4/D7/D10's rejected-alternative rationale and the "three design-gate rounds
  refuted earlier drafts" paragraph — which is precisely the material the file says "must not be
  simplified back", and which stopped three separate defects from being reintroduced this run.
  Trading it for a line count would be a bad trade. Prose is wrapped well inside the 120-char half of
  the same rule (longest line 109).
- Task 5.9 says "§3 warns the global rule alone is not sufficient". §3 says that specifically of a
  **looping** animation (`Skeleton`'s shimmer, `DESIGN.md:242-244`); the entrance here is one-shot,
  so the global rule may well cover it. Run the check anyway — it is cheap — but do not record a §3
  violation if the global rule turns out to suffice.
- Step 3's `LayoutDashboard` and step 4's `LayoutGrid` are adjacent and read similarly at small
  sizes. Both are correct (nav registry / the panel empty state's own glyph), so keep them — but
  glance at the two steps side by side at 430px and confirm they do not read as a duplicate.
- "A canvas for your panels." (step 3) is the weakest line on the surface, close to tautological.
  It is four words and it does define the noun, so I would leave it.
- HEL-774's recorded mitigation remains only partly discharged: Metrics and Assistant, two of the six
  glyphs it unlabelled, are deliberately out of scope (D8 / Non-Goals). Correct for this ticket,
  honestly stated, and probably a spinoff.
