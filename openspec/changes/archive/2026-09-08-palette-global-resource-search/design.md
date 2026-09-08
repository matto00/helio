## Context

See proposal.md — Why, and ticket.md's "Premise corrections" for the invalidated enumeration. Three facts
drive everything below: `ResourceRef` cannot express an Output today; no searchable collection except
dashboards is loaded on `/`; and outputs are reachable in bulk via the EXISTING paginating client `listAllOutputs()` — `GET /api/outputs`
is paginated, not a single-request dump (see D3).

## Goals / Non-Goals

**Goals.** A widened reference that makes Output first-class; explicit indexing that works on `/`; grouped
ranked results; a coverage statement derived from live state.

**Non-Goals (design-level).** No backend search endpoint. No panels (HEL-1038) or connectors (HEL-1041). No
change to how `rankActions` scores registered actions.

## Decisions

### Decision 1 — Widen `ResourceRef` into a DISCRIMINATED UNION, designed for the Output case first

This is the shape change every other piece sits on; get it wrong and four kinds inherit the mistake.
HEL-519 authored this interface predicting exactly this widening, and recorded on HEL-503 in advance that an
Output is **not** expressible as `{kind, id}` — it needs a pipeline id AND an output id.

```ts
export type ResourceRef =
  | { kind: "dashboard" | "source" | "pipeline"; id: string }
  | { kind: "output"; id: string; pipelineId: string };
```

A union rather than an optional `pipelineId?` on one flat record: optional-field-that-is-required-for-one-kind
is exactly the shape that compiles while being wrong, and it would let a caller construct an Output ref with
no pipeline. The union makes the invalid state unrepresentable. TypeScript enforces this **automatically only for
value-returning switches** — `hrefFor` gets TS2366 under `strict` if a kind is unhandled.

**It does NOT enforce it for `useResourceNavigator`** (skeptic CR6 — round 1 claimed it did, which was
false): that returns a `void` function branching with `if (ref.kind === "dashboard") { ...; return; }`, and
a void function may legally fall off the end. So an unhandled kind would silently do **nothing** — a result
row that appears to work and goes nowhere, which is this batch's signature failure.

Therefore the navigator carries an **explicit `never` exhaustiveness assertion** in its final branch
(`const _exhaustive: never = ref;`). Without it, task 1.3's guard structurally cannot fail.

`hrefFor` gains a real path for outputs using **the convention that already exists** — HEL-909's
`/pipelines/:id?outputId=<id>` (`usePipelineDetailPage.ts:574-594` reads the param, opens the sheet, strips
it). **Do not invent a second convention.** So `hrefFor({kind:"output", id, pipelineId})` yields
`/pipelines/${pipelineId}?outputId=${id}` — a genuine address, so an output result row supports middle-click
and open-in-new-tab, which was `hrefFor`'s whole reason for existing.

Dashboards still return `null` from `hrefFor` (no address exists; `"/"` would send a middle-click to the
wrong dashboard). That asymmetry is deliberate and unchanged.

**`ResourceKind`'s fate, ruled explicitly** (skeptic CR2, corrected again at round 2 — round 1 left it
unspecified, and round 2's first attempt named the wrong mechanism):
**`ResourceKind` GAINS `"output"`.** HEL-1041's own scope text already assumes this reading, so the
alternative would leave two divergent kind vocabularies.

Recents support three kinds, not four (HEL-519 shipped them; outputs were never recorded). The round-2
wording claimed `useRecentPaletteActions.ts:65` "stays legal" because `RecentKind` excludes `"output"` —
**that was false**, because `RecentEntry["kind"]` is itself typed `ResourceKind`
(`features/commandPalette/model/recentHistoryStore.ts:16`), so widening `ResourceKind` widens `entry.kind`
and breaks two call sites:
- `features/commandPalette/useRecentPaletteActions.ts:65` — `{ kind: entry.kind, id: entry.id }` is no
  longer assignable to `ResourceRef` (the Output arm requires `pipelineId`);
- `features/commandPalette/useRecentPaletteActions.ts:12` — `Record<RecentEntry["kind"], LucideIcon>` is
  missing an `"output"` key.

**What actually fixes it is retyping the store, not annotating the array.** `RecentEntry["kind"]`, and
`recordVisit`/`pruneMissing`'s `kind` parameters (`recentHistoryStore.ts:100,104`), become:

```ts
type RecentKind = Exclude<ResourceKind, "output">;
```

**Exhaustiveness mechanism, named because the obvious one does not work.** `const VALID_KINDS: readonly
RecentKind[]` **cannot fail the build** when a kind is added — an array annotation does not require the array
to be exhaustive, so the round-2 verification was unsatisfiable by the construct it prescribed. This is
round-1 CR6 recurring: *the obvious mechanism does not do what the plan asserts it does.* Derive the list
from an exhaustiveness-checked keyed map instead:

```ts
const RECENT_KINDS: Record<RecentKind, true> = { dashboard: true, source: true, pipeline: true };
const VALID_KINDS = Object.keys(RECENT_KINDS) as readonly RecentKind[];
```

A `Record<RecentKind, true>` **is** checked for missing keys, so adding a kind to `RecentKind` breaks the
build — which is the property the plan claims and the array annotation never had.

### Decision 2 — Index EXPLICITLY, on palette open, per kind (owner ruling)

**Ruled in by the owner, not left to the gate.** The ticket's "search only loaded X and say so" is
insufficient because the failure is invisible: a search over unloaded slices returns nothing, and **nothing
found is indistinguishable from never indexed**. HEL-519 shipped exactly this defect and its final gate
caught it on `/`.

Load timing, measured: dashboards fetch at boot (`App.tsx:174`); sources and pipelines only via
`SidebarBody.tsx:53-66`, gated on pathname; outputs only per-pipeline inside `PipelineDetailPage`. **On `/`,
three of four kinds are empty — PROVIDED the onboarding checklist is not showing.**

That proviso is load-bearing and was missing in round 1 (skeptic CR4).
`useOnboardingHost.ts:83-91` dispatches `fetchSources()` AND `fetchPipelines()` whenever the onboarding
checklist is visible, and it auto-activates when `dashboards.status === "succeeded" && items.length === 0` —
**exactly the account a fresh e2e `registerAndLogin` creates.** So on a zero-dashboard account, sources and
pipelines ARE loaded on `/` with no palette-open fetch at all, and the prescribed
"remove the fetch and watch the test go red" mutation would stay **GREEN while proving nothing**.

That is HEL-519's failure one level up: not a test that routed through a loading page, but a test whose
*fixture* did the loading. Every `/`-route test must therefore start from an account with **at least one
dashboard**, so the checklist is not rendered.

So: when the palette opens, ensure each kind's collection is fetched — dispatching each kind's existing list
thunk if it has not already succeeded, and a new thunk for `GET /api/outputs`. Four cheap list calls, each
dispatched at most once (guarded on the slice's own status, so re-opening the palette refetches nothing).

*Alternative rejected:* index at app boot. That charges every session four requests for a feature most
sessions never use. Palette-open is the first moment the data is actually needed.

*Alternative rejected:* search only what happens to be loaded. That is the defect, restated.

**The failed-fetch path, specified** (skeptic CR3 — round 1 left it out of D2, D4 and both specs, and task
2.2's "at most once" verification was true only on the happy path):
- **Retry on each palette open when a kind's fetch has `failed`.** Deliberate: opening the palette is a
  user-initiated action, so one retry per explicit open is proportionate — no backoff loop, no background
  polling, and no permanent dead kind after one transient error.
- **`failed` and `loading` must read DIFFERENTLY in the coverage statement.** A failed kind silently
  "dropping out" of the covered list tells the user three kinds are searched and never that the fourth
  broke — so "no results" for that kind is again indistinguishable from broken. `loading` says the search is
  still completing; `failed` says that kind could not be searched.
- **Dedup mechanism named:** the guard reads each slice's own status rather than relying on a thunk's
  `condition` option (`fetchPipelines` has one; not all kinds do). Asserting "at most once" against the
  wrong mechanism is how that test goes vacuous.

### Decision 3 — Outputs are indexed by REUSING the existing paginating client

`outputsSlice` holds `byPipeline` and only `fetchOutputs(pipelineId)`, which suggests indexing outputs costs
one request per pipeline and nearly led to deferring the kind.

**It does not — but the round-1 framing of why was wrong on two counts** (skeptic CR1):
1. `GET /api/outputs` is **paginated, not unbounded**: `Page.Default.limit = 200`, `Page.MaxLimit = 500`
   (`pagination.scala:11-12`), returning `total`. "Every Output in ONE request" was false, and a
   single-page read would **silently truncate the index** — the same defect class as not indexing at all,
   which is the thing this ticket exists to prevent.
2. **The frontend already has a paginating client**: `listAllOutputs()` at
   `frontend/src/features/pipelines/services/outputService.ts:66` already loops until `total` is exhausted,
   already has a consumer (`useOutputPickerData.ts:66`), and its own docstring warns that assuming one page
   suffices silently truncates. "The frontend has no thunk for it yet" was stale.

**Decision: REUSE `listAllOutputs()`.** Do not write a second, single-page client for the same endpoint —
that would reintroduce precisely the truncation its docstring warns about, one file away from the warning.

**Truncation semantics the index guarantees:** the outputs index is complete with respect to what
`listAllOutputs()` returns, i.e. it loops all pages rather than reading one. If that loop is ever bounded,
the bound becomes a coverage fact and must surface through D4's coverage reporting rather than silently
shrinking results.

The general lesson still stands, and is why the kind survived at all: **a frontend absence is not evidence of
a backend absence.** The slice was the wrong place to look. The correction is that the *service layer* was
the right place, and it already had the answer.

### Decision 4 — Coverage is DERIVED from live per-kind status, never a hardcoded list

The requirement is to name which kinds are searchable right now. The tempting implementation — a constant
string listing the kinds, or a hardcoded array — is **a claim that decays**: the first time a kind is added,
removed, or fails to load, the message keeps asserting the old set and is wrong in a way nothing detects.

So the coverage statement is computed from each kind's actual slice status at render time. Adding a kind to
the index automatically adds it to the message; a kind whose fetch fails automatically drops out of it. There
is no place where the set of kinds is written down twice.

**A guard must exist that fails if the message is hardcoded** — e.g. render with one kind's status forced to
loading and assert that kind is absent from the message. If the message is a constant, that test fails.

### Decision 5 — Contribute results via `matchesQuery`, in their own section

Search results are pre-scored by the contributor's own matcher, so they set `matchesQuery: true`
(`ranking.ts:75-78`), which keeps them unscored and in registrant order rather than re-ranked by the
palette's title/keyword scorer. This is precisely what that field exists for — and note it is the *opposite*
case to HEL-519's recents, which deliberately do NOT use it because they are synthesized inside the
empty-query branch rather than registered.

A new section is added to `SECTION_DISPLAY_ORDER` (`builtInActions.ts:28-36`). An unlisted section is not
dropped — it sorts after every listed one — so omitting it would "work" while burying results below Create.

### Decision 6 — Debounce the query, not the render

Matching is deferred so a fast typist is never blocked, and the results shown must correspond to the query as
last typed — a stale in-flight match must not overwrite a newer one. Debouncing the *matching* keeps the
input immediately responsive while avoiding a scored pass over four collections on every keystroke.

### Decision 7 — Cap results per kind

Round 1 specified no cap anywhere (skeptic CR5), and `rankActions` never truncates `matchesQuery` actions
(`ranking.ts:73-78` keeps every opted-out action). The dev DB alone carries ~85 Outputs, so a one- or
two-character query would stack hundreds of rows beneath Recent/Navigation/General/Create — burying the
palette's own actions under search noise and making the list unusable by keyboard, which is the point of the
palette.

**Decision: a small fixed per-kind cap** (5 is the intended value, adjustable in one place), applied after
ranking so the best matches survive. When a kind has more matches than the cap, the group states how many
more exist rather than silently truncating — a silent truncation is a smaller version of the
silently-incomplete-index defect this whole ticket is about.

## Risks / Trade-offs

- **The `/`-route test must be able to fail.** HEL-519's suite was green while the feature was broken on `/`
  because every test routed through a loading page first. **A test that navigates anywhere before searching
  does not test this.** Break indexing deliberately and confirm the test goes red — and verify the mutation
  actually landed, since a probe whose pattern silently fails to match returns a meaningless green.
- **Coverage message drifting from reality** → Decision 4; guarded by a test that fails on a hardcoded list.
- **"No results" shown while still indexing** → the spec forbids it; an in-progress search must say so rather
  than assert emptiness.
- **Union widening breaks a call site** → that is the point: TypeScript surfaces every `switch` that must now
  handle Output. A silent `default` branch would be the failure mode; there must not be one.
- **Four fetches on first palette open** → each guarded on slice status and dispatched at most once. Accepted
  over indexing at boot, which charges every session for a feature many never use.
- **Downstream** → `ResourceRef` is consumed by HEL-519's recents. Widening a union is additive for existing
  kinds, but every exhaustive `switch` must be rechecked; recents must keep working unchanged.

## Migration Plan

Additive and frontend-only apart from reusing an existing endpoint. No schema or wire change. Rollback is a
single revert; the widened union is the only published-surface change, and it is backward compatible for the
three existing kinds.
