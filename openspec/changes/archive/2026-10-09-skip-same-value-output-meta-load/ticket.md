# HEL-1380: useOutputMeta queues a same-value setIsLoading(true) on mount → redundant render (two copies per PanelCard)

## Description

origin_kind: followup
origin_ticket: HEL-1215

HEL-1215's probe-confirmed root cause: on mount, `frontend/src/features/panels/hooks/useOutputMeta.ts` queues a microtask that calls `setIsLoading(true)` while `isLoading` is already `true`. It runs twice per card (PanelCardBody and PanelCard each call the hook). React bails out of the commit but still re-invokes the component once, and outside act it schedules that on the real Scheduler. HEL-1215 fixed the test that flaked on it, but the redundant render also happens in production. It's harmless, but it's wasted work on every panel mount.

## Acceptance criteria

* Skip the update when the value is unchanged (or restructure so no mount-time same-value set is queued).
* Render-count test proving one fewer PanelCardBody render on mount, red before and green after.
* No behaviour change in loading states (existing useOutputMeta and PanelCard tests pass).
* Sequence after HEL-1365 (PanelCard split), which touches the same area.

## Premise validation (orchestrator, 2026-10-09, origin/main ecaa1a53)

Verdict: minor-staleness. HEL-1392 (586da928) rewrote the hook around a shared cache; the
same-value `setIsLoading(true)` microtask still fires on every cache-MISS mount (initial state is
`isLoading = cache miss`, and the effect queues `setIsLoading(true)` exactly when cache miss).
Cache-HIT mounts no longer queue it. The `outputId === null` branch also queues same-value
`setOutput(null)`/`setIsLoading(false)` on mount. HEL-1365 is merged (0ebc784b). After the
HEL-1365 split the hook is called from PanelCardBody plus PanelCard-side hooks
(`usePanelCardInspect`, `usePanelRunRefresh`), so "two copies per card" is approximately but not
literally current.
