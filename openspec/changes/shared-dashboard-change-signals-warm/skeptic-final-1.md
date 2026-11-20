## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `f8d3da4ee19b51239445c516221097b42a0b250c`. Base resolved live: `dfb65eebb2dac32afbd1eaeb7fd6e94b369d0369`
(resolve-review-base.sh, exit 0). Evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1783/evidence/.concertino/scratch/HEL-1783/skeptic/`.

### What I verified (with evidence)

**AC1 / AC3: grantee data times, nothing more disclosed, under RLS. MET.**
- `DashboardChangesRepository.changes` runs `contentQuery` in user context. It then runs `dataQuery` in `withSystemContext`
  over `readable` only: the ids the content query returned, never the request ids. It adds `p.kind = 'output'` and builds
  items from the content map. The inline bypass justification is present. Nothing else is selected.
- `DashboardChangesRoutesSpec` run fresh against a lane DB I created and then dropped: 13/13 passed. That includes "prove
  the app pool is genuinely non-BYPASSRLS", the grantee subset-of-panel-list case, the case where `oE` never appears in
  the response text, and the public-grant stranger case. Evidence: `.../skeptic/backend-spec.txt`.

**AC2: dots and warm cache for shared dashboards, with a grantee e2e. Mechanically met.** I did not re-run the e2e. The
evaluator's pasted run and the mutation transcripts are unambiguous for (a)-(d) and for the `/api/outputs|/api/pipelines`
invariant (`expectInvariant`). Code check: the panel restore calls `applyPanelReadScopes(..., true)` and never
`unscopeOutput`. A `panel` copy never seeds metadata or run baselines (`applyWarmEntry`, `scope === "output"` guard).
Nothing on the restore path calls an Output or pipeline service.

**Focused jest, fresh:** 33 suites / 308 tests passed (`tabs/warm`, `panels/hooks/usePanel*`, `panelRowsReuse`,
`panelStatusStore`, `panelThunks`, `outputMetaCache`).

**C13 / CR1 mechanism (option A) is implemented as named.** `usePanelData.ts:319-329`: `restoredMount` leads to
`replayableQuery(..., full=true)`. Without a marker the call is unchanged. C14/C15 tests exist and match the brief.

**The C13 mechanism has a stale-query hole that design-6 CR1 did not foresee. Reproduced twice.**
CR1 assumed: "the child's late correction then calls `isReusable` with the seeded query: equal means reuse, different
means fetch." But `usePanelSortFilter`'s correction effect (`usePanelSortFilter.ts:283-307`) only runs that check when the
child HAS terms (`activeSort || isFiltering(activeFilter) || controlFilterOps.length > 0 || crossFilterEq !== null`).
When the Output has no persisted default and there is no URL control filter, the child never checks. The parent has
already reused the window under its FULL captured `lastQuery`. The table's sort/filter state (`activeSort`/`activeFilter`)
is reseeded to null on every remount, so it no longer matches the rows on screen.

This is not limited to the executor's "persisted default REMOVED after capture" case. The ordinary trigger is a grantee
who sorts or column-filters a table interactively, leaves the tab and returns within the TTL. It matters when the term is
server-side. Under panel scope that means a CONTROL column (`splitForPanelScope`): the window then holds server-sorted
rows or a server-FILTERED SUBSET. `PanelCardBody.tsx:223-236` derives `clientOps` from the null `activeSort`/`activeFilter`,
so the restored card shows that subset with no filter or sort indicator, until a refresh. "Load more" also builds from
`activeSort`/`activeFilter`, so page 1 would be fetched unfiltered and appended to a filtered page 0.

A probe through the real hooks, wired like PanelCard/PanelCardBody (same harness as `usePanelData.restoreMarker.test.tsx`),
with a stored-copy restore, scoped metadata resolving with `config: {}` and the panel having a `team` control:

```
{"case":"interactive column filter on a CONTROL column","rowsRequests":0,"windowLastQuery":{"outputId":"o1","filter":{"columns":{"team":"red"}},...},"childActiveSort":null,"childActiveFilter":null}
{"case":"interactive sort on a CONTROL column","rowsRequests":0,"windowLastQuery":{...,"sort":{"column":"team","direction":"asc"},...},"childActiveSort":null,"childActiveFilter":null}
NO MARKER baseline (same scenario, clearRestoreMarkers() before mount):
{"case":"NO MARKER baseline: interactive column filter on a CONTROL column","rowsRequests":1,"windowLastQuery":{"outputId":"o1","crossFilterEq":null},...}
```

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1783/evidence/.concertino/scratch/HEL-1783/skeptic/probe-interactive-query.txt`.
The probe sources are `control.probe.test.tsx` and `nomarker.probe.test.tsx` in the same directory.

Without the marker, the card fetches and the window converges on the card's query. With the marker it keeps the old
server-narrowed window. So this regression is introduced by the change, and it breaks the binding "no stale-rows path on
any panel-scoped remount". The data is current, but the rows do not match the query the card shows. Non-control-column
terms are safe: there the window holds raw rows and the client applies nothing, which is consistent.

**D5's mutation map (m3/m8 claimed red at e2e (a)) is a record error, not a coverage gap in (d).** Root cause, from the
code: C15 gave the e2e Output a persisted `columnSort` on a non-control column. On the memory path in (a) the scoped
metadata is held, so the child corrects first. Its `dispatchFetch` then takes the HEL-1780 client-only skip
(`usePanelSortFilter.ts:160-188`, equal server keys lead to `panelQueryRecorded`, no request). `mountOwnership` makes the
parent defer. So (a) never reaches `isReusable` or the marker, and m3/m8 cannot turn it red. (d), the stored path, does
exercise the marker, and m8 turns it red there (evidence/mutations-e2e.txt). The record must say so.

**usePanelData.ts length:** 504 lines at base and 547 now. CONTRIBUTING.md:24 says that once a file crosses about 400
lines, you propose a split in the PR description rather than adding to it. The new 23-line marker-timer effect is
self-contained, so it can move out cheaply.

**Owner behaviour:** the unscoped branch of `isReusable` is byte-identical. Without a marker, `replayableQuery` gets the
same argument as before. Owner memory restore now also requires `knownReadScope` to be non-null (the dashboard must be in
the store). That is acceptable: `hydrateTabs` already waits for the list. The sibling e2e specs passed in the evaluator's run.

### Verdict: REFUTE

### Change Requests

1. **Close the marker stale-query hole** (`frontend/src/features/panels/hooks/usePanelSortFilter.ts:283-307`). When the
   panel holds a restore marker, run the reuse check even when the child has no terms. Compare the child's seeded query
   (no sort, `composeOutputRowsFilter(null, ops)`) with the window. If it differs, call `dispatchFetch`. Under panel scope,
   the existing HEL-1780 server-key skip then records the query without a request when only client terms differed, and
   fetches when a server term (control-column sort/filter) differed. Do not set `mountOwnership` in the no-terms branch
   unless it is needed for ordering, and justify the choice. Any equivalent mechanism is fine, provided the rows on screen
   always correspond to the card's `activeSort`/`activeFilter` after a marker reuse.
   Add jest cases to `usePanelData.restoreMarker.test.tsx`, red first:
   - (i) An interactive CONTROL-column column-filter, and separately a sort, captured with no persisted default. The meta
     resolves with `{}`. Expect exactly one per-panel rows request, and the window's `lastQuery` then carries no sort/filter.
   - (ii) The same with a NON-control column. Expect zero rows requests (client-only, HEL-1780 skip).
   - (iii) The memory path (meta held at mount) for (i).

   Add a mutation showing (i) red when the fix is removed. Include the executor's "persisted default removed after
   capture" case as a variant of (i).
2. **Correct D5's mutation-to-assertion map** in design.md (and files-modified.md if it repeats it). m3 and m8 turn e2e
   (d) red, not (a). Add the reason: (a)'s Output has a non-control persisted `columnSort`, so the memory path goes through
   the HEL-1780 client-only skip and never reaches the marker. Cite the evaluator's mX probe as the proof that (a) still
   exercises the memory restore.
3. **usePanelData.ts size:** either move the marker-unmount timer effect (`usePanelData.ts` ~204-226) into a small hook
   next to `restoreMarkers.ts`, or record the split proposal for the PR description in files-modified.md, as
   CONTRIBUTING.md:24 requires.

### Non-blocking notes
- `DashboardChangesRoutesSpec` "give an editor grantee and a dual-grant user..." never creates an editor. `share()`
  hard-codes `'viewer'`. Rename the test or add an `'editor'` grant.
- The CR2 jest cases assert only on `fetchPublicPanelRows`. Asserting that the Output rows service is never called would
  cover both rows paths (the evaluator's suggestion; I agree).
- The commit hashes in files-modified.md predate the rebase (04b764f62/fe7721124/eb7693a90). Refresh them.
