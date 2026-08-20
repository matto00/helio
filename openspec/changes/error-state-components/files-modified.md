## Shared primitives

- `frontend/src/services/classifyRequestError.ts` — new. Derives `{ message, kind }` from a failed
  request; `message` delegates to `extractErrorMessage`, `kind` maps 403→forbidden/404→not-found/else→error.
- `frontend/src/services/classifyRequestError.test.ts` — new unit tests (task 5.4).
- `frontend/src/shared/chrome/InlineError.tsx` / `.css` — `banner` variant gains `kind`, `onRetry`,
  `retrying`, `announced`, `retryVariant`; icon+text pairing; exports `ERROR_KIND_ICON` (reused by the
  full-surface views below).
- `frontend/src/shared/chrome/InlineError.test.tsx` — new coverage for the above (task 5.1).
- `frontend/src/shared/ui/EmptyState.tsx` / `.css` — `intent="error"` (alert role, error-tinted
  icon-wrap/glyph, no aria-label), `secondaryCta`, `cta`/`secondaryCta.disabled`, widened
  `icon`/`cta.icon`/`secondaryCta.icon` to `IconDefinition | ReactNode`.
- `frontend/src/shared/ui/EmptyState.test.tsx` — new coverage for the above (task 5.2).
- `frontend/src/shared/chrome/StatusMessage.tsx` / `.css` — `onRetry`/`retrying`, `role="alert"` +
  icon on `failed`, box metrics unchanged (paired with `loading`).
- `frontend/src/shared/chrome/StatusMessage.test.tsx` — new file (task 5.3), includes a static CSS
  assertion that `.status-message--error` never redeclares padding/font-size/border-radius.

## Thunk/state wiring

- `frontend/src/features/sources/state/sourcesSlice.ts` / `.test.ts` — `fetchSources` classifies via
  `classifyRequestError`; adds `errorKind`.
- `frontend/src/features/pipelines/state/pipelinesSlice.ts` / `.test.ts` — `fetchPipelines` →
  `errorKind`; `fetchPipelineById` → `currentPipelineErrorKind` (preserved through `pending`, per D1a).
- `frontend/src/features/dataTypes/state/dataTypesSlice.ts` / `.test.ts` — `fetchDataTypes` →
  `errorKind`.
- `frontend/src/features/panels/state/panelThunks.ts` — `fetchPanelPage` classifies at both rejection
  sites (the unbound-panel guard and the fetch `catch`).
- `frontend/src/features/panels/hooks/usePanelData.ts` / `.test.ts` — `errorForKey` becomes
  `{key, message, kind}`; `refresh()` clears it eagerly; a new `.then()` also clears it on any
  fulfillment (covers the `markDataTypeRowsStale` background-refetch path — D6). Exposes `errorKind`.
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx` — `previewError`/`previewErrorKind` via
  `classifyRequestError`.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` / `.test.tsx` — `handlePreview()` splits
  into `previewError` (retryable) and `previewUnsupported` (the capability-limitation message, never
  retryable — D5a).
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — `loadError`/`loadErrorKind` via
  `classifyRequestError`; adds a `retryToken`/`retrying` pair so Retry re-triggers the load effect and
  clears the stale error when it starts.
- `frontend/src/features/dashboards/ui/ProposalReviewPage.demoFixture.test.tsx` — new file; the
  DEV-only demo-fixture path needs its own local `IS_DEV=true` mock, isolated from the rest of the
  feature's test suite (which relies on the global `IS_DEV=false` mock).

## Full-surface view wiring

- `frontend/src/features/sources/ui/SourcesPage.tsx` / `.css` / `.test.tsx` — `EmptyState
  intent="error"` replaces the hand-rolled `<p>`; dead CSS removed.
- `frontend/src/features/pipelines/ui/PipelinesPage.tsx` / `.css` / `.test.tsx` — same pattern.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` / `.css` / `.test.tsx` — same pattern
  for the `currentPipeline === null` branch; new 403/404 regression tests (task 5.6).
- `frontend/src/features/dataTypes/ui/TypeRegistryPage.tsx` / `.css` / `.test.tsx` — same pattern.

## Inline view wiring

- `frontend/src/features/panels/ui/PanelContent.tsx` / `.css` / `.test.tsx` — error branch renders
  `InlineError variant="banner" announced={false}`; new `errorKind`/`onRetry`/`retrying`/`retryVariant`
  props.
- `frontend/src/features/panels/ui/PanelCard.tsx` / `.test.tsx` — wires `onRetry={refresh}`,
  `retryVariant="icon-only"`.
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — adds `refresh` to its `usePanelData()`
  destructure; wires `onRetry={refresh}`, `retryVariant="button"`.
- `frontend/src/features/panels/ui/PanelDetailModal.errorRetry.test.tsx` — new file (button-retry
  consumer, task 5.5).
- `frontend/src/features/panels/ui/PanelList.tsx` — wires `onRetry`/`retrying` to its `StatusMessage`
  call, re-dispatching `fetchPanels` for the selected dashboard.

## Test-only updates for the new `errorKind`/`{message,kind}` shapes

- `frontend/src/features/panels/ui/MobilePanelStack.test.tsx`,
  `frontend/src/features/panels/ui/PanelDetailModal.panelSwitch.test.tsx` — added `errorKind: null` to
  mocked `usePanelData()` return values (now a required field).

## Final-gate round 1 fixes (skeptic-final-1.md)

- `frontend/src/shared/ui/EmptyState.css` — CR1: `.ui-empty-state__icon svg` / `.ui-empty-state__cta-icon
  svg` gain `display: block`, fixing a ~3px optical vertical offset on the ReactNode (lucide) icon path
  (a `<span>` wrapper's inline formatting context reserved descender space the FontAwesome path never
  had). Scoped as a descendant selector so the FontAwesome path is untouched — re-measured via
  `getBoundingClientRect()` against the running app: `offsetY: 0` on both the fixed error-intent state
  and an existing neutral FontAwesome state.
- `frontend/src/shared/chrome/SidebarItemList.tsx` / `.test.tsx` — CR2: the `status === "loading"`/
  `error` branches now render through `StatusMessage` (matching `DashboardList.tsx`'s sibling Dashboards
  section exactly) instead of a bare `<p role="alert">` with no error signal. No Retry added (none of
  this component's five callers wire a re-dispatchable fetch through it).
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — non-blocking note: the "Click Preview…"
  hint is now suppressed when `previewUnsupported` is set (it contradicted the capability-limitation
  message directly above it).
