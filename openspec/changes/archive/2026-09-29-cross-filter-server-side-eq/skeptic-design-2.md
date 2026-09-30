## Skeptic Report - design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Round-1 CR1-CR4 each have a matching decision (D9a, D9b, D3a, D10) and tasks 2.1/3.1/5.4/5.5 cover them. CR3 (lazy + TTL + 400 fallback) and CR4 (numeric/string/timestamp semantics, spec scenario scoped) are adequately resolved at design level.
- CR1 checked against code: PanelCard.tsx:387 `usePanelData(panel)` and MobilePanelStack.tsx:47 `usePanelData(panel)` confirmed no-ops; usePanelData.ts refresh() re-dispatches with `filter: undefined` when ops empty. D9a's remedy (pass ops) is correct in principle, BUT its factual premise is false (below).

### Verdict: REFUTE

### Change Requests
1. **D9a false premise for the mobile host.** D9a says both hosts "each already resolve/receive an Output" so they can call `useCrossFilterServerOps(panel, output)`. `MobileStackPanelBody` (MobilePanelStack.tsx:46-58) has NO Output and carries a comment recording that adding a `useOutputMeta` there was probe-confirmed to cause a race (transient unfiltered sibling rows after a breakpoint remount) and was deliberately removed. PanelCard also calls `usePanelData` (:387) BEFORE `useOutputMeta` (:406), so the hook needs reordering. Design must state how the mobile host obtains the Output/eligibility for `usePanelData` without reintroducing that race (e.g. a shared/deduped Output source, or Redux-cached meta), and how the PanelCard ordering is resolved; it must explicitly address the documented prior race and add a test that a mobile-stack sibling never renders unfiltered rows in the window after remount while a cross-filter is active.
2. **D9b contradicts PanelFullscreenOverlay's design.** D9b says the overlay "computes [mode] from its own `output` with the same hook". The overlay has no `output` and never calls usePanelData/useOutputMeta by design (PanelFullscreenOverlay.tsx props doc; PanelCard.tsx:381-406 says it consumes PanelCard's data and resolved Output precisely to avoid extra fetches). It must receive `crossFilterMode` as a prop from PanelCard (same result as PanelCardBody). Fix D9b: overlay = threaded prop, only the modal (which owns usePanelData and its own output) computes it.
3. **400-fallback wiring unspecified (D3a).** State where the 400 is detected: fetchPanelPage failures surface in slice/usePanelSortFilter/usePanelData, three separate dispatch sites (mount, sort/filter effect, handleLoadMore). Name the single place that recognises "400 on cross-filter eq", how it reaches the capabilities cache, and that all three sites (incl. load-more) handle it; one test per site class is enough.

### Non-blocking notes
- D3(3) wording ("string or boolean OR numeric and NOT timestamp") is clumsy; say "any non-timestamp type".
- D9a's "control-ops dropped by refresh today -> file Follow-up" is fine; note that at PanelCard the sort/filter effect and usePanelData mount both dispatch (pre-existing).
