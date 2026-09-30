## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 3dea0b855c7140c86efd94d0d09d838d2d72c0fa against live base 9d14a9a9.

### What I verified (with evidence)
- Diff read: usePanelData, useCrossFilterServerOps, useCrossFilterAnnouncement, filterCapabilitiesStore, panelThunks, panelsSlice, PublicDashboardViewerPage.
- Fresh gates (frontend): jest 375 suites / 4000 tests pass; lint 0 warnings; tsc clean; prettier clean.
- Only PanelInspectView (plus the slice) references setCrossFilter in non-test source; a source-scan test pins it. Trigger flow untouched.
- Stale-on-clear: fetchPanelPage fulfilled/rejected are guarded by latestFetchRequestId; clearing changes the ops key and re-dispatches page 0 without eq.
- lastQuery: written only on page-0 pending, carried forward in fulfilled; replay requires matching outputId and crossFilter still equal to live Redux state (clear-while-unmounted cannot replay a stale eq); mount replays only URL/Redux-held terms, refresh replays full query.
- 400 fallback: raw axios status read before classify; trigger is explicit crossFilterEq arg; capabilities entry blocked (no refetch loop); both toast and usePanelData catch ignore the code, with replay retry without eq.
- D2a same-(column,op) control: deterministic client-fallback, avoiding duplicate-op 400; red-first evidenced in evaluation-2.
- Public route: no backend diff; PublicDashboardViewerPage only passes crossFilterMode="none". Allowed-column set not widened.
- Redux-only state (owner ruling): no URL persistence introduced.
- a11y: live-region announcements for set/clear, only after fetch settles, only on server-path targets.
- AC1 red-first documented in evidence.md (expected 50, received 250 on main); real-request parity recorded.
- UI: viewed eval2 mobile light screenshot (banner, control, table coherent); evaluator captured desktop/mobile, light/dark with real backend, cwd verified. I judged no fresh live run warranted given no diff since those captures (evaluation-2 reviewed same HEAD).

### Verdict: CONFIRM

### Non-blocking notes
- PR body must carry the PanelCard.tsx (~830 lines) split proposal and the >50-cardinality-always-falls-back note.
- Empty intersection renders generic "No data to preview." rather than an empty table (disclosed deviation from D2).
- Detail-modal/fullscreen control-count live regions still say rawRows.length on fallback (disclosed follow-up).
- Thunk invalidates capabilities on a 400 even if that response is stale-guarded in the reducer; harmless (self-healing fallback).
