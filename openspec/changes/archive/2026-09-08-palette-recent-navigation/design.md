## Context

See proposal.md — Why, and ticket.md's "Premise corrections" for the full stale-claim list. Three facts
drive every decision below: there is no recents infrastructure at all; the three kinds are selected three
different ways with no seam that sees all of them; and HEL-503 will inherit whatever navigation interface
this ticket authors.

## Goals / Non-Goals

**Goals.** A durable, bounded, safely-degrading visit history; recording that fires on every arrival path;
a kind→navigate dispatcher shaped for the hard case; a Recent section on empty query.

**Non-Goals (design-level).** No unifying abstraction over the three kinds' selection mechanisms (D2). No
frequency counter (proposal Non-goals). No panel support (HEL-1038).

## Decisions

### Decision 1 — Design the dispatcher around DASHBOARDS FIRST; the other two fit its shape

This is the interface HEL-503 inherits, and the dashboards case is where the obvious shape breaks. A
`navigate(path)`-style dispatcher **cannot express dashboards at all**: the dashboard route is `/` and
carries no id — selection lives purely in Redux (`setSelectedDashboardId`, `features/dashboards/state/dashboardsSlice.ts:201`). Design
for sources/pipelines first and dashboards becomes a special case bolted onto a shape that cannot hold it.

So the interface is **not** "give me a path". It is:

```ts
type ResourceRef = { kind: "dashboard" | "source" | "pipeline"; id: string };
useResourceNavigator(): (ref: ResourceRef) => void;
```

An opaque "take me to this resource" command, per kind:
- `dashboard` → `dispatch(setSelectedDashboardId(id))`, and navigate to `/` only if not already there. **No
  URL id is involved, by design.**
- `source` → `navigate("/sources/" + id)`
- `pipeline` → `navigate("/pipelines/" + id)`

The caller never learns whether a kind is expressed as a route or as state — which is exactly what lets
dashboards participate as a first-class kind rather than an exception. HEL-503's search results will hand it
the same `ResourceRef` and get the same behavior.

*Alternative rejected:* a `path: string | null` field per kind, with `null` meaning "Redux only". That
leaks the mechanism into every caller and forces each to branch on it — the precise coupling HEL-503 would
inherit and have to repeat.

**What HEL-503 actually needs — verified against its LIVE body, not its stale one** (round-1 CR4; I
re-fetched the ticket and confirmed). HEL-503 was retargeted 2026-08-30 by the pipelines/outputs remodel.
Its live text: searchable entities are **dashboards / pipelines / outputs / sources / connectors**, and
"**An Output result deep-links to its pipeline with the Output sheet open**". Two consequences, recorded
here so they are decisions rather than surprises:

1. **An Output target is NOT expressible as `{kind, id}`** — it is a pipeline id PLUS an output id PLUS a
   sub-view state. So "adding a kind later is additive" is **false** for a requirement that already exists
   today. HEL-503 will have to widen `ResourceRef` (e.g. a discriminated union with an `output` variant
   carrying `pipelineId` + `outputId`), and that is a shape change, not an addition. Stating it now means
   HEL-503 plans for it instead of discovering it.
2. **An opaque `(ref) => void` yields no URL**, so a search result row could not support middle-click,
   open-in-new-tab, or copy-link — *even for sources and pipelines, which have real URLs*. That is a real
   loss for a search surface.

So this ticket **also publishes a companion**:

```ts
hrefFor(ref: ResourceRef): string | null;   // "/sources/:id", "/pipelines/:id", null for dashboards
```

`null` is honest rather than lossy: a dashboard genuinely has no address, and returning `"/"` would be a lie
that sends a middle-click to the wrong place. Callers that need a link render one when non-null and fall
back to activation-only when null. Recents itself does not need `hrefFor`; it exists because the known
inheritor does, and shipping it now costs one small pure function while retrofitting it later would change
a published surface.

### Decision 2 — Record ARRIVALS, not departures: two explicit mechanisms, three kinds, NO unifying seam

Owner ruling, and the single most important decision here. **There is no central seam**, and building an
abstraction that pretends otherwise would hide which kinds are actually wired — an abstraction covering two
of three kinds looks exactly like one covering three. Three obvious call sites are auditable; one clever
seam is not.

So, wired explicitly and separately:
- **dashboards** — a Redux listener registered via the existing `startAppListening`
  (`store/store.ts:19,60`; the toast listeners are the precedent) observing the **STATE TRANSITION** of
  `state.dashboards.selectedDashboardId`, via a `predicate` comparing previous vs current state.
  **NOT a listener on `setSelectedDashboardId`** — round-1 skeptic CR1 proved that would miss most dashboard
  arrivals: `selectedDashboardId` is written by **seven** reducers in `dashboardsSlice.ts` and only ONE is
  that action. The misses include `fetchDashboards.fulfilled:249-263`, which **auto-selects the most recent
  dashboard on boot/reload/direct-`/` arrival**, and `createDashboard`/`duplicateDashboard`/
  `importDashboard`/`applyProposal` `.fulfilled` (`:281-283`, `:306-309`, `:313-316`, `:318-320`) — so even
  **the palette's own "New dashboard" action would not have recorded**. Only three non-test dispatch sites
  of the action exist at all. Observing the transition covers all seven by construction, and remains ONE
  explicit dashboard mechanism, so it does not violate the no-unifying-abstraction ruling.
- **sources / pipelines** — one route-watching effect matching `/sources/:id` and `/pipelines/:id`.

**Why "arrivals, not departures" is what makes the acceptance criterion achievable.** Instrumenting each
*navigation call site* would require finding and touching every caller, and would silently miss the ones
that are not calls at all — a pasted URL, a bookmark, browser back/forward. Instrumenting *arrival* means
the recording fires for every path into a resource by construction, including ones no one enumerated.
Consequently the palette's own navigation needs no special handling: it routes through
`useResourceNavigator`, which produces exactly the arrival these two mechanisms already observe.

`design.md` states plainly that this is two mechanisms for three kinds, deliberately not one.

### Decision 3 — `ThemeProvider` is NOT the precedent the ticket claims; state that and supply what it lacks

The ticket says to mirror `ThemeProvider`'s persistence. Read against the tree, that model supplies **less
than claimed**: `theme.ts:65-73` does guard SSR and validate on read, but `ThemeProvider.tsx:73-77` has
**no try/catch on write**, and theme values are **raw strings — there is no JSON anywhere in it**.

A structured MRU needs strictly more:
- `JSON.parse` in a `try/catch`, plus **shape validation** on every entry (a well-formed JSON array of the
  wrong shape is not a valid history), discarding the whole blob if it cannot be trusted.
- `JSON.stringify` + `setItem` in a `try/catch` — `setItem` throws on quota exhaustion and in some private
  browsing modes. **A failed write must never break navigation**; the user's actual action must succeed.
- The SSR/no-window guard the model does supply, kept.
- A correct **empty render** on every failure path: absent, malformed, wrong-shape, unreadable, another
  device. Empty history is a normal state, not an error state.

### Decision 4 — Prune only against slices that have actually resolved

`state.sources.items` and `state.pipelines.items` load **lazily**, not at boot. A prune that treats "not in
the slice" as "does not exist" would **delete a user's history on a cold load** — the slice is empty because
nothing fetched it yet, not because the resources are gone.

So pruning is gated per kind on that kind's own load status, **named explicitly** (round-1 CR5 — an unnamed
field is a silent-defect surface): `state.sources.status` (`sourcesSlice.ts:30`), `state.pipelines.status`
(`pipelinesSlice.ts:75` — **the LIST status specifically**; that slice carries ~10 other `*Status` fields
including `createStatus`, `currentPipelineStatus` and `updateStatus`, and picking the wrong one is a silent
defect), and `state.dashboards.status`.

**"Resolved" means `=== "succeeded"` and nothing else.** `idle`, `loading` AND `failed` all RETAIN — a
failed fetch is not evidence of deletion. **Dashboards are pruned on the same rule**, not exempt; the
round-1 design discussed only sources/pipelines, which was an omission.

**Stated bluntly because it is the design's value judgement:** showing a stale entry that 404s on click is a
recoverable annoyance; silently deleting real history is not, and the user cannot even tell it happened.
When in doubt, retain.

### Decision 5 — The empty-query branch is new logic, and `"Recent"` needs a declared position

`ranking.ts` currently returns the entire registry unscored in registration order for an empty query — there
is no empty-query branch to extend. This change adds one that **PREPENDS, never replaces** (round-2 CR1 — the round-1 wording said the
empty-query presentation "is the Recent section", which reads as REPLACE and would have wiped HEL-516's
just-merged Create/Navigation/General sections from the empty-query view; it also contradicted task 5.2,
which adds `"Recent"` to `SECTION_DISPLAY_ORDER` and therefore presumes the other sections still render):
when history is non-empty the Recent section is **prepended to** the existing default presentation; when it
is empty the existing default is returned **completely unchanged**. Replace was never intended and is
explicitly rejected — regressing a sibling ticket's shipped sections to add a section is not a trade worth
making, and `SECTION_DISPLAY_ORDER` only has meaning if the other sections are still there to order.

`"Recent"` must be added to `SECTION_DISPLAY_ORDER` (`builtInActions.ts:24-28`, HEL-516). An unlisted
section is not dropped — it sorts after every listed one — so omitting it would still "work" while placing
recents last, which is the opposite of the intent. Recents lead: `["Recent", "Navigation", "General",
"Create"]`.

**`matchesQuery` is NOT used, and that choice is made explicitly here** (round-1 CR3 showed the round-1
wording was contradictory — it yielded either a spec violation or an unfailable guard).

Two readings existed and both were broken. If recent entries were *registered actions* carrying
`matchesQuery: true`, they would survive **every non-empty query** (`types.ts:23-30` — the field means
"show without re-testing"), contradicting this change's own spec scenario "Typing a query leaves recents
behind". If they were *synthesized inside the empty-query branch*, `matchesQuery` would never be read at all
— `ranking.ts:68-70` returns everything unscored on an empty query **before** any `matchesQuery` check — so
a test asserting it would be a check that structurally cannot fail.

**Decision: recents are synthesized INSIDE the empty-query branch and do NOT set `matchesQuery`.** They are
not registered in the command registry, so they cannot leak into a filtered query, and the "typing leaves
recents behind" scenario holds by construction rather than by a rule someone must remember. Since the field
is never read on this path, **no test asserts it** — per the ticket's own rule, a check that cannot fail
must not be written.

### Decision 6 — Motion tokens only

HEL-441 (`3a0c0fe8`) added `frontend/src/theme/motionTokenGuard.css.test.ts`, which **fails the build** on a
literal duration in any `transition:`/`animation:` outside its allowlist. Any reveal/hover on a recents row
uses `var(--app-transition)` (0.16s) or `var(--transition-slow)` (0.28s). No literal, no new ad hoc token.

### Decision 7 — Persist the resolved title on each entry (added at the final gate)

**The defect that forced this.** On `/` — the app's DEFAULT LANDING ROUTE — the Recent list rendered exactly
ONE of three recorded kinds. `state.sources.items` and `state.pipelines.items` are never populated there:
their only fetch dispatch sites are in `SidebarBody.tsx:53-66`, gated on the pathname's picker section. So
`resolveTitle` returned `null` and the rows were silently dropped.

This is worth recording plainly because it is an instance of **this ticket's own stated hazard**: an empty
Recent list is indistinguishable from a feature that records nothing. Recording worked perfectly; rendering
did not. Every e2e assertion of a source/pipeline recent happened to route through a slice-loading page, so
the suite was green while the feature was broken where users actually land. No grep of the diff could see
it — the cause lives in an unmodified file.

**Decision: persist the resolved `title` on `RecentEntry` at record time.** Rejected alternative:
fetch-on-palette-open. Persisting makes rendering **independent of slice load state entirely**, which is the
same principle as D4's "retain when unsure" — an MRU showing a stale title beats one silently showing
nothing. It needs no network on palette open, works on any route, and **self-heals**, since a re-visit
re-records with the current title. Fetch-on-open would have left rendering dependent on a fetch completing,
which is the same class of dependency that caused the defect.

**Accepted costs, stated rather than discovered later:**
- A title can go stale after a rename until the next visit. Strictly better than the row vanishing.
- The fix is **prospective**: entries stored before this change carry no title and stay invisible on `/`
  until re-visited once. Acceptable for a navigation aid that self-heals on use.

**Migration, and why it is delicate.** A MISSING title is tolerated — legacy entries fall back to the old
slice lookup. A PRESENT but malformed title still discards the whole blob, per D3, with no per-field
patch-up. That asymmetry is deliberate: relaxing the malformed case would weaken D3's validation, and
tolerating a missing one is what stops the whole-blob discard becoming a history-wipe for existing users —
the same mechanism that made the null-transition case dangerous in D2.

**D4 is untouched.** `pruneMissing` never consults `title`. Persisting a title changes what RENDERS a row,
never what PROVES the resource still exists — verified at the final gate with an injected titled ghost
source: retained while the slice was `idle`, and removed once the slice reached `succeeded`.

## Risks / Trade-offs

- **Recording silently not firing** → the defining hazard: a feature that records nothing is *identical on
  screen* to one with an empty history, and a fixture-fed test proves ordering logic while proving nothing
  about observation. Every kind must be proven to record in a REAL browser, on every arrival path — direct
  URL, browser back/forward, list click, and palette — not by seeding the store.
- **Wrong-lane dev server** → recents are per-user state, so another lane's palette shows another lane's
  recents and looks like a working feature. **Content self-authentication** (curl for a branch-unique string)
  before any visual observation; a port or URL check does not survive proxying or a stale tab.
- **Pruning deleting valid history** → Decision 4; retain when unsure.
- **`localStorage` unavailable or full** → Decision 3; a failed write must not break navigation.
- **Downstream churn** → `ResourceRef` and `useResourceNavigator` are what HEL-503 inherits. Adding a kind
  later is additive; changing the shape is not. A note goes into HEL-503 recording that HEL-519 owns it.
- **HEL-1038 moving** → the panel deferral is only real while that ticket is live and open. Re-verify before
  the PR; a deferral that has silently gone Done reads as handled and is worse than none.

## Migration Plan

Additive and frontend-only; no wire, schema, or backend impact. First run has no stored history and takes
the fallback path. Rollback is a single revert; the only persisted artifact is one `localStorage` key, which
is inert if the code reading it is gone.
