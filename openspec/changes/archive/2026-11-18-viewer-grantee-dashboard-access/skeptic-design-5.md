## Skeptic Report — design gate (round 5, skeptic-design-5.md)

I reviewed HEAD 206a72d00f7d8712db1bb3524498634b5b2cd913. The child-1 re-plan is uncommitted in the worktree: design.md, proposal.md, tasks.md, ticket.md and specs/. Every finding below was checked against the code. Nothing was taken from another agent's narrative.

### Prior round (skeptic-design-4.md): each change request checked against the code

- **CR1 (D2 step 4, roles and pools). Addressed.**
  - D2 (4) now separates the gate from the data reads. The gate is `authorizeResourceWithSharing` and the data reads use `withSystemContext`. It asks for each statement to be labelled with its role, and states that "(3) 0 rows and (4) rows are consistent".
  - Checked in code:
    - `AclDirective.scala:106-131`: the owner is resolved through `dashboardRepo.findByIdInternal` (`withSystemContext`, DashboardRepository.scala:141-142). The grant is resolved through `ResourcePermissionRepository.findGrant` (`withSystemContext`, l.80-81). A stranger with no grant and no token gets 404 (l.122-126).
    - `OutputRepository.findByIdInternal` uses `withSystemContext` (l.136-137).
  - For D2 (4)(a), "run as the role the gate actually uses" therefore resolves to `helio_privileged`. The executor will find this. It is not ambiguous.
- **CR2 (PanelDetailModal). Addressed, with one unnamed consumer (note 2 below).**
  - D5 now decides view mode for non-owners: reuse the per-panel rows, with no `usePanelData` Output fetch, no `useOutputMeta`, no `getDistinctValues`, no viewer controls, no Output link and no `ProvenanceTrigger`.
  - D5 also decides editor edit mode: title and appearance stay editable, and the binding section is replaced by a read-only line with no fetch.
  - D8 covers the viewer detail click and the editor edit-and-save under the invariant. m9 was added.
  - Checked against PanelDetailModal.tsx:183-198 (ProvenanceTrigger, Edit button), l.226-232 (OutputViewerControlBar), l.293 (OutputPanelSection) and usePanelDetailData.ts.
- **CR3 (Home and other list surfaces). Addressed.**
  - D7 gives a decision for every surface I found by enumerating consumers of `state.dashboards.items`:
    - sidebar
    - Home `DashboardShelf` and its count
    - phone chip row and sheet (`usePickerSelection`)
    - tab bar
    - palette (`useResourceSearchActions`, `useRecentPaletteActions`, `useOpenTabActions` and `recentVisitsListeners` are all palette-side)
    - landing and onboarding, owned-only
    - folder move
  - Each decision has a jest case.
  - Non-Goals no longer claim Home is owner-only. Child 5 in children.md now says the web app's surfaces already show shared dashboards, and that `include=shared` keeps only the assistant, search and helio-mcp owner-only.
  - No other target-dashboard picker exists. A grep for an add-to-dashboard target selector returned nothing, and `dashboardService.ts:20` is the only list GET.
- **Prior non-blocking notes. All adopted:**
  - `TableRenderer.canWrite` with `ownerId: null`: D5. `fetchPublicOutputMeta` already returns `ownerId: null` (publicDashboardService.ts:73-86).
  - `usePipelineOwnership`: D6.
  - The list call `/api/outputs?`: D6, which widens the invariant to any suffix.
  - Child 2 naming PanelDetailModal: children.md.

### Independent checks

- **Per-panel route and client layer exist.**
  - `PublicDashboardRoutes.scala:64` (`rows`) and `l.138` (`output-meta`) accept an optional token behind the grant-aware gate.
  - The client functions `fetchPublicPanelRows` and `fetchPublicOutputMeta` take `token` as a required string. "Token-optional" is a small, well-defined change.
- **Mutations can each fail at their intended assertion.**
  - **m1** removes `include=shared`, so the list loses the shared item and the viewer's open check fails.
  - **m2-m5** each remove one gate, and a negative-assertion family checks for that control.
  - **m6** shows the marker on the owner's item, which fails the owner no-marker check.
  - **m7, m8 and m9** fail by request count under the invariant. In dev the requests return 200, but the invariant counts requests, so a dev 200 still fails it.
  - For m9, the binding section left ungated would call `listOutputPanels` (`/api/outputs/:id/panels`) when the edit-mode step mounts it. So m9 can be red even if the executor puts the rows branch inside the shared hooks.
- **HEL-921 premise.** No child adds a route that serves payload rows.
  - Child 1 reads `/rows` (the latest snapshot the panel already shows) and `/output-meta` (kind, config, schema only).
  - Child 2 keeps `/history/:point/rows` unreachable.
  - Child 3 keeps the per-call scope re-check, and `get_history_rows` stays gated on a pipeline grant.
- **Scope.** The original ticket's third AC (Ask for a viewer, no pin) moves to child 3 under owner ruling 4 ("split-into-children"). The restated child-1 AC in ticket.md is fully covered by D0-D8 and tasks 2-5. Every restated AC maps to a task.

### Verdict: CONFIRM

The plan is coherent and can ship as a child-1 slice. The defects below are executor-resolvable inside the stated decisions. Each one would also be caught by the planned invariant e2e, so none can ship silently.

### Non-blocking notes (the executor must resolve these; they are not re-plan items)

1. **`/output-meta` carries no Output name.**
   - D5 says edit mode shows "Bound to <Output name from per-panel output-meta>". But the route returns only `{kind, config, schema}` (publicDashboardService.ts:80-85, resolved by `resolveOutputMeta`).
   - Show a generic read-only "Bound to an Output" line, or the panel's own title. Do NOT widen the public `output-meta` allow-list to add a name in child 1: the route also serves anonymous public and share-token viewers.
2. **`OutputControlsEditor` is not named in D5's editor edit mode, but it fetches.**
   - PanelDetailModal.tsx:294 mounts it beside `OutputPanelSection`. It calls `useOutputMeta` (OutputControlsEditor.tsx:38) and `getFilterCapabilities` (l.56), both `/api/outputs/*`.
   - Under D6 ("filter/sort controls, filter capabilities ... hidden"), hide it for non-owners too. Otherwise the editor edit-and-save step goes red at the invariant.
   - The save path tolerates the missing ref: `activeEditorRef()?.current?.reset()` (usePanelDetailEditState.ts:58, 85). Record it in files-modified.md's affordance list.
3. **The "E" shortcut enters edit mode on its own.** `usePanelDetailEditState.ts:93-108` switches to edit on the E key regardless of the Edit button. "Viewers never see edit mode" (D5) requires gating this listener too. Add a jest case.
4. **`useOutputMeta` has many independent mount sites on a card.** They are:
   - `usePanelCardInspect` (l.37, on every `PanelCard`)
   - `PanelCardBody`
   - the `OutputPanelContent` fallback (l.116)
   - `usePanelRunRefresh`
   - the modal
   - `OutputControlsEditor`

   D6 says the meta comes from `/output-meta`, but `useOutputMeta(outputId)` has no panel or dashboard id. Choose one gate point, either inside the hook or cache, given panel context, or at each call site. State the choice in files-modified.md. m8 must then target that branch, so the mutation reverts the actual seam.
5. **The dev-only `PatchSetReviewPage` demo calls the service's `fetchDashboards` directly** (PatchSetReviewPage.tsx:266). If `include=shared` is added in the service function, as round 4 advised, the demo may pick a shared dashboard first. It is dev-only and harmless. Either keep the owner-only call there, or note it.
6. **The invariant's "no console errors" clause runs on the Vite dev build.** Before blaming the change, confirm that unrelated dev-mode warnings don't count. The clause covers errors only.

### Gate defects

None.
