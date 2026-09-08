## Context

See proposal.md — Why. The load-bearing fact is that HEL-548 already shipped the four create-action seams,
so this ticket writes no creation logic; and that only `CreatePipelineModal` is currently reachable off its
own route. See ticket.md's "Premise corrections" for the full stale-claim list.

## Goals / Non-Goals

**Goals.** Palette-invoked creation for all four resources that genuinely works from any route; reuse of the
HEL-548 seams without forking them; a `CommandAction` shortcut field feeding the existing `KeyCap`.

**Non-Goals (design-level).** A general-purpose "open any modal from anywhere" controller — that is a larger
architectural change than this ticket needs, and the tree already has a blessed narrower pattern (D1). No
change to what the creation modals themselves do.

## Decisions

### Decision 1 — Reach via shell-mounting, following the existing F-045 precedent; NOT navigate-then-act

The ticket suggests "route to the correct section first if needed". **Rejected.** A quick-create that
teleports the user to another route does something they did not ask for: they wanted a dialog, not a
navigation, and their place in the app is lost behind the modal they now have to dismiss to get back.

The tree already answers this. `App.tsx:200-209` (F-045) mounts `CreatePipelineModal` at the shell for every
route *except* `/pipelines`, and its comment records exactly the failure we must avoid:

> previously it only set `createModalOpen` in Redux with nothing mounted to read it outside `/pipelines`, so
> the modal silently opened later, on whatever route the user next visited `/pipelines` from.

That is the "silently defers" defect the spec now forbids, already diagnosed and fixed once in this
codebase. **So: mount `AddSourceModal` and `OutputPicker` at the shell the same way, each skipped on the
one route that mounts its own instance** (`/sources` and `/` respectively). The result is in-place opening
from anywhere, no navigation, no doubled dialog, and no new mechanism invented.

*Alternatives rejected:* (a) navigate-then-open — unrequested route change, above; (b) a
`shareDialogContext`-style context per dialog — that precedent exists but is scoped to one dialog and would
mean three new bespoke providers where a mount already suffices; (c) extending `OverlayProvider` into a
modal opener — it is a single-active-overlay coordinator with no content registry (re-verified in HEL-510),
so this would be a rewrite, not an extension.

### Decision 2 — Dashboard create needs no host at all

`useCreateDashboardAction` performs an immediate `createDashboard({ name: "Untitled dashboard" })` and owns
its own `isPending`/`error`. There is no surface to mount and no flag to flip, so it works from any route
already. It is deliberately NOT `DashboardList`'s named-create form — HEL-548 D5 kept those separate on
purpose, and this ticket does not collapse them.

**Consequence to state plainly:** the palette's "New dashboard" creates an untitled dashboard immediately
rather than prompting for a name, which is a different interaction from `DashboardList`'s inline form. That
is the correct trade for a keyboard quick-create (it matches `PanelList`'s existing quick-create CTA, the
seam's original consumer), and the action's title should not imply a naming prompt it does not offer.

### Decision 3 — The `PanelList` unmount cleanup must be reasoned about, not tripped over

`PanelList` resets `panelCreationModalOpen` on unmount, precisely so a stale `true` cannot re-open the modal
on a later visit to `/` (HEL-548 D5a). Shell-mounting `OutputPicker` interacts with that:

- On `/`: the shell instance is skipped, `PanelList` renders its own — unchanged from today.
- Off `/`: `PanelList` is not mounted, so its cleanup cannot fire; the shell instance opens and closes on
  its own `onClose`.
- Navigating `/` → elsewhere with the modal open: `PanelList` unmounts, its cleanup clears the flag, and the
  shell instance therefore does not inherit an open modal across the route change. This is the desired
  behavior, and it is worth an explicit test rather than an assumption.

`OutputPicker` also requires a non-null `dashboardId`, so the shell mount is gated on `selectedDashboardId`
exactly as `RefinementChatDrawer` already is at `App.tsx:213`.

**`SourcesPage` has the SAME unmount cleanup** (`SourcesPage.tsx:60-64`, HEL-554 D4, explicitly mirroring
D5a) — round-1 skeptic CR2; the round-1 design reasoned only about `PanelList`. The three cases repeat
identically for sources: on `/sources` the shell instance is skipped and `SourcesPage` renders its own; off
`/sources` the page is unmounted so its cleanup cannot fire; navigating `/sources` → elsewhere with the
modal open clears the flag, so the shell instance does not inherit it. Both cases need the explicit test in
task 1.3, not an assumption.

**Route-skip predicate, stated precisely** (CR4): the sources skip is the EXACT path `/sources` only.
`/sources/:id` is a sibling route rendering `SourceDetailPage` (`AppRoutes.tsx:101-102`), NOT a child of
`SourcesPage` — so `/sources/:id` DOES get the shell mount. That is exactly where the live defect in
Decision 3a lives, and it is therefore the natural route to drive the reach test from.

### Decision 3b — `OutputPicker` needs the CURRENT dashboard's panels, which off-route may be stale

Round-1 skeptic CR1: `OutputPicker` has a second required prop the round-1 plan never mentioned —
`currentDashboardPanels: Panel[]` (`OutputPicker.tsx:38`). This is not a formality. Off `/`,
`state.panels.items` is `PanelList`-owned and may be empty or hold *another dashboard's* panels;
`PanelList.tsx:100-108` guards for exactly that (`items[0].dashboardId !== selectedDashboardId`), because a
dashboard switch leaves the previous dashboard's panels in the store while the fetch is in flight.

Feeding `[]` or stale items would silently break `useOutputPickerData`'s "already on this board" marking —
the picker would offer outputs that are in fact already placed. That directly violates the
`palette-quick-create` scenario requiring the palette's flow to match the section's own control, and it
would fail *quietly*, which is the worst shape for this defect.

**Decision:** the shell mount reuses `PanelList`'s own staleness predicate rather than re-deriving one, and
passes the store's panels ONLY when they genuinely belong to `selectedDashboardId`. When they do not, the
create action first dispatches the existing panels fetch for the selected dashboard (the same thunk
`PanelList` uses — not a new one) and the picker renders once they resolve.

Two corrections from round-2 CR3, because the round-1 wording would have sent an implementer looking for
things that do not exist: (a) there is **no existing loading path to mirror** — `PanelList.tsx:314-320`
passes `items` RAW, gated only on `panelCreationModalOpen && selectedDashboardId`, so the shell mount is
deliberately STRICTER than `/`, not a mirror of it; (b) `PanelList.tsx:105-108` is **not a reusable
predicate** but an inline clause of the compound `showPanelGridSkeleton` expression, so it must be
extracted to a shared helper or the condition mirrored. Acceptance is parity with the `/` flow's
**post-fetch result** (correct "already on this board" marking), not parity with its implementation, and
not the mere absence of a crash.

*Explicitly NOT precedent:* `PanelDetailModal.tsx:119` passes `[]` — that is a swap-mode call site with
different semantics, and citing it here would be a false analogy.

### Decision 3a — StrictMode masks a PRODUCTION-ONLY defect, and would have made our own guard vacuous

Round-1 skeptic CR3, confirmed by live probe and reproduced twice. This is the single most important finding
in this ticket's planning, and it is a measurement hazard before it is a bug.

**The bug.** `SidebarBody.tsx:87` sets `addModalOpen` from `/sources/:id`, where nothing is mounted to read
it. `SourcesPage.tsx:56-58` justifies its own safety with the premise that "`addModalOpen` starts `false` at
every mount now that nothing sets it before this page itself does" — **`SidebarBody.tsx:87` falsifies that
premise.** In dev, `main.tsx:58`'s `React.StrictMode` double-invocation fires `SourcesPage`'s cleanup once
at mount, clearing the flag before render, so arriving at `/sources` shows nothing. **A production build has
no StrictMode: the modal opens unbidden.**

**Why it matters more than an ordinary bug.** A task-5.3 guard driven against the dev server would pass
*today, before any fix* — structurally incapable of failing, while looking exactly like proof. That is
HEL-510's refusal case, caught this time before the test was written rather than after. The dev environment
actively masks the defect.

**Disposition (owner ruling).** HEL-516 closes it — shell-mounting `AddSourceModal` IS the fix, since the
flag finally has a reader on every route — and filing a ticket for something this diff repairs would be
noise. But it must NOT close silently:
1. The mechanism above is stated in full in the PR body AND as a Linear comment on HEL-516, including that
   `SourcesPage.tsx:56-58`'s premise is falsified by `SidebarBody.tsx:87`.
2. **A regression guard is mandatory**, because if a later change reverts shell-mounting, the bug returns
   silently and nothing in dev will say so. **Mechanism (round-2 CR1 — the round-1 pair of options was
   unbuildable):** `vite preview` cannot reach `/api` (`vite.config.ts:59-66` defines `server.proxy` and no
   `preview` block) and `playwright.config.ts` pins `baseURL` to `DEV_PORT`, so the production-build route
   is closed; and red-first in dev is impossible by construction, since StrictMode clearing the flag IS the
   finding. So the guard is **render-level, mounting the app tree WITHOUT `React.StrictMode`**, asserting
   DOM presence only (not focus/visibility/computed style — jsdom is legitimate for exactly that, and
   evidence rule 3 is not engaged). It is failable by mutation: deleting the shell mount turns it red, and
   that must be VERIFIED by running the mutation, not asserted.
   **The sequence must include dismissing the in-place modal on `/sources/:id` before navigating**
   (round-3 CR1): nothing on that route clears `addModalOpen` (no `setAddSourceModalOpen` writer in
   `SourceDetailPage.tsx`), so without the dismissal the flag is still set, `SourcesPage.tsx:154` renders
   the modal correctly on arrival, and the assertion is red POST-fix — testing the wrong thing. Dismissal
   via `onClose` is the real production path that clears it.

**General question to carry into HEL-519 and HEL-503:** does dev differ from prod in a way that makes this
check vacuous? StrictMode double-invocation is the specific instance; the question is the general one.

### Decision 4 — Consume the seams; extend only via their shared result shape

The palette needs `{ label, icon, disabled?, onClick }` — precisely `EmptyStateCta`, which every seam
already returns inside `CreateActionResult`. So the seams are consumed **as-is**, and the availability rule
for panels (`disabled` when no dashboard is selected) is read from the seam rather than restated in the
palette. Restating it would create the second source of truth the `workspace-create-actions` delta forbids.

`CreateActionResult` is declared identically in **five** files, not four (round-1 skeptic CR7 —
`features/assistant/hooks/useCreateConversationAction.tsx:7` is the fifth; the count was re-derived
mechanically via `grep -rln 'export interface CreateActionResult'`, which returns 5, rather than from the
earlier hand list). Deduplicating is out of scope — no behavioral gain — and with the count corrected this
stands as an **observation, not a deferral**: nothing is owed and no ticket is required.

One real constraint: the seams are **hooks**, so they must be called at a component's top level and cannot
be invoked inside a `run()` callback. The Create actions are therefore built in a component that calls the
seams at top level and registers the resulting actions via the existing `useCommandActions` path.

**Working prior art exists — prefer it to inventing a pattern** (CR7): `shared/chrome/usePickerSelection.ts`
already calls the create-action seams unconditionally at top level and hands out a `CreateActionResult` per
section, with its own docstring citing Rules of Hooks as the reason. It also imports `CreateActionResult`
from `useCreateDashboardAction`, establishing a de-facto canonical import. Follow that shape, and reuse
rather than duplicate it where the palette's needs overlap.

### Decision 5 — `CommandAction` gains an optional combo, rendered through the existing `KeyCap`

Owner ruling, folded in from HEL-510: the palette must show caps for its own shortcut-bearing actions rather
than leaving `KeyCap` used by exactly one surface.

`CommandAction` gains one optional field carrying a shortcut combo. It is typed as the `ShortcutCombo`
already exported by `shared/chrome/shortcuts.ts` and rendered via `formatCombo` + `shared/ui/KeyCap` — the
same pipeline the help overlay uses — so a combo cannot be displayed one way in the overlay and another in
the palette. **No second cap component, no re-declared cap styling.**

For an action whose shortcut is a declared global binding (the assistant's Cmd/Ctrl+J is the live case), the
combo SHOULD be read from the shortcut declaration by id rather than re-typed as a literal, so the displayed
cap cannot drift from the binding that actually fires. The Create actions themselves have no global bindings
and simply omit the field.

**Placement: INLINE AFTER THE TITLE. Right-alignment is rejected — owner ruling, round-1 skeptic CR9.**
The help overlay right-aligns its caps and that is correct THERE, because every row has one, so they form a
real column with its own edge, and the cap is the subject of that surface while the description is the
gloss. The palette inverts both facts: rows are ~680px with no right-hand column (every row ends at its
label), and the cap is secondary metadata about an action rather than the thing being looked up. Exactly one
action will carry a cap, so a right-aligned cap would join no column — it would read as debris in dead space
and cut a visual gutter into a list whose rhythm is icon-then-label, flush left.

This is a case where **mechanical sameness would be LESS cohesive, not more. Cohesion lives at the atom, not
the coordinate**: the same `KeyCap` component, the same typography, border, and radius, with placement
following each surface's own rhythm. **If `KeyCap` needs restyling to sit well inline, STOP and escalate** —
a second cap style is the exact outcome folding KeyCap-in-palette into this ticket was meant to prevent.

### Decision 6 — The header kebab keeps its route gate; only its false comment is fixed

Round-1 skeptic CR5: `CommandBar.tsx:73,82` already consumes `useCreatePanelAction`, and lines 285-289 gate
the "Add panel" kebab on `onDashboardView` with the rationale "`PanelCreationModal` is mounted by `PanelList`
alone (route `/`), so neither item may outlive the surface that responds to it." **Shell-mounting makes that
comment false**, so it must be corrected — a stale comment asserting a fact the code contradicts is the
same defect class as HEL-1029's.

**The gate itself stays (owner ruling).** A global palette offering "Add panel" everywhere and a contextual
header kebab offering it only on a dashboard view are not inconsistent — they are two affordances doing
their jobs, the palette global by definition and the kebab contextual by position. Aligning them would widen
the diff to erase a distinction that is correct. `CommandBar.tsx` is added to Impact for the comment fix.

### Decision 7 — "Never presented twice" also covers NESTED AddSourceModals, not just route-doubling

Round-1 skeptic CR6: `CreatePipelineModal.tsx:226` and `AddRootModal.tsx:124` each render a nested
`AddSourceModal` from **local** state, independent of `addModalOpen`. Because `CreatePipelineModal` is itself
shell-mounted on every non-`/pipelines` route, a user can have that nested modal open and then run the
palette's "Add source" — yielding two. The route-skip alone does not catch this, so the "exactly one"
check must cover the nested case explicitly rather than only the route case.

## Risks / Trade-offs

- **A shell-mounted modal could double on its owning route** → each mount is route-skipped exactly as F-045
  does; the spec has an explicit "never presented twice" scenario, and it must be proven on the owning route,
  not only off it.
- **Reach is exactly the thing a naive test cannot prove** → every reach test MUST drive the action from a
  route where the host is not mounted. A test run from `/sources` or `/` proves nothing about reach and, per
  ticket.md, does not satisfy the AC. This is the single most likely way to ship a green-but-hollow suite.
- **jsdom cannot establish focus handoff** (palette closes → focus enters the modal) → prove in a real
  browser, per HEL-1005 and HEL-510's own 40px lesson.
- **Unrequested route change** → avoided by construction under D1; if any flow still needs navigation, that
  is a visual/UX call, not plumbing, and is escalated with screenshots rather than settled by an agent.
- **Mounting two more modals at the shell adds shell weight** → both are already conditionally rendered
  behind a boolean and a route check, so they cost nothing until opened; `CreatePipelineModal` set this
  precedent.
- **Downstream shape churn** → HEL-519 and HEL-503 inherit the `CommandAction` shape, including the new
  combo field. Adding an optional field is backward-compatible; changing its type later would not be.

## Migration Plan

Additive and frontend-only. No wire, schema, or backend impact — but per evidence rule 5 that is not "no
downstream impact": `CommandAction` is a published surface two further tickets consume, and shell-mounting
changes when `AddSourceModal`/`OutputPicker` exist in the tree. Rollback is a single revert.
