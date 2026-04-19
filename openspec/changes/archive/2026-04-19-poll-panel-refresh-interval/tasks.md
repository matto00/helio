## 1. Frontend

- [x] 1.1 Create `frontend/src/hooks/usePanelPolling.ts` — hook that accepts a `refresh` callback, `refreshInterval`, and `typeId`; sets up `setInterval`, handles `visibilitychange` pause/resume, and clears on unmount
- [x] 1.2 Expose a `refresh` callback from `usePanelData` that resets `prevFetchKey.current` so the existing `useEffect` re-fires on the next tick
- [x] 1.3 Call `usePanelPolling` from the component that calls `usePanelData`, passing the panel's `refreshInterval`, `typeId`, and the `refresh` callback

## 2. Tests

- [x] 2.1 Write unit tests for `usePanelPolling`: interval fires at correct cadence, clears on unmount, clears when `typeId` is null, pauses on visibility-hidden, resumes on visibility-visible without stacking intervals
- [x] 2.2 Update `usePanelData` tests to cover the new `refresh` callback (resets fetch key and triggers re-fetch)
