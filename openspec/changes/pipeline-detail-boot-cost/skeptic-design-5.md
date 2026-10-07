## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 70b063a47046910b4526f7de0add5901cc39fbb0 (no code edits yet; change dir untracked). Spawn-cwd guard: READY.
Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-editor-page/spec.md, skeptic-design-4.md, and checked
them against live code in `frontend/src/features/pipelines/`.

### What I verified (with evidence)

**Round 4 CR1 (modal-open trigger unstated; render-state gap) is closed.**
- Trigger is now explicit: a click-time `openRunHistory` handler only, no reactive effect on `historyOpen` (design.md D3
  "Modal open trigger"). This removes Reading 2's re-dispatch loop; Retry is the only post-failure re-dispatch.
- Reading 1's gap (modal open across an in-place id change, B never fetched) is closed by resetting `historyOpen` in
  the same derived-state branch that reissues the token. React re-renders the component immediately when setState is
  called during render, before commit, so no frame ever paints the modal under B. This is the same pattern already
  used at `usePipelineDetailPage.ts:282-285` (`outputNamePipelineId`).
- Render-state list is exhaustive over (fresh?, latest request for this open): fresh -> list; not fresh + failed ->
  error/Retry; otherwise loading. "None issued yet" is argued transient: the only open path dispatches, and id change
  closes the modal. I checked that the "only open path" claim holds in the live code: `historyOpen` is set true at
  exactly one site, `PipelineDetailPage.tsx:174` (`onOpenHistory` -> header actions menu item,
  `PipelineDetailHeader.tsx:201`). `OutputGalleryCard`'s `onOpenHistory` is the per-Output history (a different
  feature, `handleOpenOutputHistory`), not this modal.
- Spec gained "Switching pipelines in place closes the run-history modal" and "A failed fetch is retried only on
  request"; task 3.2 adds the A-open-then-navigate-to-B test and the exactly-once-until-Retry assertion.

**Every run-history dispatch site is accounted for.** `grep fetchPipelineRunHistory` finds exactly four sites:
`usePipelineDetailPage.ts:271` (`onTerminal`), `:466` (unguarded boot effect — removed by D3), `:1258`
(`handleRunPipeline`), `:1271` (`handleDryRun`). D2 forces the three post-run ones. `state.pipelines.runHistory` has no
consumer outside the page (banner `PipelineDetailPage.tsx:188`, modal `:388`).

**Post-run forced refresh with the modal open.** Fresh list stays visible (loadedOpenId still equals openId) while
the forced fetch runs; if the list was not yet fresh, the forced request becomes latest, the earlier response is
dropped by latest-request-wins, and the modal stays in loading until the forced one lands. Consistent with spec
"A run finishing during an in-flight fetch still refreshes" and task 3.3.

**Earlier rounds stay closed.** D2 force + latest-wins (R1 CR2), C1/D5 exact 8x config (R1 CR3), count-free title
(R1 CR4), no cleanup reset / per-open freshness (R2 CR1), A->B->A token uniqueness via module counter (R3 CR1),
test-migration line lists (R3), `nextOpenToken` helper naming `react-hooks/globals` (R4 note), slice-test migration
at `pipelinesSlice.test.ts:481-511` now in task 2.1 (R4 note), hook-exposed pipeline retry replacing the direct
`dispatch(fetchPipelineById(id))` at `PipelineDetailPage.tsx:140-141` (R4 note).

**StrictMode boot path re-checked against live code.** `lastFetchedIdRef` guard (`:301-317`) persists across
StrictMode's simulated remount, so the chained history fetch is dispatched once; no cleanup cancel flag is used, so
run #1's chain is not cancelled. Sibling test files (`createPlacement`, `creatingStep`, `reorderGuard`, `draftCreate`)
only `mockResolvedValue([])` on `fetchRunHistory` — no call-count assertions to break.

No placeholders/TBDs; no contract/schema impact; every AC maps to tasks (1.2 root cause, 2.2/2.4 defer, 1.3/3.4
before/after, 3.1-3.3 RTL); HEL-1350 files avoided.

### Verdict: CONFIRM

### Non-blocking notes
- D3 says `openRunHistory` is wired to the "header/footer 'Run history' item". The footer has no such item any more
  (`PipelineDetailFooter.tsx:17-21`); the only opener is the header menu (`PipelineDetailPage.tsx:174`). Wire that one.
- To keep `openRunHistory` the *only* open path, have the hook expose a close handler (or keep `setHistoryOpen` used
  only with `false`) rather than leaving `setHistoryOpen(true)` callable from the page.
- "Hook-exposed retry handler that runs the same chain as boot": state in the implementation whether retry re-issues
  only `fetchPipelineById` + chained history (today's retry scope) or the full boot set; either is acceptable, but
  pick deliberately and keep the error-retry RTL test asserting it.
- `handleRunPipeline`/`handleDryRun` capture `openId` via `useCallback` deps; a submit that resolves after an in-place
  switch dispatches a forced fetch for the old id under the old token. Harmless (never fresh for a later open), same
  class as the optional stale-chain skip.
- Reopening the modal after closing it in the error state is itself a user request and will dispatch; the
  "exactly once until Retry" assertion should be scoped to a single modal-open, as task 3.2 describes.
