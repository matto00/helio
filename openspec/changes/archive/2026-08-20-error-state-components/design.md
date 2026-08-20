## Context

Six views hand-roll their own failed-fetch markup (`SourcesPage.tsx:48`, `PipelinesPage.tsx:35`,
`PipelineDetailPage.tsx:596`, `TypeRegistryPage.tsx:20`, `TypeDetailPanel.tsx:193/223`) — a bare
`<p role="alert">{error}</p>`, no icon, no retry. `PanelContent.tsx`'s error branch is the same shape, and
it has **two** consumers: `PanelCard.tsx` (grid, small cells) and `PanelDetailModal.tsx:355` (modal, both
via `usePanelData`, the latter currently destructuring without `refresh`). `PanelList.tsx`/
`DashboardList.tsx:265` both use `StatusMessage` (loading and failed rendered in the same slot of the same
element — no `role` on failed today). `ProposalReviewPage.tsx:133-141` already renders an `EmptyState` on
its DEV-only demo-fixture fetch failure — an **edit target**, not a new branch; its `loadError` (`:45`)
has exactly one setter (`:65`, in a `.catch`) and no reset anywhere today. `SourceDetailPanel.tsx`'s single
`error` state (`:41`) also has two producers: a real `catch`-derived fetch failure (`:145`) and a
deterministic, non-retryable "Preview is not supported for `<kind>` sources" capability message (`:141`,
hit by 4 of 7 `DataSourceKind` values, including `sql`). No thunk distinguishes 403/404: every touched
thunk's `rejectValue` is a bare `string`, and `panelThunks.ts`'s `fetchPanelPage` swallows the Axios error
in a bare `catch {` (two `rejectWithValue` sites). `services/extractErrorMessage.ts` already exists and is
the policy-correct message helper (never falls through to raw `err.message`); `sourcesSlice.ts`/
`pipelinesSlice.ts` also each have their own differently-behaved local function of the same name, still
used elsewhere, untouched. `CONTRIBUTING.md`: a cross-user read maps to **404**, never 403.

## Goals / Non-Goals

**Goals:** one canonical, visibly-consistent error pattern across the named views, without breaking each
component's own internal state-to-state consistency; a permission-denied/not-found treatment that
structurally cannot render Retry (nor can a deterministic capability limitation that isn't a failure at
all); Retry that provably recovers on every view it appears on, including via a background refetch.

**Non-Goals:** toast policy (HEL-535), skeletons (HEL-528), empty-state CTA copy (HEL-548), backend
error-shape changes, FontAwesome→lucide migration (HEL-443).

## Decisions

**D1 — Classification lives inside the thunk and delegates to the existing message helper.** New
`frontend/src/services/classifyRequestError.ts`: `classifyRequestError(err, fallback): { message: string;
kind: "error"|"forbidden"|"not-found" }` — **calls `services/extractErrorMessage.ts`'s `extractErrorMessage`
for `message`** (adds only the `kind` derivation) — never reimplements it, never falls through to raw
`err.message`. The per-slice local helpers of the same name are untouched; they serve other thunks. Every
touched thunk (`fetchSources`, `fetchPipelines`, `fetchPipelineById`, `fetchDataTypes`, `fetchPanelPage` —
**both** rejection sites) binds its caught error and calls `classifyRequestError` inside its own `catch`,
widening `rejectValue` from `string` to `{message, kind}`. Reducers map `payload.message` into the
existing `error: string` field (unchanged type/JSX) and `payload.kind` into a new, additive `errorKind`
field. `TypeDetailPanel.tsx`'s `previewError` and `ProposalReviewPage.tsx`'s `loadError` call
`classifyRequestError` directly in their own `.catch`.

**D1a — `pipelinesSlice` has two independent error fields; both get an `errorKind`, reset with their
partner.** `error`/`errorKind` (list) clear on `fetchPipelines.pending`/`.fulfilled`.
`currentPipelineError`/`currentPipelineErrorKind` (detail) are **preserved** on `fetchPipelineById.pending`
(existing deliberate behavior, `:396-400`), clear on `.fulfilled`, replaced on `.rejected`.

**D2 — `InlineError` `banner` variant gains `kind`, `onRetry`, `retrying`, `announced`, `retryVariant`.**
`kind?: "error"|"forbidden"|"not-found"` (default `"error"`); every `banner` render pairs a `lucide-react`
icon (`TriangleAlert`/`ShieldOff`/`SearchX` — current name, not the deprecated `AlertTriangle` alias) with
the text, sized `width:1em;height:1em`. This also affects two untouched existing `banner` sites
(`SourceDetailPanel.tsx:208`'s rename error, `EmptySchemaAffordance.tsx:71`) — a strict §8 improvement.
`onRetry` renders a Retry button **only when `kind==="error"`**, suppressed otherwise regardless of whether
`onRetry` was passed — component-enforced, since `retrying` is retry-specific by name (contrast D3). For
`retryVariant="button"` (default) it swaps the visible label to "Retrying…" (mirrors `TypeDetailPanel.tsx`'s
`previewLoading` idiom); for `"icon-only"` (the shared `IconButton`, `variant="secondary"`, `RotateCw`,
`size="xs"`) it swaps `aria-label`/`title` instead (no visible label to swap). `announced?: boolean`
(default `true`) omits `role="alert"` when `false` — `PanelContent.tsx:75`'s wrapper already carries it.
The labeled `"button"` Retry must satisfy the 44px mobile floor at 430/768 (not automatic, must be added,
matching `.ui-empty-state__cta`'s existing pattern). `variant="text"` (~30 form-validation sites) untouched.

**D3 — `EmptyState` gains `intent`, `secondaryCta`, `disabled`, widened icon types — glyph and chip both
go error-tinted.** `intent?: "neutral"|"error"` (default `"neutral"`): icon-wrap uses
`color-mix(in srgb, var(--app-error) 16%, var(--app-surface))` (solid, `main`+`sidebar`,
`EmptyState.css:19-35`/`:62-76`); the glyph (`color: var(--app-accent)` at `:34`/`:75`) is overridden to
`var(--app-error)`; the chip border becomes `1px solid color-mix(in srgb, var(--app-error) 30%,
transparent)`. Root gets `role="alert"`, drops `aria-label={title}` (avoids double-announcing the title —
the live region's content already carries it). `icon`/`cta.icon`/`secondaryCta.icon` widen to
`IconDefinition | ReactNode` (`React.isValidElement` branch, backward-compatible), sized `width:1em;
height:1em`. `secondaryCta` (same shape as `cta`) renders Secondary `--control-md` beside `cta`'s Primary
`--control-md` — needed for `ProposalReviewPage` (D5). `cta`/`secondaryCta` gain `disabled?: boolean`; the
in-flight **label text is caller-supplied** (the caller passes `label: retrying ? "Retrying…" : "Retry"`,
same `TypeDetailPanel.tsx` idiom) — unlike `InlineError.retrying`, `EmptyState` never owns retry-specific
copy, since `cta`/`secondaryCta` remain a generic primitive ~10 neutral empty states also use. Both need
the 44px mobile floor; `secondaryCta`'s button class doesn't inherit `.ui-empty-state__cta`'s automatically.

**D4 — `StatusMessage` gains `onRetry`/`retrying` and a `role`, but does NOT converge its box metrics onto
`InlineError`'s.** `StatusMessage`'s `loading`/`failed` render in the **same slot of the same element**
(`PanelList.tsx:203-206`, `DashboardList.tsx:265`) and are today a matched pair (same box, different
color) — shrinking only `failed` to `InlineError`'s metrics would itself be a new §7 violation, relocated.
Share the **content** recipe only (icon, Retry mechanics, disabled/"Retrying…" idiom, Secondary
`--control-sm` retry button, `role="alert"` on `failed`) — box metrics (`--text-sm`, `--space-3`/`--space-4`
padding, `--app-radius-md`) stay unchanged on both states, so the pairing survives. `TriangleAlert` icon
added, sized `width:1em;height:1em`. `loading`/`idle`/`succeeded` otherwise unaffected.

**D5 — Per-view wiring, in-flight feedback, and one copy recipe.** Full-surface (`EmptyState
intent="error"`): `SourcesPage`, `PipelinesPage`, `PipelineDetailPage`, `TypeRegistryPage`, and an **edit
to** `ProposalReviewPage.tsx:133-141`'s existing branch. For `errorKind==="error"`: `title="Couldn't load
{resource}"` + `description={message}` (sources/pipelines/this pipeline/types/the workspace) — `cta` =
Retry, `disabled` on that view's in-flight signal (`status`/`currentPipelineStatus==="loading"`, or a
local `retrying` for `ProposalReviewPage`); `ProposalReviewPage`'s retry additionally clears
`loadError`/`loadErrorKind` when it starts (today's single `.catch`-only setter never resets them, so a
successful retry would otherwise still render the stale error — see Context). For `forbidden`/`not-found`,
D7's copy, no `cta`; `ProposalReviewPage` always keeps `secondaryCta` = "Back to dashboards" (DEV-only
fetch). Inline (`InlineError variant="banner"` + `onRetry`): `PanelContent`'s two consumers — `PanelCard`
(`retryVariant="icon-only"`) and `PanelDetailModal.tsx:77/355` (`retryVariant="button"`; add `refresh` to
its destructure) — both `announced={false}`; `TypeDetailPanel`'s `previewError` only (save/rename errors
stay out of scope); `SourceDetailPanel`'s `previewError` per D5a below. Both detail panels keep their
unrelated "Preview"/"Reload" button alongside the new Retry — deliberate (D5's pattern consistency
outweighs deduplicating a differently-scoped control). `StatusMessage` + retry: `PanelList`.

**D5a — `SourceDetailPanel`'s preview state splits into two, only one retryable.** The capability message
(`:141`, "Preview is not supported for `<kind>` sources") is not a failure and must never carry Retry.
Split the current single `error` into `previewError` (the `catch` at `:145`, `onRetry` wired per D5) and
`previewUnsupported` (the `:141` message, rendered via `InlineError variant="banner" kind="error"` with
**no** `onRetry` ever passed). Both clear at the top of `handlePreview()`, mirroring today's one
`setError(null)`.

**D6 — `usePanelData`'s stored error must clear on retry AND on a background refetch succeeding.**
`refresh()` (`:74-77`) clears `errorForKey` eagerly. Separately, `markDataTypeRowsStale`
(`panelActions.ts:20`) deletes the pagination entry and the effect's dedupe-guard bypass at `:88` refetches
**without** going through `refresh()` — so the fetch promise chain itself must also clear `errorForKey` on
**fulfillment** (a `.then()` before the existing `.catch()`). `errorForKey` becomes `{key, message, kind}`.

**D7 — Permission-denied/not-found copy must not assert a fact the backend doesn't guarantee.** Per
`CONTRIBUTING.md`'s existence-not-leaked semantics, a cross-user read maps to **404**, not 403, so
`not-found` copy must be true under both causes: "We couldn't find this &lt;resource&gt;. It may have been
deleted, or you may not have access to it." `forbidden` — "You don't have access to this &lt;resource&gt;."
— is kept for a future mutation path, though it won't fire on this ticket's read-only fetches. Neither
renders `cta`/`onRetry` (D2/D3 enforce this structurally); nor does D5a's `previewUnsupported`.

## Risks / Trade-offs

- [Nine-plus call sites raises review surface] → every full-surface site follows one D5 recipe verbatim.
- [`StatusMessage`/`InlineError` sharing content but not box metrics] → D4 states why explicitly, not an
  oversight; [`ProposalReviewPage`'s Retry only exercises a DEV-only fixture path] → acceptable, stated.

## Planner Notes

- Self-approved: `EmptyState.secondaryCta`, `InlineError.retryVariant`/`announced`, `PanelContent` taking a
  `retryVariant` prop from its two consumers, and `SourceDetailPanel`'s `previewError`/`previewUnsupported`
  split are small, additive changes required to resolve concrete skeptic findings without dropping an
  existing affordance, breaking layout, or shipping a Retry button that can never succeed.
- Self-approved: `TriangleAlert` (not the deprecated `AlertTriangle` alias) everywhere; moved
  `StatusMessage`'s requirements to the existing `shared-status-message` capability delta (mirrors
  `shared-inline-error`) — spec-placement consistency, no behavior change.
