## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Ticket: HEL-539 · Change: `error-state-components` · Gate: design
Round 4 is a **human-authorized extra round** beyond the nominal `SKEPTIC_DESIGN_ROUNDS` budget (3).

### What I verified (with evidence)

Cold re-derivation from ground truth on this worktree's HEAD (`b048364a`, branch
`feature/error-state-components/HEL-539`, change dir untracked). I re-opened every file the
artifacts cite and re-derived every claim myself; the round-1/2/3 reports and the orchestrator's
revision summary were read as **claims**, and every line number below was re-checked by opening the
file, not carried over.

**Artifacts read in full (current revision)**
`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/error-state-pattern/spec.md`,
`specs/shared-inline-error/spec.md`, `specs/shared-status-message/spec.md`, `workflow-state.md`.

**Binding standards re-read**: `DESIGN.md` §3 (control heights `--control-sm` 28px / `--control-md`
32px, literal 44px mobile tap floor), §5 (Primary/Secondary recipes, `IconButton` variants/sizes,
required `aria-label`, `title`-defaults-to-`aria-label`), §6 (reuse the `shared/ui/` primitives),
§7 (loading/empty/error handled **consistently**, never swallow a failed fetch — `[judgment]`),
§8 (accessible names, color never the sole carrier); `CONTRIBUTING.md` (incl. `:60`
existence-not-leaked semantics).

**Mechanical gates I ran myself** (`/usr/bin/openspec`; `npx openspec` is not resolvable in this
worktree — not a defect, the binary is global):
- `openspec validate --changes error-state-components` → `✓ change/error-state-components`,
  `1 passed, 0 failed`, exit 0.
- `openspec validate --changes error-state-components --strict` → same, exit 0.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.
- `openspec/specs/` contains `shared-inline-error` and `shared-status-message` (so the proposal's
  "Modified Capabilities" framing is accurate) and does **not** contain `error-state-pattern`
  (correctly declared new).

**Ground-truth re-verification of every citation load-bearing for this round's three fixes**

| Claim in the artifacts | Ground truth I opened | Result |
| --- | --- | --- |
| `SourceDetailPanel` single `error` state at `:41` | `useState<string \| null>(null)` at `:41` | exact |
| unsupported-kind setter at `:141`, `catch` setter at `:145`, both cleared by one `setError(null)` at `:126`, `handlePreview` at `:124`–`:150` | verified verbatim | exact (task 2.7 writes the range as `:124-149`; the closing brace is `:150` — cosmetic) |
| single `InlineError variant="banner"` preview call site at `:240`; unrelated rename banner at `:208` | verified | exact |
| "4 of 7 `DataSourceKind` values, incl. `sql`" | `dataSource.ts:10` = `csv \| rest_api \| sql \| static \| text \| pdf \| image`; supported branches are `csv`/`static`/`rest_api` | exact (4 unsupported: `sql`, `text`, `pdf`, `image`) |
| preview services throw raw Axios errors (so 403/404 classification is possible) | `dataSourceService.ts:244-258` — no wrapping | exact |
| `ProposalReviewPage` `loadError` `:45`, sole setter in the `.catch` `:64-66`, effect `:57-70`, error branch `:133-141`, existing `cta` = "Back to dashboards" | verified; `loadError` appears only at `:45/:65/:133/:138` | exact (task cites the effect as `:58-70`; `useEffect(` is `:57` — cosmetic) |
| the fall-through after clearing `loadError` | `proposal` (`:78-82`) is `null` in demo mode until `dataTypes` loads, so `:145`'s `aria-busy` loading placeholder renders — no half-rendered review | verified, clean |
| `TypeDetailPanel` caller-side label idiom cited by task 1.6 | `:219` `{previewLoading ? "Loading…" : …}` with `disabled={previewLoading}`; `error` `<p>` at `:191-195`, `previewError` `<p>` at `:221-225` | exact |
| `EmptyState` today: `aria-label={title}` `:34`, no `role`, `cta` = `{label,onClick,icon?}` | verified | exact |
| `EmptyState.css` main wrap `:19-30` + glyph `--app-accent` `:34`; sidebar wrap `:62-70` + glyph `:75` | verified | exact |
| D4's "don't converge box metrics" rests on `StatusMessage.css` | `.status-message` `:1-9` = `--space-3`/`--space-4` padding, `--app-radius-md`, `--text-sm`; `--error` overrides **colors only** (`:11-15`); `PanelList.tsx:203-206` and `DashboardList.tsx:265` both render loading/failed in one slot | exact — D4's rationale is factually correct |
| `usePanelData` `refresh` `:74-77`, HEL-242 dedupe bypass, promise `.catch` setting `errorForKey` | verified verbatim | exact |
| `fetchPanelPage`'s two rejection sites (`:427` guard, `:435-437` catch), `rejectValue: string` | verified | exact |
| `pipelinesSlice` preserves `currentPipelineError` on `pending` (`:395-399` comment), clears on fulfilled, replaces on rejected; list pair clears on pending/fulfilled | verified; `sourcesSlice` `:135-147` identical shape | exact — D1a is right |
| `PanelDetailModal.tsx:77` destructures without `refresh`; `PanelCard.tsx:69-70` has it; `PanelContent.tsx:73-77` wrapper carries `role="alert"` | verified | exact |
| view error branches `SourcesPage:48`, `PipelinesPage:35`, `TypeRegistryPage:20`, `PipelineDetailPage:596` | verified | exact |
| `PipelinesPage.test.tsx:159-160` `getByRole("alert")` + `toHaveTextContent("Failed to load pipelines.")`; the mock rejects a **plain** `Error` | verified — with `classifyRequestError` delegating to `extractErrorMessage` (which only reads Axios bodies) the fallback string is preserved and `kind` is `"error"`, so the assertion still passes and the Retry CTA still renders | exact |
| `extractErrorMessage(err, fallback)` signature D1 delegates to | `services/extractErrorMessage.ts:17` — exact signature, never falls through to `err.message` | exact |
| D7's copy rationale | `CONTRIBUTING.md:60` — cross-user reads map to 404, never 403; 403 reserved for visible-but-not-permitted **mutations** | exact |
| `IconButton` `size="xs"` (24px) exists and every `.ui-icon-btn` gets `min-width/height: 44px` under `max-width: 768px` (`IconButton.css:40-44`, `:98-105`) | verified | exact — the icon-only Retry meets §3's mobile floor automatically |
| tokens for light/dark parity | `theme.css` defines `--app-error` (`#f07561` dark / `#c73a2a` light), `--app-surface`, `--app-surface-raised` in both blocks; `--app-error-surface` is **translucent**, so D3's solid `color-mix(… var(--app-surface))` is the correct choice | exact |

---

### Round-3 change requests — resolution status (re-derived, not taken on trust)

**CR1 — `SourceDetailPanel` Retry attached to a non-retryable capability message. GENUINELY RESOLVED.**
`design.md:104-109` adds **D5a** splitting the single `error` into `previewError` (the `:145`
`catch`, `onRetry`-wired) and `previewUnsupported` (the `:141` message, "never `onRetry`"), both
cleared at the top of `handlePreview()` — which matches the real code (one `setError(null)` at
`:126`, two producers, one render site). `tasks.md` 2.7 specifies the state split and explicitly
says the unsupported string is **not** run through `classifyRequestError` ("it isn't a caught error
at all") — correct, since there is no error object there. `tasks.md` 4.3 turns the single `:240`
call site into two mutually-exclusive renders with **no `onRetry`** on the capability branch.
`specs/error-state-pattern/spec.md:87-100` adds a durable requirement ("A deterministic capability
limitation is never presented as a retryable error") with **two** scenarios covering both the
no-retry case and the still-retryable real-failure case on the same surface. `tasks.md` 5.7 is a
dedicated regression test naming `sql` explicitly. The round-3 instruction ("do not leave the
choice implicit") is satisfied: the split is the stated choice, and the retained `kind="error"`
visual treatment is written down rather than defaulted into. No contradiction with the "Named views
… on a fetch failure" requirement, which is scoped to fetch failures.

**CR2 — `ProposalReviewPage`'s Retry could not recover. GENUINELY RESOLVED.**
`design.md:93-95` (D5) and `tasks.md` 2.8 both require the retry to `setLoadError(null)` /
`setLoadErrorKind(null)` **when it starts**, with the reason recorded (single `.catch`-only setter,
stale error at `:133`). `tasks.md` 5.5 now names `ProposalReviewPage` explicitly as a regression
test that "a successful retry actually clears `loadError` and renders the proposal, not the stale
error". I traced the resulting render path in the real file: clearing `loadError` drops through
`:133`, `proposal` is still `null` (`:78-82`), so `:145`'s `aria-busy` loading placeholder renders —
error → spinner → proposal (or a fresh error). Correct, and better than keeping a stale error under
a disabled button.

**CR3 — `EmptyState` disabled/label-swap ownership contradiction. GENUINELY RESOLVED AND SWEPT.**
I grepped the entire change dir for `swap` / `Retrying` / `disabled` / `label`. Every surviving
mention agrees on caller-side for `EmptyState` and component-side for `InlineError`:
`design.md:73-77` ("the in-flight **label text is caller-supplied** … unlike `InlineError.retrying`,
`EmptyState` never owns retry-specific copy"), `tasks.md` 1.6 (same, plus an explicit "Contrast
`InlineError.retrying` in 1.2/1.3, which IS component-owned"), `tasks.md` 5.2 (asserts the
caller-supplied label, "not a component-owned label swap"), and
`specs/error-state-pattern/spec.md:46-64` — one requirement that now states both ownerships side by
side with a dedicated scenario each. No contradictory wording survives anywhere. The chosen
resolution (caller-side) is the one I recommended and is the right one: `cta` stays a generic
primitive that ~10 neutral empty states share, and it matches `TypeDetailPanel.tsx:219`'s existing
in-repo idiom, which I re-read.

### Did this revision introduce anything new? — I looked specifically

- **Task renumbering is clean.** The old 5.7 (light/dark spot-check) became 5.8 and lint/test 5.9;
  nothing was dropped. Every internal cross-reference (`5.2→1.6`, `5.5→2.8`/`2.5`, `5.7→2.7`/`4.3`,
  `4.3→2.7`, `4.1→2.5`, `2.8→2.3`) resolves to the right task.
- **No AC lost coverage.** I traced all four ticket ACs to tasks/spec requirements; nothing in the
  revision narrowed an existing commitment.
- **No new scope drift.** Still no skeletons (HEL-528), no toast policy (HEL-535), no empty-state
  copy changes (HEL-548), no FontAwesome→lucide migration (HEL-443); `secondaryCta` remains the one
  declared self-approval and exists only to avoid *dropping* an existing affordance.
- **One round-3 non-blocking note was silently fixed** (`design.md`'s wrong count of local
  `extractErrorMessage` helpers is gone); the rest remain open and are restated below as notes.
- The only genuinely new artifact wrinkles I found are listed as non-blocking notes 1–3 below. None
  changes behavior, none blocks implementation, and I could not construct a user-visible defect from
  any of them.

### UI/UX judgment I applied beyond the checklist

- **Extend-don't-compete is now concretely verified, not asserted.** `SourcesPage.tsx:62-72` already
  renders `EmptyState variant="main"` for its zero-sources state on the same page, so the error
  state will land as a *sibling* of an existing hero with identical geometry — the strongest form of
  cross-surface consistency, and it confirms "full-surface" is the right classification for these
  views rather than a narrow-column mismatch.
- **D4 is the sophisticated §7 reading, and the CSS proves it.** `loading` and `failed` share one box
  and differ only in color tokens; converging only `failed` onto `InlineError`'s smaller metrics
  would relocate the inconsistency into a state transition the user actually watches.
- **Intent tokens are correct for light *and* dark by construction** — the chip mixes `--app-error`
  against an opaque surface rather than stacking on the already-translucent `--app-error-surface`,
  and both tokens are theme-scoped, so parity is token-derived rather than hand-tuned.
- **Hierarchy/accessibility**: Primary Retry + Secondary "Back to dashboards" satisfies §5's single
  primary; `role="alert"` with the `aria-label` dropped avoids a double announcement; icon+text
  everywhere satisfies §8's "color is never the sole carrier"; the icon-only Retry inherits the 44px
  mobile floor from `IconButton.css` and cannot ship without an `aria-label` (compile-time).
- **Copy**: one recipe ("Couldn't load {resource}" + backend message), sentence case, no blame, and
  a `not-found` string that is true under both of its causes — which I verified against
  `CONTRIBUTING.md:60` rather than accepting the design's paraphrase.

---

### Verdict: CONFIRM

All three round-3 change requests are genuinely resolved — I re-derived each from the code rather
than the revision summary, and each fix is substantive (a state split with its own spec requirement
and regression test; an explicit reset with a regression assertion; a one-way ownership decision
swept through four artifacts). Both mechanical gates pass. Every code citation I checked is accurate
on HEAD. **I found no new blocking defect** — nothing in this revision instructs an implementer to
build something wrong, and I could not construct a user-visible failure from any remaining item.

The notes below are explicitly **non-blocking**: they are polish, precision, and carried-over
round-3 nits that were correctly out of scope for this round's authorized fixes. None of them should
gate Execution, and none is a restatement of an unfixed CR.

### Non-blocking notes

*New this round (artifact wrinkles created by the revision — cosmetic, no behavior impact):*

1. **The in-flight `disabled`/"Retrying…" state is unobservable on 4 of the 5 full-surface views.**
   `SourcesPage`/`PipelinesPage`/`TypeRegistryPage` gate their error branch on `status === "failed"`,
   so the instant Retry dispatches, `pending` flips status to `"loading"` and the `EmptyState`
   unmounts; `ProposalReviewPage` now clears `loadError` at retry start (the CR2 fix), which unmounts
   it too. The `disabled` prop is genuinely needed for `PipelineDetailPage` (D1a deliberately
   *preserves* `currentPipelineError` through `pending`, so there it is reachable and useful) — so
   task 1.6 stays. But tasks 3.1/3.2/3.4/3.5's per-view `disabled` wiring is belt-and-braces at best.
   Harmless; worth knowing so the executor doesn't spend effort testing a state that cannot render.
2. **`ProposalReviewPage`'s new local `retrying` flag has no specified reset.** Task 2.8 introduces it
   for the disabled state but never says to clear it on settle. Given note 1 it is unobservable
   either way, but if it is kept, it should be set `false` in **both** the `.then()` and the
   `.catch()` — otherwise a *failed* retry would leave a permanently disabled Retry button. Flagging
   the shape, not asserting the bug: this is brand-new state the implementer owns end-to-end in the
   same task, unlike CR2's pre-existing never-reset `loadError`.
3. **`design.md:56`'s rationale clause is mis-attached.** "…suppressed otherwise regardless of whether
   `onRetry` was passed — component-enforced, since `retrying` is retry-specific by name (contrast
   D3)" welds D3's *label-ownership* rationale onto the *kind-suppression* rule, which has nothing to
   do with `retrying`'s naming. The rule itself is unambiguous and the `shared-inline-error` spec
   states it cleanly, so this is wording only.

*Testability / precision:*

4. **Task 5.2 asks `EmptyState.test.tsx` to assert intent styling (icon-wrap background, border, glyph
   color).** Those live in `EmptyState.css` and jsdom computes none of them. The in-repo precedent
   sits in the same directory — `EmptyState.css.test.ts` reads the CSS source and brace-matches
   `@media` blocks (written for exactly this reason for the 44px floor). The RTL test can assert the
   `intent` class/`role`/`aria-label`; the color and the new `secondaryCta` 44px floor belong in the
   CSS-source test.
5. **`StatusMessage`'s `retrying` prop appears in D4 and task 1.7 but in no spec requirement**
   (`shared-status-message` covers only `role`, icon, and `onRetry`). Ownership is unambiguous by
   construction there (the prop is named `retrying`, like `InlineError`'s), so this is a spec
   completeness nit, not a contradiction.
6. **Task 2.5 never says where `errorForKey`'s `message`/`kind` come from.** `usePanelData.ts:113-117`
   currently hard-codes `"Failed to load data."` and discards the rejection; with `.unwrap()` the
   thunk's `rejectValue` is what the `.catch` receives, so the intent is clear from 2.4 + 2.5
   together — one clause would remove the last inch of ambiguity.

*Design polish (judgment, all minor):*

7. **The `sidebar` intent-error chip changes its base token.** Task 1.5 mixes against
   `var(--app-surface)` on both variants, but the neutral `sidebar` chip uses
   `--app-surface-raised` (`EmptyState.css:67`). One-word fix if the sidebar error variant ever gets
   a call site — this change appears to have none.
8. **`ProposalReviewPage`'s `forbidden`/`not-found` state renders only a Secondary button** (no `cta`,
   `secondaryCta` = "Back to dashboards"), while its sibling "Nothing to review" state renders the
   same action as Primary. DEV-only surface, so cosmetic — but promoting the back action to `cta`
   when there is no Retry would keep the emphasis consistent across the page's own states.
9. **The capability message keeps `kind="error"` styling** (⚠ + error tint) for something that is not
   a failure. This preserves today's treatment and is now an explicit, recorded decision, which is
   what I asked for — but an informational treatment ("Preview isn't available for SQL sources", no
   warning glyph) would read better. Optional; adding an `info` kind would be scope creep.
10. **`retryVariant="icon-only"` uses `IconButton size="xs"`**, which `DESIGN.md` §5 scopes to "the
    dense-row exception — inline row actions in lists". Defensible in a small grid cell and the
    mobile floor still applies, but `sm` (the default) is the by-the-book size; worth a glance at the
    final UI gate.

*Carried over from round 3, still open and still non-blocking:*

11. **No `title`/`description` split is specified for `forbidden`/`not-found` on the full-surface
    views.** `EmptyState` requires both props; D7 supplies one sentence per kind. The natural split is
    obvious and one implementer writes all five, so divergence risk is low.
12. **No icon is named for `EmptyState intent="error"`.** `icon` is required; D2 pins the kind→glyph
    mapping only for `InlineError`. One sentence ("full-surface error states reuse D2's mapping")
    would close it.
13. **`specs/error-state-pattern/spec.md:33` still uses `icon={<AlertTriangle />}`** — the deprecated
    lucide alias the design's own Planner Note self-approves *against*. Illustrative only, but the
    spec is the durable artifact.
14. **Two dead-CSS citations point at a grouped selector.** `.sources-page__error` occupies both a
    grouped rule (`SourcesPage.css:55-60`, shared with `.sources-page__loading`) and a standalone one
    (`:62-64`); `.type-registry-page__error` is identical (`:28-33` / `:35-37`). Tasks 3.1/3.4 cite
    only the first line of each — deleting "line 56" naively leaves a dangling `.sources-page__loading,`
    selector, silently killing the loading style. `PipelinesPage.css:27` and `PipelineDetailPage.css:804`
    are standalone and correctly cited.
15. **`PanelList`'s `StatusMessage` retry is not kind-gated.** `fetchPanels` (`panelThunks.ts:61-65`)
    keeps a bare-string `rejectValue` and is not in tasks 2.1-2.8, so a 404 there renders a Retry that
    cannot succeed — structurally the same shape as round-3 CR1 but far rarer (requires the dashboard
    to disappear mid-session) and the spec deliberately scopes the no-retry rule to
    `EmptyState`/`InlineError`. I re-examined this on its own merits rather than inheriting round 3's
    rating and reached the same conclusion: record it as a scope decision in D4/D5 rather than expand
    the change.
16. **`DashboardList` gets no Retry** even though it renders the same `StatusMessage` in the same slot
    as `PanelList`. Correct scope discipline (the ticket's view list omits it), but it leaves a
    visible asymmetry inside the very component being upgraded — worth one recorded sentence, or a
    trivial follow-up.
