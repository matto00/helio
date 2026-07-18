## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Escalation scope directive honored.** proposal.md's Non-goals explicitly drop AC1/AC2 and cite
  the human-approved resolution; ticket.md's session directives corroborate the escalation existed
  and was resolved toward "Prefer a frontend-derivable signal." No refute for missing AC1/AC2 per
  the orchestrator's instruction.

- **`ad939146` claim.** `git show --stat ad93914` confirms commit "Enforce pipeline-only panel
  bindings (source -> pipeline -> type -> panel)" — matches proposal's "registry list *only*
  pipeline-output DataTypes" claim.

- **`selectPipelineOutputDataTypes` claim.** `frontend/src/features/dataTypes/state/dataTypesSlice.ts:114-116`:
  `return state.dataTypes.items.filter((dt) => dt.sourceId === null);` — matches design.md exactly.

- **`SidebarBody.tsx` line references.** Registry branch is lines 119-150 in the actual file —
  matches design.md's `SidebarBody.tsx:119-150` citation exactly. The "sources-section
  comment/pattern at SidebarBody.tsx:57-61" cited in design Decision 2 is exactly the
  `if (section === "sources" && pipelines.status === "idle") { void dispatch(fetchPipelines()); }`
  block — confirms the mirrored pattern is real and copy-pasteable. Registry currently only
  fetches `dataTypes`, not `pipelines` (line 54-55) — confirms the gap the design is closing is
  real, not invented.

- **`PipelineSummary.outputDataTypeId` claim.** `frontend/src/features/pipelines/types/pipelineStep.ts:278-289`
  shows `outputDataTypeId?: string` on `PipelineSummary` (design cited :277-289, off by one line,
  immaterial). Backend `PipelineProtocol.scala:16` — `outputDataTypeId: String` (non-optional on
  the wire) — exact match to design's claim. Confirms provenance is frontend-derivable with zero
  backend/schema change: the field already exists and is always populated server-side.

- **`DataType.sourceId` already present** (`frontend/src/features/dataTypes/types/dataType.ts:21`)
  — no new field needed on the DataType side either.

- **`App.tsx` fetch-pipelines gap.** Grepped `App.tsx` for `dispatch(fetch` — only
  `fetchDashboards`/`fetchPanels` are dispatched there; no `fetchPipelines`. Confirmed `SidebarBody`
  is unconditionally mounted inside `App.tsx` (`<SidebarBody ... />` at line 404, inside
  `<aside className="app-sidebar">`, hidden via CSS at mobile widths per the ticket's own note, not
  conditionally unmounted) — so `SidebarBody`'s `useEffect` fires regardless of viewport, and its
  `fetchPipelines` dispatch will populate the shared `state.pipelines` slice that `App.tsx`'s
  `mobileSheetItems`/`breadcrumbItemName` already read. Task 1.3's "verify whether App.tsx already
  fetches pipelines" is a legitimate, low-risk, well-bounded executor check (not a blocking
  placeholder) — my own check strongly suggests the answer is "no separate fetch needed."

- **Component/CSS surfaces for the subtitle.** Read `SidebarItemList.tsx` in full: `SidebarItem`
  interface is currently `{id, name}` (lines 14-17); rows render
  `dashboard-list__name-group` > `dashboard-list__name` + `renderBadge?.(item)` (lines 174-177,
  193-196) — a natural, minimal-diff slot for an added `subtitle?: string` stacked under the name.
  Read `MobileNavSheet.tsx` in full: `MobileNavSheetItem` is `{id, name, isActive}` (lines 7-11),
  item rows render `mobile-nav-sheet__item-name` only (line 159) — same story.

- **Filter is name-only today.** `SidebarItemList.tsx:78` —
  `items.filter((item) => item.name.toLowerCase().includes(normalizedQuery))` — confirms Decision 6
  ("filter stays name-only") requires no code change, and the "Filter ignores subtitle text"
  spec scenario is trivially true today and testable as a regression guard.

- **Token claims.** `frontend/src/theme/theme.css:26` — `--text-xs: 0.75rem; /* 12px */` confirms
  the 12px claim. `--app-text-muted` (not literally "secondary text" but the established
  lower-emphasis text token) is already used 8+ times throughout
  `frontend/src/features/dashboards/ui/DashboardList.css` including `.dashboard-list__status` and
  `.dashboard-list__name-group` siblings — confirms "secondary text color token" in design.md
  Decision 5 refers to a real, already-conventional token, not an invented one.

- **Mobile tap-target claim.** `MobileNavSheet.css:100-101,154-155` — `.mobile-nav-sheet__item` has
  `min-height: var(--control-lg)` and an explicit `min-height: 44px` under a mobile media query —
  confirms the ≥44px floor already exists and can only grow (not shrink) when a subtitle line is
  added, matching the design's risk note.

- **Test-file homes already exist.** `SidebarBody.test.tsx`, `SidebarItemList.test.tsx`,
  `MobileNavSheet.test.tsx`, `pipelinesSlice.test.ts` all already exist in the tree — tasks.md's
  test plan (3.1-3.4) has real, conventional homes rather than inventing new test file locations.

- **No backend/schema touch required** — verified independently (not just asserted): both
  `sourceId` (DataType) and `outputDataTypeId` (PipelineSummary) are already on the wire and
  already typed on the frontend. No Flyway migration, no `JsonProtocols.scala` change, no new
  route is implied by anything in design.md or tasks.md.

- **No placeholders.** `grep -rn "TODO\|TBD\|figure out later\|to be decided"` across
  proposal.md/design.md/tasks.md/specs/ returned nothing.

### Verdict: CONFIRM

The design is sound, DESIGN.md-conformant (existing `--text-xs` + `--app-text-muted` tokens, reuse
of the shared `SidebarItemList`/`MobileNavSheet` components via an additive optional field rather
than a one-off), and every factual claim I checked against the actual worktree code held up
(file/line references, selector semantics, wire-shape availability of `outputDataTypeId`, the
mobile sheet sharing the same filtered-list state as the desktop sidebar). Scope correctly excludes
the obsoleted AC1/AC2 per the escalation resolution and stays frontend-only. Spec scenarios are
concrete and testable against real, pre-existing behavior (filter-is-name-only, tap-target floor,
token names).

### Non-blocking notes

- proposal.md's "Impact" list doesn't explicitly name `pipelinesSlice.ts` (or a new shared-selector
  file) as a touched file, even though design.md Decision 1 clearly intends a new selector to live
  there or nearby. Not a blocker — design.md is the more detailed source and the executor will
  naturally touch that file — but worth tightening in a future proposal pass for completeness.
- Design.md's `PipelineSummary` line citation (`:277-289`) is off by one from the actual `:278-289`
  — immaterial, flagging only for hygiene.
