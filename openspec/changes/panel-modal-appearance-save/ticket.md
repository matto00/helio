# HEL-1615: Probe: does saving the panel detail modal wipe a stored appearance.chart (updateBatch appearance replace)?

## Description

Origin: HEL-1614 (PR matto00/helio#1042), lane-reported; not probed.

Suspected data-loss path: saving the panel detail modal goes through the batched `updateBatch` write. If that write
replaces `appearance` wholesale rather than merging, a stored `appearance.chart` (chart type and settings) or a
background could be reset when the modal saves a payload that leaves them out. Precedent: the single-item appearance
PATCH is REPLACE, not merge; `PanelServiceHelpers.normalizeAppearancePayload` builds a fresh `PanelAppearance` (seen in
the helio-news rebuild).

## Acceptance Criteria

1. Probe on a running backend: create a chart panel with a non-default chart appearance, open and save the detail modal
   while changing an unrelated field, then read the panel back. Record the before and after JSON.
2. If anything is lost, it's a bug. Fix it at the write seam (merge semantics, or the client always sending the full
   appearance), with a red-first test.
3. If nothing is lost, close it with the probe evidence.

## Driver context (claims to verify, not facts)

- Probe on a LANE backend (never prod), lane-private DB `helio_hel1615`, ANTHROPIC_API_KEY exported empty.
- Create a chart (output-kind) panel with a non-default `appearance.chart` AND a non-default background; open and save
  the detail modal changing only the title; read back. Record before/after JSON. Cover the real client path
  (Playwright through the modal), not only a hand-built request; check every modal tab/section that saves.
- If anything is lost: fix at the write seam with a red-first test, considering MCP `update_panel_appearance` and other
  callers of the same route. If changing PATCH semantics would alter documented API behaviour, escalate first.
- If nothing is lost: close with the probe evidence; a guard test is welcome.

## Premise validation (orchestrator, 2026-11-22)

- The "precedent" is STALE: since HEL-362 (#297) both the single PATCH (`PanelServiceHelpers.resolvePatch`) and the
  batch path merge via `PanelAppearance.applyPatchJson` (absent-vs-null, field-level chart patch).
  `normalizeAppearancePayload` is the create path only.
- The modal (`PanelDetailModal.handleEditSubmit`) accumulates `appearance: {background, color, transparency}` with no
  `chart` key. Server merge should therefore keep a stored chart; but `panelsSlice.accumulatePanelUpdate` spreads
  `fields` over the local panel (`{...panel, ...fields}`), which REPLACES the local `panel.appearance` and drops its
  `chart` from client state until a refetch. Unverified whether that is visible — the probe must measure it.
