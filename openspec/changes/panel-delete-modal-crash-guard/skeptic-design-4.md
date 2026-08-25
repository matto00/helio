## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- **(a) Both previously-refuted call sites are corrected — read directly, not trusted.**
  - `design.md:51-71` — the useEffect snippet comment now says the gate only prevents `detailPanelId`
    from clearing during a transient window ("so a transient window doesn't permanently dismiss the
    modal") and carries an explicit `NOTE: this gate does NOT preserve unsaved edit-mode state — the
    render guard below unmounts PanelDetailModal (destroying its local useState) on ANY unmount, gated
    or not.` The render-guard comment (`:67-71`) additionally states the guard is unconditional and
    does not itself close the modal. Accurate.
  - `tasks.md` task 2.1 (`:16-25`) — same correction: gate "excludes a transient ... window ... from
    clearing `detailPanelId` ... so the modal is not permanently dismissed", plus "This does NOT
    preserve unsaved edit-mode state — the unconditional render guard unmounts `PanelDetailModal`
    (destroying its local `useState`) regardless of this gate."
- **(b) Independent grep sweep of the whole change dir** for `renders? blank|no data loss|reappears
  with no data|without (any )?data loss|preserv`: the only "blank"/"no data loss" hits are in
  `skeptic-design-2.md:45-62` and `skeptic-design-3.md:17-18` (historical reports quoting the old
  text). `design.md`, `tasks.md`, `proposal.md`, `ticket.md`, and the spec delta contain no residual
  copies. The orchestrator's summary is accurate and complete.
- **(c) Full re-read of `design.md`, `tasks.md`, `specs/panel-detail-modal/spec.md` end-to-end**, plus
  ground-truth checks against source:
  - `DesktopPanelGrid.tsx:302-313` confirms the Context's description of the bug verbatim
    (`panel={panels.find((p) => p.id === detailPanelId)!}`, `key={detailPanelId}`), so the design is
    grounded in the real file, not a recollection.
  - `panelsSlice.ts:143-152` confirms the gate's premise (`fetchPanels.rejected` sets `items = []`,
    `status = "failed"`; `fulfilled` sets `succeeded`).
  - **Gate does not block the primary repro** (the failure mode I went looking for):
    `deletePanel.fulfilled` (`panelsSlice.ts:167-169`) filters `items` and *never touches `status`*,
    so after a successful load the status remains `"succeeded"` and the `panelsStatus === "succeeded"`
    condition still fires for the ticket's literal delete path and for the spec's Scenario 1. No
    contradiction between the gate and the spec's "closes automatically" requirements.
  - `markDashboardPanelsStale` (`:112-121`) sets `status = "idle"` while leaving `items` intact — the
    one status value neither the design nor spec discusses. It is not a hole: `items` is unchanged in
    that transition, and even if a removal coincided, the unconditional render guard still prevents the
    crash (the ticket's actual scope); only the state-hygiene clear would be deferred to the next
    `succeeded`. Non-blocking note below.
  - Spec delta is internally consistent with the corrected design: it requires "SHALL NOT render with
    an undefined backing panel at any time", scopes preservation to "which panel is this for" state
    only, and explicitly disclaims unsaved-edit preservation. Its four scenarios map 1:1 onto tasks
    3.1/3.2/3.3 with observable-only assertions (3.3's third bullet correctly uses modal reappearance
    as the proxy for `detailPanelId` surviving, since that state has no test-visible surface).
  - AC coverage: reproduce-first (1.1) + widened trigger probe (1.2) + fix (2.1/2.2) + RED-then-GREEN
    gated Jest regression (3.1) + live crash evidence (3.2). No placeholders, no TODO/TBD, no scope
    drift, no uncovered AC.

### Verdict: CONFIRM

### Non-blocking notes

- `design.md`'s snippet uses `panelsStatus` without naming its source; `tasks.md` 2.1 supplies it
  ("read `panelsSlice`'s `status` alongside `items`"). `DesktopPanelGrid` currently takes `panels` as a
  prop and uses no selector, so the executor must choose selector-vs-prop-drill. Either is defensible;
  flagging only so it is a conscious choice at execution time.
- Neither design nor spec addresses `status: "idle"` (set by `markDashboardPanelsStale`). Behavior is
  safe either way; a one-line mention of why `"idle"` is treated like `"loading"` (no auto-close) would
  make the gate's three-value reasoning complete.
- Environmental: this worktree's `scripts/concertino/` predates `next-report-number.sh` /
  `persist-evidence.sh` / `emit-event.sh`; I ran them from the main checkout at
  `/home/matt/Development/helio/scripts/concertino/`. Not a blocker, but the worktree base is stale
  relative to `main`'s tooling.
