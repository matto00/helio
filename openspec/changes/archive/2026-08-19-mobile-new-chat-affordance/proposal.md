## Why

Two mobile-chat problems were reported together but are two separate findings. Finding A: a mobile
user with existing chat history has no reachable way to start a fresh conversation (desktop-only
sidebar trigger, `display: none` below 768px). Finding B (corrected mid-planning, direct from the
user): tapping "Open assistant" from the dashboard, and separately tapping "Review proposal" from a
chat message, both render a blank area with just a horizontal line on a real 390×844 viewport —
static tracing shows both routes through the same `shared/ui/Modal.tsx` primitive, changed today in
the same 7-ticket batch (HEL-716). This must be root-caused live, not assumed to be Finding A.

## What Changes

- **Finding A:** add a mobile-reachable "New chat" affordance to the command bar, visible only on
  `/chat*` routes at phone widths, dispatching the existing `startNewConversation()` action.
- **Finding B:** live-verify both exact repro flows at 390×844, confirm (or rule out) the shared
  `Modal` primitive as the root cause, fix it there if confirmed (one shared fix, not per-consumer
  patches), and spot-check other `Modal` consumers for the same regression.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mobile-bottom-nav`: adds a requirement that the phone command bar exposes a reachable "New chat"
  control on `/chat*` routes (Finding A).
- `modal-size-scale`: adds a requirement that `Modal` renders its full content visibly at phone
  viewport widths — the regression-guard for Finding B, in the same capability HEL-716 (today's
  likely-source change) already owns.

## Impact

- `frontend/src/app/CommandBar.tsx`, `frontend/src/app/App.css` — Finding A's new control.
- `frontend/src/shared/ui/Modal.tsx`, `frontend/src/shared/ui/Modal.css` — Finding B's likely fix
  location, pending live confirmation of the exact mechanism (design.md D5/D6).
- Read-only verification touches every `Modal` consumer during the D6 audit; only the primitive
  itself is expected to need an edit.

## Non-goals

- No desktop behavior change for either finding.
- No new overlay/CRUD affordance inside `MobileNavSheet`.
- Not attempting every real device/OS combination — bounded to what's live-testable at 390×844; if
  a genuine crash still can't be reproduced after real effort, escalate with what was tried rather
  than closing on an assumption.
