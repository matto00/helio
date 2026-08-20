## Why

Error handling is inconsistent across the app: `SourcesPage`, `PipelinesPage`, `PipelineDetailPage`, and
`TypeRegistryPage` each hand-roll a near-identical `<p className="...error" role="alert">{error}</p>`, none
offer retry, `PanelContent`'s per-panel error box is text-only despite `usePanelData` already exposing an
unused `refresh()`, and no surface distinguishes a 403/404 (RLS-denied or missing resource) from a generic
failure. `DESIGN.md` §7 requires a visible, human-readable, intent-error state with retry on every
data-backed view; this ticket delivers that as one canonical pattern instead of six divergent ones.

## What Changes

- Extend `InlineError`'s `banner` variant with a `kind` (`error`/`forbidden`/`not-found`) and optional
  `onRetry`; icon+text always paired, retry never rendered for `forbidden`/`not-found` (no retry-spam).
- Extend `EmptyState` with an `intent` (`neutral`/`error`) prop for full-surface failed-fetch states, and
  widen `icon`/`cta.icon` to accept a `ReactNode` (lucide) alongside the existing FontAwesome
  `IconDefinition`, so new error/retry icons use `lucide-react` without touching existing call sites.
- Add `classifyRequestError` (services/) deriving `{ message, kind }` from a failed request/thunk.
- Wire retry through `PanelContent`/`PanelList`, `SourcesPage`/`SourceDetailPanel`,
  `PipelinesPage`/`PipelineDetailPage`, `TypeRegistryPage`/`TypeDetailPanel`, and `ProposalReviewPage`,
  each rendering the shared error/permission-denied state instead of its own markup.

## Capabilities

### New Capabilities

- `error-state-pattern`: canonical error/retry/permission-denied UI pattern (`EmptyState` `intent="error"`,
  `StatusMessage` retry, per-view wiring and recovery behavior) applied consistently across the views above.

### Modified Capabilities

- `shared-inline-error`: adds the banner `kind`/`onRetry`/`announced`/`retryVariant` requirements above.
- `shared-status-message`: adds an alert role, icon, and `onRetry` to the `failed` state.

## Non-goals

- Toast policy (HEL-535) and skeleton loaders (HEL-528) — separate tickets in the same epic.
- Backend error-shape changes — consume `{error}`/`{message}` and HTTP status as returned today.
- Empty-state CTA content changes (HEL-548) beyond the new `intent`/icon plumbing this ticket needs.

## Impact

`frontend/src/shared/chrome/InlineError.tsx`, `frontend/src/shared/chrome/StatusMessage.tsx`,
`frontend/src/shared/ui/EmptyState.tsx`, a new `frontend/src/services/classifyRequestError.ts`, the
touched slices' fetch thunks (`sourcesSlice`, `pipelinesSlice`, `dataTypesSlice`, panel data fetch path),
and the view files named above. No backend or schema changes.
