## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **BoundSourceBar is already read-only / toggle-free.** Read
  `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` in full — it renders only a label, source
  name, and kind badge; no toggle, no "+ Connect source" button. Its header comment documents the
  removal of the old `SourceSelectorBar`/`SourceChip` scaffolding. Grepped the whole `frontend/src`
  tree for `Connect source|SourceChip|SourceSelectorBar` — the only hit is that historical comment,
  confirming no live affordance remains. Matches design.md's Context claim.

- **`selectedSourceId` / `selectedTypeId` selection pattern exists and is the real navigation
  mechanism.** `frontend/src/features/sources/state/sourcesSlice.ts` defines `selectedSourceId`,
  `setSelectedSourceId`; `frontend/src/features/dataTypes/state/dataTypesSlice.ts` defines
  `selectedTypeId`, `setSelectedTypeId`, and an exported `fetchDataTypes` thunk. Confirmed
  `SourcesPage.tsx` (`selected = sources.find(s => s.id === selectedSourceId) ?? sources[0] ?? null`)
  and `TypeRegistryBrowser.tsx` (same pattern with `selectedTypeId`) actually consume these fields as
  the effective-selection mechanism — this is a real, already-wired navigation target, not a proposed
  one. Also confirmed `fetchSources.fulfilled` does not reset `selectedSourceId` (only `items`/`status`/
  `error` are touched), so the "non-resetting on refetch" claim in design.md's Decisions holds.

- **Ownership signal via owner-scoped `sources.items`/`dataTypes.items`.** Backend:
  `DataSourceRepository.findAll(ownerId: UserId, page: Page)` and
  `DataTypeRepository.findAll(ownerId: UserId, page: Page)` both take an explicit `ownerId` (grep
  confirmed). `DataSourceRoutes.scala` threads an `AuthenticatedUser` into
  `DataSourceService.findAll(user, page)` at the route layer — so `GET /api/data-sources` /
  `GET /api/types` are owner-scoped server-side, independent of the frontend gate. This also confirms
  the design's stated defense-in-depth: even if the client-side "hide the button" gate were bypassed,
  the destination pages (`SourcesPage`/`TypeRegistryBrowser`) still can't display/mutate a
  non-owned resource because the backend never returns it. `frontend/src/features/pipelines/ui/
  PipelineDetailPage.tsx:210` already computes `boundSource = sources.find(s => s.id ===
  currentPipeline?.sourceDataSourceId)` from this owner-scoped list for the existing kind badge — the
  plan's `canEditSource`/`canEditType` reuse this exact pre-existing pattern, not a new one.

- **Pipeline-sharing is pipeline-scoped only.** Read `openspec/specs/pipeline-sharing/spec.md` — grants
  are `resource_type = 'pipeline'`; roles gate pipeline GET/mutation endpoints only. Nothing in that
  spec confers DataSource/DataType access. Confirms design.md's claim that an `editor` grant is no
  standing to edit the bound source/type.

- **Pagination risk is accurately characterized as pre-existing, not a new regression.**
  `backend/src/main/scala/com/helio/domain/pagination.scala`: `Page.Default = Page(offset=0,
  limit=200)`, `MaxLimit=500`. `fetchSources()`/`fetchDataTypes()` services call the list endpoints
  with no page params, so a user with >200 owned sources/types could see a false "not owned" result —
  design.md flags exactly this risk and correctly notes the existing `boundSource` kind-badge lookup
  already has the same characteristic (not introduced by this change). Acceptable as noted.

- **Field names used in the spec delta / design exist on the wire type.** `frontend/src/features/
  pipelines/types/pipelineStep.ts` confirms `sourceDataSourceName`, `sourceDataSourceId`,
  `outputDataTypeName`, `outputDataTypeId`, `ownerId` are all real fields on the pipeline summary type.

- **CSS recipe referenced ("share-btn") is real and uses design tokens**, not a hypothetical:
  `PipelineDetailPage.css:1131` — `--app-border-subtle`, `--app-text-muted`, `--app-radius-md`,
  `--space-*`, `--text-sm` tokens throughout, consistent with `DESIGN.md`'s token-based system. Reusing
  this recipe for the new Edit buttons is sound and keeps token discipline.

- **Ticket DoD traced against the plan:**
  1. "No accidental source/type changes possible" — buttons are navigation-only per proposal.md
     Non-goals and design.md Goals; no inline edit UI proposed. Satisfied.
  2. "Edit Source / Edit Type are visible, deliberate actions" — new buttons in bound-source bar and
     new `BoundTypeBar`, satisfied by tasks 1.4–1.6.
  3. "Copy stays singular" — verified already true on `main` (no "Sources" plural anywhere in
     `BoundSourceBar.tsx`); design.md correctly identifies this as already-satisfied, not a task.
  4. "Permissions gated by ownership of source/type, not just pipeline" — `canEditSource`/
     `canEditType` computed from owner-scoped lists, independent of `isOwner`/pipeline-sharing role;
     spec delta's "Pipeline-sharing role does not grant source/type edit access" requirement and its
     scenario directly cover the adversarial case (editor grant, non-owned source). Satisfied.

- **No placeholders/TODOs/contradictions.** Grepped all change-dir `.md` files for
  `TODO|TBD|figure out|placeholder` — no hits. Tasks map 1:1 onto design.md Decisions; spec delta
  scenarios map 1:1 onto tasks.md test cases (2.1–2.4). No scope drift found — Impact section lists
  exactly the files tasks.md touches, and Non-goals explicitly exclude multi-source and inline
  source/type editing, matching the ticket's own stated stretch/out-of-scope items.

### Verdict: CONFIRM

### Non-blocking notes

- Task 2.1 says "new or extended test file" for `BoundSourceBar` — I confirmed no test file currently
  exists for it (`find` turned up only the `.tsx`), so the implementer will be creating a new file;
  this is a harmless hedge in the task wording, not an ambiguity that blocks implementation.
- The pagination edge case (owner with >200 sources/types) is correctly deprioritized but worth a
  one-line follow-up ticket note if it's ever observed in practice, per design.md's own suggestion.
