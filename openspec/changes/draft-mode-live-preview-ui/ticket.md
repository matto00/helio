# HEL-1631: Live draft preview (e): draft mode UI with live per-step counts, preview flash, Discard and Save & run

## Description

Split from HEL-1581 by owner ruling `split-and-restate` (2026-10-16). Carries the user-facing half of HEL-1581's original "What". Design: `docs/live-draft-preview.md` §5, §8 and §12 item (e). Boards: `.concertino/design/HEL-1570/` in the MAIN checkout (`PipelineLive*`, `MotionLive--preview-flash.png`, `HANDOFF.md`). Extends the HEL-1579 page (step spine, focused step editor, preview table); HEL-1582 (mobile) builds on it. The live Output column rendered from draft rows is HEL-1632 (f) and is OUT of scope here.

## Owner rulings (do not re-ask)

- 2026-10-16, stale base on Save & run: `reload-only`. On a 409 the UI offers only "reload the saved pipeline", and the draft is kept as a diff to re-apply. No overwrite button.
- 2026-10-16, undo after a save that deleted steps or Outputs: `refuse-dependent-restore-rest`. The UI shows the 409 that names the bound panels and alert rules that block the undo.
- HEL-1580 rulings: E: Save & run is the atomic bulk endpoint (HEL-1629). F: AI steps and everything downstream show "not previewed (AI step): runs on Save & run"; no Preview-with-AI button. C/D: client-memory 1,000-row head sample with manual refresh (HEL-1628).

## What

- Draft mode. Editing a step creates a client-only draft. The header shows "Draft · unsaved changes" with Discard and the primary Save & run (accent only on Save & run, DESIGN.md v3). Nothing persists until Save.
- Remove the old per-edit traffic: drop the per-edit PATCH (`useStepCardPersist`) and the saved-config preview refetch (`useStepCardPreview`) for editor edits.
- Live recompute from the edited step down (HEL-1581 evaluator). Spine counts update ("104 → 92") and the preview table updates. Changed rows briefly flash using the HEL-1573 motion system; a static highlight under reduced motion.
- Per-step status (`ok | error | needsServer | stale`). Server-only steps go through the HEL-1630 transport with a pending state while in flight; the previous frame stays visible, marked stale; a step in error freezes downstream steps at their last good frames.
- Discard restores the saved pipeline exactly.
- Save & run calls HEL-1629. On a run rejected by the HEL-505 guard show "Saved. Run not started: rate limit, retry in N s" with a Run now action. Show the stale-base 409 per the ruling. Show cascade confirmation before deleting steps.
- Sample label and refresh (HEL-1628) placed in the page.

## Ticket comment (HEL-1582, relayed by the driver; the comment itself could not be read in this session, the reserved slot corroborates it)

On phones, "Draft · unsaved changes" goes in the floating action bar's `data-slot="draft-status"` row (`MobilePipelineActions.tsx`), not the header, and the pills become Discard / Save & run while a draft exists.

## Acceptance criteria

- [ ] Editing a client-evaluable step updates counts and preview with no network request (a network-log e2e asserting zero requests over a burst of edits, including no PATCH), within the spike's budget of < 50 ms per edit.
- [ ] A server-only step updates through HEL-1630's transport, debounced, with a pending state, and never fires more than the draft-preview limiter allows. It never consumes the HEL-505 run guard.
- [ ] Discard restores the saved pipeline exactly: deep-equal steps, configs, order, enabled flags, Output config and fingerprint. Discard sends no request of its own; a step preview not yet loaded is fetched on view, as for any step first opened (owner ruling `amend-ac-fetch-on-view`, escalation HEL-1631-1792470998080-9a4d45).
- [ ] Save & run persists the draft and starts a run, and undo and patch-set history stay consistent (one journal row).
- [ ] Non-static sources clearly show the sample label and its age.
- [ ] e2e specs stay under the 120/60 s per-user /api limit (request counts measured).

## Driver notes for this run

- HEL-1677 item 8 asks this ticket's e2e to check whether a browser abort reaches the backend through Cloud Run (RST vs FIN). Measure locally if feasible; otherwise list as a follow-up.
- HEL-1676 (regex backtracking) is out of scope.

## Owner ruling (this run)

- 2026-10-19, draft scope: `block-during-draft-recommended` (escalation HEL-1631-1792449325590-701045, answered t=1792451059308, chat, human). The draft carries config edits, enabled toggles and step deletes; every other structural operation is disabled while a draft exists; drafting them is a follow-up.
