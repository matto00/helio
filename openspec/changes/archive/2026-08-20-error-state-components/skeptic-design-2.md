## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Ticket: HEL-539 · Change: `error-state-components` · Gate: design

### What I verified (with evidence)

Cold re-derivation from ground truth. I re-opened every file the artifacts cite rather than
trusting round 1's line numbers or the orchestrator's revision summary.

**Artifacts read in full (current revision)**
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/error-state-pattern/spec.md`,
`specs/shared-inline-error/spec.md`, `specs/shared-status-message/spec.md` (new),
`skeptic-design-1.md`.

**Binding standards re-read**
`DESIGN.md` §0 (accent discipline), §3 (tokens, control metrics + mobile 44px floor, type scale),
§4, §5 (button recipes + `IconButton`), §6 (shared primitives), §7 (loading/empty/error
consistency), §8 (accessibility); `CONTRIBUTING.md` in full.

**Line-reference drift check** — every code citation in the revised `design.md`/`tasks.md` is still
accurate on today's HEAD (`b048364a`):

| Cited | Verified |
| --- | --- |
| `SourcesPage.tsx:48`, `PipelinesPage.tsx:35`, `TypeRegistryPage.tsx:20` | exact |
| `PipelineDetailPage.tsx:596` (error branch), `TypeDetailPanel.tsx:193`/`:223` | exact |
| `ProposalReviewPage.tsx:133-141` (`if (loadError)` at :133), `.catch` at `:64-66` | exact |
| `usePanelData.ts:74-77` (`refresh`), `:116`, `:215`; `PanelContent.tsx:75` (`role="alert"`) | exact |
| `PanelCard.tsx:71` (`usePanelPolling(refresh, …)`) | exact |
| `pipelinesSlice.ts:396-400` "Preserve currentPipelineError" comment; two independent error fields | exact |
| `panelThunks.ts` `fetchPanelPage` bare `catch {` | exact (note: it has **two** `rejectWithValue` sites) |
| `PipelinesPage.test.tsx` `getByRole("alert")` + `"Failed to load pipelines."` | exact |

**Mechanical checks I ran myself**
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.
- `lucide-react@1.14.0` exports `ShieldOff`, `SearchX`, `RotateCw` directly and `AlertTriangle`
  as a back-compat alias of `TriangleAlert` (`dist/lucide-react.d.ts:25610`) — all four compile.
- `IconButton` already carries the HEL-308/314/319 mobile 44px floor (`IconButton.css:98-105`), so
  `retryVariant="icon-only"` inherits it; the new *labeled* Retry buttons do not inherit anything.
- `openspec/specs/` has no `shared-empty-state` capability, so putting the `EmptyState`
  requirements in the new `error-state-pattern` capability is correct (unlike `StatusMessage`,
  which did have one — now correctly moved).

**Round-1 change requests — resolution status**

| CR | Status | Evidence |
| --- | --- | --- |
| 1 announcement gap | **Resolved** | D3 + task 1.5 + spec scenario (`EmptyState` root `role="alert"`); D4 + task 1.7 + new `shared-status-message` delta (`failed` gains `role="alert"` + icon) |
| 2 `usePanelData` error never cleared | **Partial** | D6/task 2.5 clear in `refresh()` only; the fulfilled path round 1 also asked for was dropped silently → CR1 below |
| 3 classification placed where the status is gone | **Resolved** | D1 moves it inside each thunk, widens `rejectValue`, and the spec requirement states the "SHALL NOT classify at the call site" rule explicitly |
| 4 two `pipelinesSlice` error kinds + reset | **Resolved** | D1a names both pairs and pins each reset point to its partner's; matches `pipelinesSlice.ts:382-409` exactly |
| 5 no in-flight Retry feedback | **Resolved** | D5 + task 3.3 gate `disabled`/label swap on `currentPipelineStatus === "loading"` |
| 6 `ProposalReviewPage` "fourth branch" | **Resolved** | D5/task 3.5 say *edit* `:133-141`; `secondaryCta` preserves "Back to dashboards"; DEV-only flagged; task 2.8 names `dataTypes/services/dataTypeService` vs the slice thunk |
| 7 lucide icon sizing | **Resolved** | D2/D3/tasks 1.3/1.4 specify CSS `width:1em;height:1em` on the `<svg>` — correct: CSS geometry properties beat SVG presentation attributes, and it tracks the surrounding `--text-*` token |
| 8 Retry recipe pinned per surface | **Resolved** | D2 (Secondary `--control-sm`), D3 (Primary `--control-md` cta / Secondary `--control-md` secondaryCta), D4 (defers to D2) |
| 9 two divergent inline recipes | **Resolved for the pair it named, but the fix creates a new divergence** → CR3 below |
| 10 nested `role="alert"` + panel layout | **Partial** | `announced={false}` resolves the nesting cleanly; the small-panel case gets `retryVariant="icon-only"`; but the *second* `PanelContent` consumer is unwired → CR4 below |
| 11 not-found copy asserts deletion | **Resolved** | D7 + the spec requirement/scenario forbid asserting deletion and record the existence-not-leaked constraint |

Round-1 non-blocking notes were all taken up: dead CSS cleanup (tasks 3.1-3.4), `StatusMessage.test.tsx`
(5.3), `previewError` vs `error` disambiguation (2.6/4.4), `StatusMessage` spec placement (new delta),
and the translucent-icon-chip note (D3 now specifies a **solid** `color-mix(… , var(--app-surface))`).

**Scope discipline (HEL-528 / HEL-548 / HEL-535 / HEL-443)** — still clean. No skeletons, no toast
policy, no FontAwesome→lucide migration; lucide is used for new icons only. `secondaryCta` and
`retryVariant` are new API surface, but both are declared as self-approvals in Planner Notes with a
CR-traced justification, which is the right way to handle it.

---

### Verdict: REFUTE

The revision is a large, genuine improvement — nine of eleven change requests are resolved
substantively, not cosmetically, and every code citation now checks out against HEAD. But two
requests are only half-done, and the round-1 fixes introduced or exposed four specific defects a
competent implementer following these artifacts verbatim would ship. All six are cheap to settle
here (mostly one clause each) and expensive to discover at the final UI gate.

---

### Change Requests

**1. [carry-over, CR2 half-done] `usePanelData` still renders a stale error over freshly-loaded data**

D6/task 2.5 clear `errorForKey` in `refresh()` only. Round 1 asked for `refresh()` **and** the
fulfilled path; the second half was dropped without a stated reason, and the hole is real, not
theoretical:

- `markDataTypeRowsStale` (`panelActions.ts:20`) **deletes** `paginationState[panelId]`.
- `usePanelData.ts:88` deliberately bypasses its dedupe guard when `paginationEntry == null`, so the
  effect refetches **without** going through `refresh()`.
- On success, rows land in Redux, but `errorForKey.key` still equals `currentFetchKey`, so
  `error` (`:215`) is still truthy and `PanelContent.tsx:73` renders the error branch over live data.

This is the exact flow that happens after a pipeline run succeeds (`PipelineDetailPage` dispatches
`markDataTypeRowsStale` on SSE `succeeded`) — a panel that failed once shows a stale error even
though its data arrived. Required: state in D6 that the stored error is also cleared whenever a fetch
for that key **fulfills** (not only via `refresh()`), and extend task 5.5's regression assertion to
the stale-invalidation path, not just the button path.

**2. [new] `classifyRequestError` must delegate to the existing shared `extractErrorMessage`, and the artifacts must say which one**

`frontend/src/services/extractErrorMessage.ts` **already exists** (F-059) in the very directory the
plan puts `classifyRequestError.ts` into, and its docstring states a deliberate policy:

> Deliberately never surfaces the raw Axios/JS `err.message` … Several existing per-slice copies of
> this helper fall through to `err.message` before the fallback; this is the policy new call sites
> should follow, and existing copies should eventually converge on.

The spec says only "`message` is derived the same way as `extractErrorMessage`" — but there are
**four** functions with that name (`services/extractErrorMessage.ts:17`, `sourcesSlice.ts:14`,
`pipelinesSlice.ts:33`, `settingsSlice.ts:50`), and the two families behave differently. Neither
`design.md` nor `tasks.md` names the module. An implementer editing `sourcesSlice.ts` will most
naturally copy the local one — which falls through to `err.message`.

That is not a style nit; it has a mechanical consequence. `PipelinesPage.test.tsx`'s existing
`mockRejectedValueOnce(new Error("network error"))` asserts the rendered alert reads
`"Failed to load pipelines."`. With the local-copy semantics it renders `"network error"` and the
test fails; users see transport strings ("Network Error", "Request failed with status code 500") in
the new full-surface error states. Required: D1 and task 1.1 must state that `classifyRequestError`
**calls** `services/extractErrorMessage` for the `message` field (adding only the `kind` derivation),
and the spec sentence should reference that module by path. Also say whether the touched slices' local
copies stay (they do — they still serve other thunks; `sourcesSlice.ts:63,76`,
`pipelinesSlice.ts:320,334,348`), so nobody deletes a still-used helper.

**3. [new — introduced by the CR9 fix] Converging `.status-message--error` onto `.inline-error--banner` splits `StatusMessage`'s own two states apart**

Task 1.7/D4 pull `.status-message--error` down to `--text-xs`, `--space-2` padding, and the banner's
border/wash. But `.status-message--error` is a *modifier on the same base class as the loading state*
(`StatusMessage.css:1-15`), and both consumers render them in the **same slot of the same element**:

- `PanelList.tsx:203-206` — `<StatusMessage status={status} message={status === "loading" ? "Loading panels..." : (error ?? undefined)} />`
- `DashboardList.tsx:265` — same shape.

Today the two states are visually identical boxes that differ only in intent color — a deliberate,
good pattern. After the convergence, loading is a `--text-sm`, `--space-3`/`--space-4`-padded,
`--app-radius-md` card and failed is a `--text-xs`, `--space-2`, `--app-radius-sm` chip: the box
visibly shrinks and changes shape as the same component flips state. That is a new violation of the
same DESIGN.md §7 "handles all three **consistently**" clause the convergence was meant to serve,
traded for consistency with a different component. Required: decide this explicitly in D4 —
either (a) share only the *content* recipe (icon + retry + role) and leave each surface's box metrics
alone, (b) converge `.inline-error--banner` **up** to `StatusMessage`'s metrics, or (c) converge
`.status-message` (loading **and** failed) together so the pair stays matched — and record why.

**4. [new] `PanelDetailModal` is a second `usePanelData` + `PanelContent` consumer and no task wires it**

`PanelDetailModal.tsx:77` calls `usePanelData(panel)` (destructuring **without** `refresh`) and
renders `<PanelContent … error={error} />` at `:355`. Task 4.1 names only "`PanelCard` (and any
intermediate parent)" — `PanelDetailModal` is a sibling consumer, not an intermediate parent, so
following the tasks verbatim leaves the panel detail modal showing the new error banner with **no
Retry at all**, while the identical panel on the grid behind it has one. `PanelContent` is a named
view in the spec's "Named views render a visible error state with retry" requirement, so this is an
uncovered acceptance criterion, not a nicety. Required: name `PanelDetailModal.tsx:77/:355` in task
4.1, and decide whether that large surface uses `retryVariant="icon-only"` too or the labeled button
(D2 justifies icon-only by "a labeled button doesn't fit a 1×1 grid cell" — a reason that does not
apply inside a modal; DESIGN.md §4 points at `panel-card` container queries as the right tool for
panel-internal density if you want it to adapt).

**5. [new] `EmptyState intent="error"` leaves the hero glyph on `--app-accent`**

D3/task 1.5 change only the icon-**wrap** background. The glyph color lives on a different rule —
`EmptyState.css:32-35` `.ui-empty-state--main .ui-empty-state__icon { color: var(--app-accent); }`
(and `:73-76` for `sidebar`) — and nothing in the artifacts overrides it. Implemented literally, a
failed fetch renders an error-tinted chip containing an **accent-colored** alert glyph (blue/green/
whatever the user picked), which breaks DESIGN.md §3 "Intent colors always come from the intent
tokens" and §0.3 accent scarcity, and reads as a mis-styled state to any experienced eye. The spec
scenario's "error-tinted styling instead of the accent tint" hints at the glyph but D3 and task 1.5
both say "icon-wrap". Required: state that `intent="error"` sets the glyph to `--app-error` (and
decide the chip's border — it currently stays neutral `--app-border-subtle` while the converged
inline recipe uses `1px color-mix(--app-error 30%, transparent)`; pick one and say so). Note also
that the chosen mix is against `--app-surface`, which is the **main** variant's wrap background; the
`sidebar` variant's is `--app-surface-raised` (`EmptyState.css:62-71`) — say which surfaces the
`intent="error"` chip is defined for.

**6. [new] The generic-error copy recipe is unspecified for the five full-surface views**

D7 pins the `forbidden`/`not-found` copy precisely, but for the `error` kind — the common case, and
the one all five full-surface views hit — nothing says how the slice's message maps onto
`EmptyState`'s **two** required text props (`title` *and* `description`). Two competent implementers
will split it differently (title = "Couldn't load sources" + description = message, vs. title =
message + generic description), producing exactly the cross-surface inconsistency this ticket exists
to remove. There is a good in-repo precedent to point at — `ProposalReviewPage.tsx:133-141` uses
`title="Couldn't load the workspace"` + `description={loadError}`. Required: state that recipe once
in D5 and list the per-view resource noun (sources / pipelines / this pipeline / types), so the five
surfaces and the two D7 states all read as one voice.

---

### Non-blocking notes

- **Error glyph vocabulary.** `Toast` uses `faCircleXmark` for `error` and `faExclamationTriangle`
  for `warning` (`Toast.tsx:20-25`), so the new lucide `AlertTriangle` gives fetch errors the app's
  *warning* silhouette while toasts keep a circle-×. The repo has no single convention today
  (`faTriangleExclamation` in `StepCard.tsx:372`/`AggregateConfig.tsx:232`, `faCircleExclamation` in
  `ToolCallIndicator.tsx:83`) and unifying is HEL-443's job, so this is not blocking — but it's worth
  one deliberate sentence rather than an accident. `AlertTriangle` is also lucide's deprecated alias
  for `TriangleAlert` in 1.14.0; prefer the current name.
- **Mobile tap-target floor for the new labeled buttons.** `IconButton` and `.ui-empty-state__cta`
  already carry the ratified 44px floor (DESIGN.md §3, HEL-308/314/319); a new
  `.ui-empty-state__secondary-cta` class and the two new labeled Retry buttons
  (`InlineError`/`StatusMessage`) will not inherit it. Cheap to get right, easy to forget.
- **`retrying` + `retryVariant="icon-only"` is undefined.** D2 says `retrying` "swaps its label to
  'Retrying…'", which an icon-only control has no room for. Say it disables and swaps the
  `aria-label`/`title` instead (or note the combination is unused, since `PanelContent`'s error
  branch unmounts into the loading branch as soon as `refresh()` clears the error).
- **Icon-only Retry variant unspecified.** D2 pins `size="xs"` but not `variant`; `IconButton`
  defaults to `ghost` while the labeled Retry is Secondary. One word in D2.
- **Duplicate retry affordance on two detail panels.** `SourceDetailPanel.tsx:197-205` and
  `TypeDetailPanel.tsx:213-220` already have a "Preview"/"Reload" button that re-runs the exact fetch
  the new banner Retry will re-run, ~40px away. Consistency probably still wins, but it's a
  deliberate call worth recording.
- **The banner icon lands on two call sites the ticket doesn't list.**
  `SourceDetailPanel.tsx:208` (`renameError`, a rename *mutation* validation error) and
  `EmptySchemaAffordance.tsx:71` both use `variant="banner"` today and will silently gain the new
  alert-triangle. Benign and arguably an improvement — just not currently acknowledged anywhere.
- **`aria-label` + `role="alert"` on the same node.** `EmptyState.tsx:34` keeps `aria-label={title}`;
  once the root is a live region whose content already contains the title, some AT will announce the
  title twice. Consider dropping `aria-label` when `intent="error"`.
- **AC "correct in light/dark" has no owning task.** Tasks §5 covers failure/retry/403/404 but never
  light/dark parity. Token-derived styling makes this mostly automatic and the final gate checks it
  visually — one line in §5 would close the AC trace.
- **`fetchPanelPage` has two rejection sites.** The `"Panel is not bound to a data type."` early
  return (`panelThunks.ts:427`) also has to produce the widened `{message, kind}` payload; the type
  system will catch it, but task 2.4 mentions only the `catch`.
- **Kept from round 1 as still-correct calls.** Classification inside the thunk (D1), the
  `IconDefinition | ReactNode` widening via `React.isValidElement`, `announced={false}` instead of
  dropping `PanelContent`'s wrapper role, the solid `color-mix` icon chip, D1a's per-field kind
  reset, and D7's existence-not-leaked copy are all right and should survive the next revision intact.

### Environmental note (not a blocker for this verdict)

Unchanged from round 1: `next-report-number.sh`, `persist-evidence.sh` and `emit-event.sh` are not
tracked in the worktree (`scripts/concertino/` here holds only `assert-phase.sh`, `cleanup.sh`,
`setup-worktree.sh`, `start-servers.sh`). I invoked them from the main checkout at
`/home/matt/Development/helio/scripts/concertino/`, passing this worktree's change directory as the
argument — that is their documented interface, not a guessed fallback.
