## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Ticket: HEL-539 · Change: `error-state-components` · Gate: design

### What I verified (with evidence)

Cold re-derivation from ground truth on today's HEAD (`b048364a`). I re-opened every file the
artifacts cite rather than trusting the round-1/round-2 reports' line numbers or the orchestrator's
revision summary, and re-ran both mechanical gates myself.

**Artifacts read in full (current revision)**
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/error-state-pattern/spec.md`,
`specs/shared-inline-error/spec.md`, `specs/shared-status-message/spec.md`, plus
`skeptic-design-2.md` (read as claims, not facts).

**Binding standards re-read**
`DESIGN.md` §0 (accent scarcity), §3 (tokens, control metrics + the 44px mobile floor, type scale),
§5 (button recipes + `IconButton`), §6 (shared primitives, `EmptyState` main-title is Fraunces),
§7 (loading/empty/error handled *consistently*), §8 (accessible names, color never sole signal);
`CONTRIBUTING.md`.

**Mechanical checks I ran myself**
- `openspec validate --changes error-state-components` → `✓ change/error-state-components`,
  `1 passed, 0 failed`, exit 0.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.
- `lucide-react@1.14.0` `dist/lucide-react.d.ts`: `TriangleAlert`, `ShieldOff`, `SearchX`, `RotateCw`
  all declared; `AlertTriangle` exists **only** as `TriangleAlert as AlertTriangle` (a back-compat
  alias, no own declaration) — the revision's `TriangleAlert` choice is correct.
- `IconButton.css:103-112` carries the 44px mobile floor; `IconButton.tsx` requires `aria-label` at
  the type level and offers `variant="secondary"` / `size="xs"` — `retryVariant="icon-only"` is
  expressible exactly as D2 specifies.
- `theme.css`: `--app-error` (`#f07561` dark / `#c73a2a` light), `--app-error-surface` is a
  *translucent* mix — so D3's `color-mix(… var(--app-surface))` for a **solid** chip is the right
  call and does not violate the §3 opacity invariant.

**Line-reference drift check** — every code citation in the revised `design.md`/`tasks.md` is
accurate on HEAD. I verified each one by opening the file:

| Cited | Verified |
| --- | --- |
| `SourcesPage.tsx:48`, `PipelinesPage.tsx:35`, `TypeRegistryPage.tsx:20`, `PipelineDetailPage.tsx:596` | exact |
| `TypeDetailPanel.tsx:193` (save) / `:223` (preview); `SourceDetailPanel.tsx:208`; `EmptySchemaAffordance.tsx:71` | exact |
| `ProposalReviewPage.tsx:133-141`, `.catch` at `:64-66`, effect at `:57-70` (cited `:58-70`) | exact / off-by-one on the `useEffect(` line only |
| `usePanelData.ts:74-77` (`refresh`), `:88` (dedupe bypass), `:113-117` (promise chain), `:215` (`error`) | exact |
| `PanelContent.tsx:75` (`role="alert"` wrapper), `PanelCard.tsx:70`, `PanelDetailModal.tsx:77`/`:355` | exact — and `usePanelData` has **exactly two** production consumers, no third |
| `pipelinesSlice.ts:396-400` "Preserve currentPipelineError" comment; two independent error fields | exact (`:382-394` list pair, `:396-410` detail pair) |
| `panelThunks.ts` `fetchPanelPage` — two `rejectWithValue` sites, bare `catch {` | exact (`:427` guard, `:437` catch) |
| `panelActions.ts:20` `markDataTypeRowsStale`; `PanelList.tsx:203-206`; `DashboardList.tsx:265` | exact |
| `EmptyState.css:19-35`/`:62-76`; glyph `color: var(--app-accent)` at `:34`/`:75`; `EmptyState.tsx:34` `aria-label` | exact |
| `sourcesSlice.ts:14`, `pipelinesSlice.ts:33`, `settingsSlice.ts:50` local `extractErrorMessage` | exact |
| `PipelinesPage.test.tsx:159-160` `getByRole("alert")` + `"Failed to load pipelines."` | exact; survives the new markup (`toHaveTextContent` substring-matches the `description`) |
| Dead CSS: `PipelinesPage.css:27`, `PipelineDetailPage.css:804` | exact, standalone rules |
| Dead CSS: `SourcesPage.css:56`, `TypeRegistryPage.css:29` | **partially** accurate — see non-blocking notes |

I also traced the retry-recovery path for every view myself: `fetchSources`/`fetchDataTypes`/
`fetchPipelines` clear `error` on `.pending` **and** `.fulfilled`; `fetchPipelineById` preserves on
pending / clears on fulfilled (matching D1a); `fetchPanels`' `condition` allows a retry from
`"failed"`; `TypeDetailPanel.handlePreview:57` and `SourceDetailPanel.handlePreview:126` both null
their error before refetching. Eight of nine named views therefore genuinely recover. The ninth
does not — CR2 below.

**Round-2 change requests — resolution status (all six re-derived from the files, not the report)**

| CR | Status | Evidence I checked |
| --- | --- | --- |
| 1 `usePanelData` stale error (carry-over) | **Genuinely resolved** | D6 (`design.md:118-125`) requires clearing on `refresh()` **and** on fulfillment via a `.then()` before the existing `.catch()`; task 2.5 names the mechanism and the reason (`markDataTypeRowsStale` → `:88` bypass); the spec adds a dedicated requirement + a *separate* scenario for the background-refetch path; task 5.5 splits the assertion into (a) button retry and (b) invalidation refetch. Not cosmetic — the fix matches the actual code path I re-read at `usePanelData.ts:84-117`. |
| 2 `classifyRequestError` must delegate | **Genuinely resolved** | D1 says it "**calls** `services/extractErrorMessage.ts`'s `extractErrorMessage` for `message`", "does **not** reimplement", "never falls through to raw `err.message`"; task 1.1 repeats it and forbids touching the per-slice copies; the spec requirement names the module **by path** and states the copies "remain untouched and continue to serve their own existing call sites". The `PipelinesPage.test.tsx` failure mode round 2 predicted is now structurally prevented. |
| 3 `StatusMessage` box-metric convergence | **Genuinely resolved** | D4 reverses the round-1 instruction with a stated rationale (loading/failed share one slot in `PanelList.tsx:203-206` and `DashboardList.tsx:265`, so shrinking only `failed` re-creates the §7 violation elsewhere); task 1.7 spells out the metrics that must NOT change (`--text-sm`, `--space-3`/`--space-4`, `--app-radius-md`); the new `shared-status-message` requirement encodes "SHALL NOT alter … identical to the `loading` state's". Correct call, correctly recorded. |
| 4 `PanelDetailModal` unwired | **Genuinely resolved** | D5 and task 4.1 both name `PanelDetailModal.tsx:77/355` alongside `PanelCard`, flag that `:77` destructures without `refresh`, and add a `retryVariant` prop threaded per-consumer (`"icon-only"` grid / `"button"` modal). A dedicated spec requirement ("Both `PanelContent` rendering contexts offer retry") + scenario now covers it, and task 5.5 tests both consumers. |
| 5 `EmptyState` glyph stays accent | **Genuinely resolved** | D3 overrides the glyph (`--app-accent` → `--app-error`) *and* the chip border (`color-mix(--app-error 30%, transparent)`) on both variants, and drops `aria-label` when `intent="error"`; task 1.5 lists all four properties; the spec scenario asserts "the icon-wrap element **and its glyph**". |
| 6 generic-error copy recipe | **Resolved for the `error` kind** | D5 pins one recipe (`title="Couldn't load {resource}"` + `description={message}`) with the `ProposalReviewPage.tsx:133-141` precedent and the per-view noun list. A residual for the `forbidden`/`not-found` titles is noted below as non-blocking, not a re-refutation. |

**Round-2 non-blocking notes** — I confirmed each was taken up: `TriangleAlert` over the deprecated
alias (D2 + Planner Notes), the 44px floor called out for the new labeled Retry and for
`secondaryCta` explicitly ("does not inherit it automatically"), the icon-only `retrying` behavior
defined as an `aria-label`/`title` swap, `IconButton variant="secondary"` pinned, the duplicate
Preview/Reload overlap recorded as deliberate with a stated reason, the two untouched `banner` call
sites acknowledged as an accepted ripple, and a light/dark line added at task 5.7.

**Scope discipline (HEL-528 / HEL-548 / HEL-535 / HEL-443)** — still clean. No skeletons, no toast
policy, no FontAwesome→lucide migration. `secondaryCta` is the one arguable brush against HEL-548;
it is required to avoid *dropping* `ProposalReviewPage`'s existing "Back to dashboards" affordance
and is declared as a self-approval, which is the right handling.

**UI/UX judgment I applied beyond the checklist** — the two-tier treatment (full-surface
`EmptyState` hero vs. inline tinted banner) is the right split and already has in-repo precedent;
using the Fraunces `main` title for an error headline is explicitly decided in the spec rather than
drifted into; the Primary-Retry / Secondary-back pairing satisfies §5's "one primary per section";
the solid `color-mix` chip respects the §3 opacity invariant; and D4's refusal to converge box
metrics is the more sophisticated §7 reading, not a dodge.

---

### Verdict: REFUTE

This revision is materially correct. **All six round-2 change requests are genuinely resolved** —
I checked each against the code rather than the summary, and none is a cosmetic patch. The line
citations are accurate, both mechanical gates pass, and the design judgment on the two genuinely
contested points (D4's metric non-convergence, D3's full intent-error chip) is sound.

I am refuting on three items, none of which is a carry-over and none of which requires
re-architecture — each is a one-or-two-clause edit to an existing artifact. **CR1 is the one I
consider a genuine, prod-reachable, user-visible defect** that these artifacts, followed verbatim,
would ship; CR2 and CR3 are real but narrower. I have ranked them explicitly so the orchestrator
can escalate with the right resolution.

---

### Change Requests

**1. [NEW · genuine defect · prod-reachable] `SourceDetailPanel`'s Retry gets attached to a message that can never succeed**

`SourceDetailPanel.tsx` has **one** preview error state (`:41`) with **two** producers:

- `:145` — `setError(err instanceof Error ? err.message : "Failed to fetch preview.")` — a real
  fetch failure, correctly retryable.
- `:141` — ``setError(`Preview is not supported for ${labelForKind(source.type)} sources.`)`` — a
  **deterministic capability limitation**, not a failure. It is reached for every source kind
  outside the `csv`/`static`/`rest_api` branches; `DataSourceKind` is
  `"csv" | "rest_api" | "sql" | "static" | "text" | "pdf" | "image"`, so **four of seven kinds**
  land here, including `sql` — a first-class feature of this app.

Both render through the single call site at `:240`, and task 4.3 says: "pass `onRetry`/`kind` … to
its existing `InlineError variant="banner"` call, re-calling the same CSV/REST preview fetch."
`kind` for `:141` is `"error"` (it never passes through `classifyRequestError` — there is no caught
error to classify), so D2's suppression rule does not fire. Implemented verbatim, a user viewing a
PostgreSQL source and clicking **Preview** gets:

> ⚠ Preview is not supported for PostgreSQL sources.  [⟳ Retry]

…where Retry re-runs `handlePreview()` and lands on the identical message every time. That is
precisely the retry-spam the ticket's own AC legislates against ("no infinite retry") and a §7
`[judgment]` error-state defect an experienced eye would reject. Nothing in `design.md`, `tasks.md`,
or any spec delta mentions this branch — I grepped the whole change dir for `not supported` /
`unsupported` / `:141` and got zero hits.

Required (minimum): state in D5 and task 4.3 that `onRetry` is passed **only** for the
`catch`-produced fetch failure at `:145`, and that the `:141` unsupported-kind branch renders with
no Retry. If you prefer the cleaner fix, say so explicitly instead: split `:141` into its own
non-error state (it is an informational limitation, not a failure) — but do not leave the choice
implicit.

**2. [NEW · genuine defect · DEV-only surface] `ProposalReviewPage`'s Retry cannot recover, because `loadError` is never cleared**

`loadError` (`ProposalReviewPage.tsx:45`) has exactly **one** setter in the entire file — `:65`,
inside the `.catch`. There is no reset anywhere (I grepped: `loadError` appears at `:45`, `:65`,
`:133`, `:138` only). The render guard at `:133` is `if (loadError) return <EmptyState … />`, and it
sits **above** the `if (!proposal)` guard.

Task 2.8 adds a `retryToken` to re-trigger the effect and a local `retrying` boolean, but never says
to null `loadError` when the retry runs or succeeds. Followed verbatim: Retry re-fetches, the fetch
succeeds, `setDataTypes(types)` lands — and `loadError` is still truthy, so `:133` keeps returning
the error `EmptyState`. The button appears to do nothing.

This directly contradicts this change's own spec scenario ("**AND** activating Retry re-runs the
fetch, clearing the error state and rendering the data on success") for a view the same requirement
names. No planned test catches it — task 5.5's retry-recovery list is `SourcesPage`, `PipelinesPage`,
`TypeRegistryPage`, `PanelContent`, and omits `ProposalReviewPage`. Note this is the *third*
instance of the same "stored error survives a successful fetch" shape across this change's three
rounds (round-1 CR2 → round-2 CR1 → here), which is why I am flagging it rather than trusting it to
surface during execution.

Severity is genuinely lower than CR1: D5 correctly records that this fetch is DEV-only
demo-fixture data, so production users never see this Retry at all.

Required: add to task 2.8 that the retry path clears `loadError`/`loadErrorKind` (e.g.
`setLoadError(null)` at the top of the effect run, alongside `setRetrying(true)`), and add
`ProposalReviewPage` to task 5.5's recovery assertions — or state explicitly why it is exempt.

**3. [NEW · internal contradiction · specify one way] `EmptyState`'s `cta.disabled` label swap is specified in two incompatible places**

Three artifacts disagree about **who** swaps the in-flight label:

- `tasks.md:8` (1.6): "`disabled` on both `cta`/`secondaryCta` (label-swap idiom, matching
  `TypeDetailPanel.tsx`'s existing `previewLoading` pattern)" — that pattern
  (`TypeDetailPanel.tsx:219`: `{previewLoading ? "Loading…" : … }` with `disabled={previewLoading}`)
  is **caller-side**: the call site passes the already-swapped string.
- `specs/error-state-pattern/spec.md:46-49`: "…SHALL each accept a boolean … **which disables the
  action and swaps its visible label** to a distinct in-flight label (e.g. 'Retrying…')" —
  reads as **component-side**.
- `tasks.md:40` (5.2): "`EmptyState.test.tsx`: … `disabled` label-swap" — a test that can only be
  written against `EmptyState` if the **component** does the swap.

The two readings are not equivalent. Component-side means `EmptyState` hard-codes retry copy into a
shared primitive that ~10 neutral empty states also use, so `cta.disabled` becomes unusable for any
non-retry disabled CTA (e.g. a disabled "Add source"). Caller-side keeps the primitive generic but
makes task 5.2's assertion untestable as written. Contrast `InlineError`, where D2 is unambiguous
(the component swaps, because `retrying` is retry-specific by name) — that one is fine.

Required: pick one and make `tasks.md` 1.6, `tasks.md` 5.2, and the spec requirement agree. My
recommendation is caller-side (keeps the shared primitive intent-agnostic, matches the existing
in-repo idiom the task already cites), with the spec sentence reworded to "disables the action; the
in-flight label is supplied by the caller" and 5.2's assertion narrowed to "renders the supplied
label and sets `disabled`".

---

### Non-blocking notes

These are nits and judgment calls, not gate blockers. Listed so the orchestrator can distinguish
them clearly from the three above if it escalates.

- **`forbidden`/`not-found` titles for the full-surface views are still unstated.** `EmptyState`
  requires *both* `title` and `description`, but D7 supplies one sentence per kind and D5 just says
  "D7's copy". The `not-found` string splits naturally (title = "We couldn't find this pipeline." /
  description = "It may have been deleted, or you may not have access to it."), and D7 itself notes
  `forbidden` cannot fire on this ticket's read-only fetches, so the practical divergence risk is
  small — but one clause in D5 would finish what round-2 CR6 started.
- **No icon is specified for `EmptyState intent="error"`.** D2 pins the kind→glyph mapping for
  `InlineError` (`TriangleAlert`/`ShieldOff`/`SearchX`) but nothing says the five full-surface views
  reuse it. `icon` is a required prop, so each view's author must pick something. One sentence
  ("full-surface error states use the same D2 kind→glyph mapping") removes five chances to diverge.
- **The spec delta still uses the deprecated alias in an example.**
  `specs/error-state-pattern/spec.md:33` reads `icon={<AlertTriangle />}`, contradicting design.md's
  own Planner-Note self-approval to use `TriangleAlert` everywhere. Illustrative only, still
  compiles (the alias exists in 1.14.0), but the spec is the durable artifact.
- **`design.md:36` says "The four other same-named local helpers" and then lists three.** Ground
  truth is **eight** local `extractErrorMessage` definitions (`assistantConversationsSlice`,
  `metricsSlice`, `useShapeOffering`, `ShapeInstantiateStep`, `pipelinesSlice`, `ShapePickerModal`,
  `settingsSlice`, `sourcesSlice`) plus the shared one. The instruction ("leave them alone") is
  right regardless of the count, so there is no implementation consequence — but the number is wrong.
- **Two of the four dead-CSS citations point at a shared selector.** `.sources-page__error` occupies
  *two* rules (`SourcesPage.css:55-60`, shared with `.sources-page__loading`, and a standalone
  `:62-64`); `.type-registry-page__error` likewise (`:28-33` shared, `:35-37` standalone). Tasks 3.1
  and 3.4 name only the first line of each. Deleting "line 56" naively leaves a dangling
  `.sources-page__loading,` selector. `PipelinesPage.css:27` and `PipelineDetailPage.css:804` are
  standalone and correctly cited.
- **`PanelList`'s `StatusMessage` retry is not kind-gated.** `fetchPanels` is not in tasks 2.1-2.8,
  so a 404 from `GET /api/dashboards/:id/panels` (e.g. a dashboard deleted in another tab) renders a
  generic error with a Retry that can never succeed — the same shape as CR1, but a much rarer path,
  and the spec deliberately scopes the no-retry rule to `EmptyState`/`InlineError`. One recorded
  sentence in D4/D5 would turn this from an unnoticed gap into a stated scope decision.
- **Eager error clearing in `refresh()` can flash "No data available".** After a rejected
  `fetchPanelPage`, `panelsSlice.ts:218-226` leaves `paginationState[panelId]` present with
  `isLoadingMore: false, rows: []`. D6's eager `setErrorForKey(null)` therefore makes
  `usePanelData.ts:217`'s `noData` momentarily `true` — one commit before the new `pending` action
  sets `isLoadingMore` — so `PanelContent` may paint "No data available" for a frame between the
  Retry click and the spinner (§7's "never a flash of empty content"). Cheap mitigation: clear the
  error in the same tick the fetch is dispatched, or gate `noData` on a retry-in-flight flag. I did
  not reproduce this at runtime, so I am deliberately not treating it as a defect.
- **`disabled`/"Retrying…" is unobservable on three of the five full-surface views.**
  `SourcesPage`, `PipelinesPage`, and `TypeRegistryPage` all clear `error` on `.pending`, so their
  error branch unmounts the instant Retry is clicked and the in-flight CTA state never renders. Only
  `PipelineDetailPage` (which deliberately preserves `currentPipelineError`) actually shows it.
  Harmless dead state, worth knowing before someone writes a test for it. The same is true of
  `StatusMessage`'s `retrying`, which cannot be true while `status === "failed"`.
- **D4's own pairing argument applies to two of the views D5 changes.** `SourcesPage.css:55-60` and
  `TypeRegistryPage.css:28-33` render loading and error as an *identical* box differing only in
  color — exactly the matched pair D4 protected for `StatusMessage`. Replacing only the error half
  with a 320px hero breaks that pairing. I think the trade is correct (a one-line `<p>` cannot carry
  a Retry CTA, and HEL-528 reworks the loading half next), but D4 makes a point of recording this
  reasoning in one place and not the other.
- **The 44px mobile floor is called out for `InlineError`'s and `EmptyState`'s new buttons, but not
  `StatusMessage`'s.** Task 1.7 inherits it only implicitly via "D2's content recipe". `PanelList`'s
  `StatusMessage` *is* mobile-reachable, so the floor genuinely applies.
- **Lucide sizing introduces a second convention.** The five existing lucide call sites use the
  `size={13|14}` prop (`SourceDetailPanel.tsx:191`, `SidebarBody.tsx:338`); the plan specifies CSS
  `width:1em;height:1em`. The CSS approach is better (tracks the `--text-*` token, no literal px)
  and HEL-443 owns unification — noted only so it is a choice rather than an accident.
- **Still-correct calls that should survive any further revision.** Classification inside the thunk
  with a widened `rejectValue` (D1), the `IconDefinition | ReactNode` widening via
  `React.isValidElement`, `announced={false}` instead of stripping `PanelContent`'s wrapper role,
  the solid `color-mix` chip, D1a's per-field kind reset, D4's metric non-convergence, D7's
  existence-not-leaked copy, and the per-consumer `retryVariant` split.

### Environmental note (not a blocker for this verdict)

Unchanged from rounds 1 and 2: `next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh`
are not tracked in this worktree (`scripts/concertino/` here holds only `assert-phase.sh`,
`cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`). I invoked them from the main checkout at
`/home/matt/Development/helio/scripts/concertino/`, passing this worktree's change directory as the
argument — their documented interface, not a guessed fallback. `next-report-number.sh` returned
`READY number=3`, which is the filename this report uses.
