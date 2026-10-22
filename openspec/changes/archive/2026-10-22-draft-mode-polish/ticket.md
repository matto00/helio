# HEL-1685: Draft mode polish after HEL-1631: first-edit warm-up, broader memoisation, closed-Modal render cost, layout bugs, session-expiry clear, small copy

## Description

origin_kind: followup. origin_ticket: HEL-1631 (PR matto00/helio#1072, merged as c1add2394). Parent epic: HEL-1570.

**Performance**

1. **First-edit warm-up.** The first draft edit pays about 20–25 ms (at 4x) of first-run JS compile, plus about 4 ms of first draft layout. Consider warming the draft path in idle time after the page loads. Owner ruling for now: edit 1 under 100 ms, later edits under 50 ms.
2. **Broader memoisation.** At 4x throttle on the dev build, edits are still about 50–60 ms. Memoise the pipeline page and spine renders more broadly.
3. **Closed-Modal render cost.** `Modal` renders its children while closed, so always-mounted dialogs pay a per-render cost. HEL-1631 fixed the schedule dialog's timezone list; audit the rest.

**Bugs**

4. **Notice band.** On desktop, an empty band (about 116px) appears under a draft notice, which has no grid row.
5. **Phone overlap.** At 375, the draft-status line overlaps the Output card's kebab.
6. **Session expiry.** Kept drafts aren't cleared when the session expires (the 401 path). Logout already clears them.
7. **Deleted Output request.** The run-stream `onTerminal` refresh still requests a deleted Output once (a console 404).
8. **Mid-error switch.** Switching from desktop to phone mid-error loses the last good frames.
9. **Step-named Save 400.** Route a Save 400 that names a step back into that step's editor, or remove the dead `saveError` plumbing.
10. **Restored step.** `useAddedStepId` treats a step restored by Discard as newly created.

**Copy and docs**

11. "from an unknown step" on the Output card of a deleted step; an unpadded "No rows to preview." after an error; redundant "(s)" lines in the cascade dialog.
12. The archived design.md still calls the Discard-fetch question open. Note why Outputs are not part of the kept-draft base signature.
13. Two hooks are over the soft size budget.
14. In `PipelineScheduleDialog.rerender.test.tsx`, `` `p-${name}`.slice(0, 3) `` should read `"p-1"`.

## Addendum from HEL-1632 (Linear comment, Matthew Orr, 2026-10-22)

Adds from HEL-1632 (PR #1075, merged as 32394c562), the live Output column:

- A. **Live marker:** during the ~250–400 ms settle, the previous frame keeps "live". Drive the marker from the uncoalesced inputs and show "updating" while settling.
- B. **`useIdleCoalesced`:** its 1500 ms cap is ineffective when `requestIdleCallback` exists.
- C. **Missing guard:** nothing guards the stable `onToggle`.
- D. **Stale frame:** a server-resolved Output node that isn't focused shows a stale frame until it's selected.
- E. **Missing features:** there is no compare overlay in the column, and a plain (unaggregated) chart Output shows only the ROWS OUT tile.
- F. **Animation:** reference-mark lines may still animate on a live redraw.
- G. **Polish:** at 900 px the open disclosure squeezes the editor; the two "stale" labels are styled differently; the error message shows three times.
- H. **Server:** make the saved panel's column order deterministic on the server.
- I. **Token guards:** the elevation and motion token guards hardcode a CSS file count, so they conflict across lanes.
- J. **Measurement:** there is an unattributed one-frame offset in hel1632's dev-build measurement versus hel1631's (moot for the prod-build budget).

## Owner decisions recorded on this run

- DESIGN.md §10 carve-out: live draft previews update without the chart-refresh morph. `escalation.answered` = `add-carveout` (answer_source human, t=1792681030453). Include the one-line DESIGN.md edit in this ticket.

## Acceptance Criteria

- Each item is fixed or explicitly decided (shipped here, or deferred with a reason).
- Bugs 4–10 each get a test that fails first, and are checked on desktop and phone in light and dark.

## Out of scope (driver)

HEL-1684 (draftable structural operations), HEL-1697 (client regex follow-ups), HEL-1696 (run response row cap). The CI and e2e-harness files belong to the HEL-1699 lane; report before touching them.
