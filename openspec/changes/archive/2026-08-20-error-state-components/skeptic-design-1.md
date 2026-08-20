## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Ticket: HEL-539 · Change: `error-state-components` · Gate: design

### What I verified (with evidence)

Every claim below is derived from files I read myself in the worktree, not from the planning
artifacts' narrative. Where the plan asserted something about existing code, I opened that code.

**Artifacts read in full**
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/error-state-pattern/spec.md`,
`specs/shared-inline-error/spec.md`, `workflow-state.md`.

**Binding standards read**
`DESIGN.md` §3 (tokens/opacity invariant), §4, §5 (button recipes), §6 (shared components,
`EmptyState` `main` = Fraunces), §7 (loading/empty/error consistency), §8 (accessibility);
`CONTRIBUTING.md` in full (incl. "Existence-not-leaked semantics").

**Ground-truth code checks (the plan's factual claims about today's code)**

| Plan claim | Verified against | Result |
| --- | --- | --- |
| Six views hand-roll `<p role="alert">{error}</p>` | `SourcesPage.tsx:48`, `PipelinesPage.tsx:35`, `TypeRegistryPage.tsx:20`, `PipelineDetailPage.tsx:596`, `TypeDetailPanel.tsx:193/223` | TRUE |
| `PanelList` uses `StatusMessage` (text-only failed) | `PanelList.tsx:203-206` | TRUE |
| `SourceDetailPanel` already uses `InlineError variant="banner"`, no retry | `SourceDetailPanel.tsx:208,240` | TRUE |
| `usePanelData` exposes a `refresh()` nothing calls on error | `usePanelData.ts:74`; `PanelCard.tsx:69-71,104` | TRUE (but see CR2 — polling already calls it) |
| Touched thunks' `rejectValue` is a bare `string` | `sourcesSlice.ts:44`, `pipelinesSlice.ts:176`, `panelThunks.ts:419-422` | TRUE |
| `ProposalReviewPage` has three existing `EmptyState` branches, needs a fourth for fetch failure | `ProposalReviewPage.tsx:124,133-141,152` | **FALSE** — the fetch-failure branch is one of the three (CR6) |
| `--app-error` / `--app-error-surface` / `--app-danger-surface` all exist, light+dark | `theme/theme.css:123,127,128,129,171,175,176,177` | TRUE (`--app-danger-surface` is an alias, so no token drift there) |
| `React.isValidElement` can't be satisfied by a FontAwesome `IconDefinition` | `EmptyState.tsx:1-11`; FA `IconDefinition` is a plain data object | TRUE — the widening is sound |
| `prefers-reduced-motion` handled globally | `theme/theme.css:240-247` | TRUE — no gap for a Retry spin |
| OpenSpec artifacts are mechanically clean | `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0 | TRUE |

**Scope discipline check (HEL-528 skeletons / HEL-548 empty-state CTAs / HEL-535 toasts)**
Nothing in `tasks.md` touches skeletons, empty-state CTA copy, or toast policy. The `cta.icon`
widening is plumbing only. `lucide-react` is used for new icons only; the ~30 `variant="text"`
`InlineError` call sites are deliberately untouched. **Scope is clean.**

**Extend-don't-compete check**
No new competing error component is proposed; all three existing primitives
(`InlineError`/`StatusMessage`/`EmptyState`) are extended. **Constraint honored.**

**`aria-live` vs `role="alert"` judgment (asked for explicitly)**
D2's reasoning is **correct** — `role="alert"` carries implicit `aria-live="assertive"` +
`aria-atomic="true"` per WAI-ARIA; adding an explicit `aria-live` would be redundant. Not a gap.
The real a11y gap is elsewhere (CR1).

---

### Verdict: REFUTE

The approach is right — extend the three primitives, one classification helper, per-view wiring —
and the scope discipline is genuinely clean. But three of the ticket's four acceptance criteria
have concrete holes that would surface as defects in execution, not as nits: the full-surface path
**removes** the announcement that exists today (AC3), the panel Retry **cannot recover** given how
`usePanelData` holds its error (AC1), and the 403/404 classification is placed at a layer where the
status code no longer exists (AC2). Each is cheaper to fix here than in an execution cycle.

---

### Change Requests

**1. `EmptyState intent="error"` has no announcement — this is an a11y regression, not a gap**

`EmptyState.tsx:34` renders `<div className={rootClass} aria-label={title}>` — no `role`, no live
region (and `aria-label` on a role-less generic element is not reliably exposed at all). D5 replaces
`<p role="alert">` at `SourcesPage.tsx:48`, `PipelinesPage.tsx:35`, `TypeRegistryPage.tsx:20`,
`PipelineDetailPage.tsx:596` and the `ProposalReviewPage` branch with that component. Five views
that announce their error today would stop announcing it. Ticket AC3 requires "accessible
(aria-live, icon+text)"; DESIGN.md §8 requires it too.

Corroborating mechanical evidence: `PipelinesPage.test.tsx:160` asserts
`screen.getByRole("alert")).toHaveTextContent("Failed to load pipelines.")` — the plan as written
breaks an existing test, and neither `design.md` D3 nor `specs/error-state-pattern/spec.md`
mentions any role.

Required: state in D3 that `intent="error"` renders the state with `role="alert"` (or an explicitly
scoped `role="status"`/`aria-live` region around title+description), add a spec scenario for it, and
add the corresponding task under §1.

Same defect on the other side: `StatusMessage.tsx:12` — the `failed` branch has **no role at all**
today, and D4/task 1.6 do not add one, so `PanelList`'s error stays unannounced after this ticket.

**2. `usePanelData`'s error is never cleared, so Retry cannot recover (breaks the headline AC)**

`usePanelData.ts`:
- `:68` `const [errorForKey, setErrorForKey] = useState<{key,message}|null>(null)`
- `:74-77` `refresh()` resets `prevFetchKey.current` and bumps `refreshToken` — it does **not** clear `errorForKey`
- `:116` `setErrorForKey(...)` in the `.catch()` — nothing clears it on `fulfilled`
- `:215` `const error = errorForKey?.key === currentFetchKey ? errorForKey.message : null;`

So once a fetch fails for key K, `error` stays truthy for key K forever. `PanelContent.tsx:73`
checks `error` before rendering data, so a **successful** retry still renders the error branch.
Ticket AC1 ("a Retry action re-runs the fetch and recovers on success") and the spec scenario
"activating Retry re-runs the fetch, clearing the error state and rendering the data on success"
cannot be met by tasks 2.4/4.1 as written.

Note this is already latent: `PanelCard.tsx:71` `usePanelPolling(refresh, panel.refreshInterval …)`
calls the same `refresh`, so a polled panel that fails once is stuck on the error state today. It
becomes user-visible the moment a Retry button is attached to it.

Required: clear `errorForKey` in `refresh()` and on the fulfilled path, and add a regression test
(fail → retry → success → data renders) to task 5.4.

**3. Panel-data 403/404 classification is placed where the status code no longer exists**

Task 2.4 says `usePanelData.ts` classifies "the `fetchPanelPage` rejection with
`classifyRequestError`". But `panelThunks.ts:429-437` swallows the error in a bare `catch {` (no
binding) and returns `rejectWithValue("Failed to load panel data.")`. By the time
`.unwrap().catch(err)` runs at `usePanelData.ts:116`, `err` is that **string** — `err.response?.status`
is gone. Every panel failure would classify as `kind:"error"`, silently defeating the
permission-denied path that `design.md`'s own Planner Notes name as one of the three realistic
403/404 surfaces.

The same shape applies to `fetchSources` (`sourcesSlice.ts:49` `catch {`) and
`fetchPipelines`/`fetchPipelineById` (`pipelinesSlice.ts:181` `catch {`): classification must move
*inside* the thunk (binding the error), and each thunk's `rejectValue: string` must widen to carry
the kind. D6 ("no slice-shape rewrite") speaks only to slice state and is silent on the
`rejectValue` contract, which is the actual change. Required: state the `rejectValue` shape change
explicitly in D1/D6, or explicitly scope the panel-data path to generic errors only and say so.

**4. `pipelinesSlice` needs two error kinds, and nothing resets `errorKind`**

`pipelinesSlice.ts` carries two independent error fields — `error` (list, `:71`, written only by
`fetchPipelines.rejected` `:393`) and `currentPipelineError` (detail, `:82`, written by
`fetchPipelineById.rejected` `:409`). Task 2.2 adds a single `errorKind` for both thunks. A detail
404 would then set `errorKind="not-found"` and suppress the **list** page's Retry cta (D5 gates the
cta on `errorKind === "error"`).

Second half: `error` is cleared on `pending`/`fulfilled` (`sourcesSlice.ts:137,142`,
`dataTypesSlice.ts:121,126`, `pipelinesSlice.ts:384,389`), but no artifact says `errorKind` resets
with it. A stale kind permanently suppresses Retry. Required: name the per-error-field kind
(`errorKind` + `currentPipelineErrorKind`) and state that each kind is cleared everywhere its
partner `error` field is cleared.

**5. Retry on `PipelineDetailPage` gives no in-flight feedback**

`pipelinesSlice.ts:396-400` — `fetchPipelineById.pending` **deliberately** preserves
`currentPipelineError` ("Preserve currentPipelineError so the UI can keep showing it during a
re-fetch"). `PipelineDetailPage.tsx:593` gates on `currentPipeline === null && currentPipelineError
!== null`, which stays true during the retry. So clicking Retry leaves the identical error surface
on screen with zero acknowledgement until the request resolves. Required: specify the in-flight
affordance (pending → the loading branch, or a disabled/`aria-busy` Retry), for this view and as
the general rule for the pattern.

**6. `ProposalReviewPage`'s "fourth branch" does not exist — it's an edit, and it drops an action**

D5 and task 3.5 say "add a fourth `EmptyState` branch … alongside its existing three". The three
existing branches are `ProposalReviewPage.tsx:124` (nothing to review), **`:133-141` (`loadError` →
`EmptyState title="Couldn't load the workspace"`, cta "Back to dashboards")**, and `:152` (empty
proposal). The fetch-failure branch **already exists** — the work is to modify `:133-141`, not add a
fourth (as written, an executor may add an unreachable duplicate below it).

Two consequences the plan must resolve:
- `EmptyState` supports exactly one `cta` (`EmptyState.tsx:14-18,42-50`). Converting it to Retry
  silently removes the "Back to dashboards" escape from a dead-end route. Say which action wins, or
  add a secondary-action slot. This generalizes: a `forbidden`/`not-found` full-surface state
  renders with **no cta at all** — state explicitly why the surrounding nav is a sufficient escape.
- That fetch is DEV-only (`:55` `const useDemoFixture = IS_DEV && !stateProposal`), so Retry there
  is effectively a dev-path affordance. Worth one sentence so it isn't mistaken for a prod path.
- Task 2.7 names "`ProposalReviewPage.tsx`'s data source" without naming it. It is `fetchDataTypes`
  imported from `dataTypes/services/dataTypeService` (`:8`) — a *different* function from the
  `dataTypesSlice` thunk of the same name in task 2.3. Name it; the collision is a real trap.

**7. No icon-sizing story for the new lucide icons (they will render at 24px)**

`EmptyState.css` sizes icons via `font-size` — `.ui-empty-state--main .ui-empty-state__icon
{font-size: var(--text-2xl)}`, `.ui-empty-state--sidebar … {font-size: var(--text-sm)}`,
`.ui-empty-state__cta-icon {font-size: 0.8em}`. That works for FontAwesome (1em SVG) and has **no
effect** on `lucide-react`, which emits fixed `width`/`height` attributes (default 24). Every
existing lucide call site in this repo passes an explicit size: `SourceDetailPanel.tsx:191`
`size={13}`, `SidebarBody.tsx:338` `size={14}`, `ProposalReview.tsx:142` `size={15}`,
`Sidebar.tsx:48` `size={16}`, `CommandBar.tsx:168` `size={16}`.

As planned, `icon={<AlertTriangle />}` renders 24px in a `sidebar` `EmptyState` that expects 14px,
and `<RotateCw />` renders 24px inside a `--text-sm` cta expecting ~11px. Same problem for
`InlineError`'s banner icon (`.inline-error` is `--text-xs` = 12px; a 24px glyph is double the text
height) and `StatusMessage`'s. Required: specify sizing in D2/D3/D4 — preferably CSS
`width: 1em; height: 1em` on the SVG so it tracks the surrounding `--text-*` token, rather than
adding another literal-px `size={N}` (the exact drift pattern HEL-652/680/677 exist to clean up).

**8. The Retry button recipe is pinned on one surface out of three**

D2 pins `InlineError`'s Retry to §5 Secondary + `--control-sm` + `RotateCw` — good. But D4, task 1.6
and the `StatusMessage` spec requirement say only "a Retry action", with no recipe; and
`EmptyState`'s existing cta is the **Primary** recipe (`EmptyState.css` `.ui-empty-state__cta`:
`--app-accent` / `--app-accent-ink` / `--control-md`). Three surfaces, three unspecified-or-divergent
button treatments is precisely the inconsistency this ticket exists to remove (DESIGN.md §5 "A new
button style is a defect, not a variant"). Required: pin the recipe per surface in `design.md`
(Primary `--control-md` is defensible for the full-surface hero — it's the only action there;
Secondary `--control-sm` for both inline surfaces) and say it deliberately.

**9. The two inline error recipes visibly diverge and the plan never reconciles them**

Both are touched by this ticket and both gain an icon + Retry, but:

| | `.inline-error--banner` (`InlineError.css:9-14`) | `.status-message--error` (`StatusMessage.css:12-16`) |
| --- | --- | --- |
| type | `--text-xs` | `--text-sm` |
| padding | `--space-2` | `--space-3` / `--space-4` |
| border | none | `1px color-mix(--app-error 30%)` |
| wash | `--app-danger-surface` | `--app-error-surface` |
| margin | `margin-top: --space-2` | `margin: 0 0 --space-4` |

DESIGN.md §7 requires every data-backed view handle these states **consistently**; the proposal's own
Why says "one canonical pattern instead of six divergent ones". Shipping two divergent inline
error-banner recipes is a half-done version of the ticket's central claim. Required: converge them
on one recipe (padding, type size, border, icon gap, retry metrics) or record the deliberate reason
they differ. (The wash tokens are *not* drift — `theme.css:129,177` alias `--app-danger-surface` to
`--app-error-surface` — but the border/type/padding differences are real.)

**10. `PanelContent` would end up with nested `role="alert"`, and the layout is unspecified**

`PanelContent.tsx:75` already carries `role="alert"` on the wrapping div; task 4.1 replaces only the
inner `<span>` with `InlineError variant="banner"`, which brings its own `role="alert"` — nested
assertive live regions (double announcement). Say which one survives.

Separately: the current treatment is a centered full-body panel state (`.panel-content--state`
column flex; `.panel-content__state-label` `text-align: center`). An `--text-xs`, `margin-top`-anchored
banner is a materially different look inside a large panel card. Specify the intended layout inside a
panel body — including the small-panel case, where a `--control-sm` button + icon + message will not
fit a 1×1 grid cell.

**11. The permission-denied copy does not match this backend's actual denial signal**

`CONTRIBUTING.md` ("Existence-not-leaked semantics") is explicit: services map a cross-user id to
**404, never 403**; 403 is reserved for a *visible-but-not-permitted* operation (a viewer-grant user
attempting a mutation). So on every read path this ticket wires, an RLS/ACL denial arrives as **404**
and, under D5's copy, renders as "This resource no longer exists." — asserting a deletion that may
not have happened — while the `forbidden` copy ("You don't have access to this resource.") will
essentially never fire on these fetches. The 403→forbidden / 404→not-found *mapping* is right and
worth keeping; the **copy** and the design's framing ("a 403/404 (RLS-denied or missing resource)")
are not.

Required: reword the not-found copy so it is true for both causes without leaking existence — e.g.
"We couldn't find this pipeline. It may have been deleted, or you may not have access." — and record
the existence-not-leaked constraint in `design.md` so the executor doesn't "correct" it in the wrong
direction (or, worse, propose a backend status change, which is out of scope).

---

### Non-blocking notes

- **Dead CSS.** Replacing the hand-rolled `<p>`s orphans `.sources-page__error` (`SourcesPage.css:56`),
  `.pipelines-page__error` (`PipelinesPage.css:27`), `.type-registry-page__error`
  (`TypeRegistryPage.css:29`), `.pipeline-detail-page__error` (`PipelineDetailPage.css:804`). Add a
  cleanup line to tasks §3.
- **Translucent icon chip.** `--app-error-surface` is `color-mix(… , transparent)` (`theme.css:127`),
  while the neutral icon-wrap is opaque `--app-surface` (`EmptyState.css`). Over the dot-grid canvas
  the error chip will show the texture through and read lighter than its neutral sibling. Consider
  `color-mix(in srgb, var(--app-error) N%, var(--app-surface))` to keep it solid. (Not an
  opacity-invariant violation — §3's carve-out covers intent washes — purely a polish call.)
- **Task 4.4 is two-way readable.** `TypeDetailPanel.tsx` has *two* `<p className="type-detail-panel__error">`:
  `:193` (save/edit error) and `:223` (preview/rows-fetch error). Only the latter gets `onRetry`
  (task 2.5 correctly targets `previewError`). Name the state variable in 4.4.
- **No `StatusMessage` unit test.** The spec delta adds two `StatusMessage` scenarios but tasks §5
  adds no test for them, and no `StatusMessage.test.tsx` exists today (`EmptyState.test.tsx` and
  `InlineError.test.tsx` do).
- **Spec placement.** The `StatusMessage` requirement lands in the new `error-state-pattern`
  capability although `openspec/specs/shared-status-message/spec.md` exists — the `InlineError`
  change correctly went to `shared-inline-error`. Stylistic only: `node
  scripts/check-openspec-hygiene.mjs` passes ("openspec/ is clean").
- **Sound calls worth keeping.** The `IconDefinition | ReactNode` widening via `React.isValidElement`
  is the right minimal extension (an FA `IconDefinition` is a plain data object and can never be a
  valid element) — it should *not* go further into a FontAwesome migration, which is HEL-443's job.
  Leaving `variant="text"`'s ~30 call sites untouched is correct. `role="alert"`'s implicit assertive
  live region is the right primitive (D2). The global `prefers-reduced-motion` reset
  (`theme.css:240`) already covers any Retry spin. `main`-variant Fraunces titles are correctly
  preserved under `intent="error"` (§6).

### Environmental note (not a blocker for this verdict)

`scripts/concertino/next-report-number.sh`, `persist-evidence.sh` and `emit-event.sh` are **not
present in the worktree** — only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
`start-servers.sh` are tracked (`git ls-files scripts/concertino/`). The three are untracked/ignored
files that exist only in the main checkout at `/home/matt/Development/helio/scripts/concertino/`. I
invoked them from that absolute path (they take the change directory as an argument, so this is
correct, not a fallback guess). Worth folding the missing scripts into the tracked set so worktree
runs are self-contained.
