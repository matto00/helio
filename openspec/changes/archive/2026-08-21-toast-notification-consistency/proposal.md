## Why

Toast **mechanics** have drifted from `DESIGN.md` §7/§3/§8 and several mutation failures are reported nowhere at all.
Concretely: `ToastViewport` renders an unbounded stack, so a burst can bury the viewport; every toast is announced
`role="alert" aria-live="assertive"` regardless of intent, so a routine "Panel deleted." interrupts a screen-reader user
like an error; the entrance uses the hover token rather than §3's entrance token, and nothing disables animation under
`prefers-reduced-motion` beyond `theme.css`'s global 0.01ms shortening; the stack sits over the phone navigation bar;
adding a SQL or static data source fires **two** success toasts whose wording differs from the other five paths of the
same button; and six writes — `updateDashboardLayout`, `updatePanelsBatch`, `updatePanelColumnWidths`,
`savePipelineSchedule` from the header toggle, `deletePipelineStep`, and `deleteMetric` — fail with no toast, no inline
error and no console signal, which §7 forbids.

## What Changes

- **Bound and stabilise the stack**: a concurrent-toast cap with oldest-first eviction, an exemption so a sticky
  action-bearing toast is never destroyed without user action, and coalescing of an identical repeated message.
- **Fix announcement**: always-mounted visually-hidden polite and assertive live regions, with each toast's message
  routed by intent, replacing today's uniformly-assertive per-node region.
- **Fix the surface**: §3's entrance token, an explicit `prefers-reduced-motion` opt-out, the mobile tap-target floor on
  the dismiss control, and a viewport offset that clears the phone navigation bar.
- **One duration**, owned by the slice and applied at creation.
- **Close six swallowed failures** by adding the missing error toast (and, for `deleteMetric`, the success toast its
  three sibling delete affordances already have).
- **De-duplicate the add-source flow** so one button produces one toast with one wording across all seven of its paths.
- Rewrite `toastListeners.ts`'s 33 hand-written effects as two declarative tables — it is already 446 lines, past
  `CONTRIBUTING.md`'s ~400-line "propose a split" threshold, and this change adds six more entries.

## Capabilities

### New Capabilities
- `toast-emission-integrity`: one toast per outcome per user action, one wording per action regardless of internal
  code path, and no failure left reported nowhere.
- `toast-surface-behavior`: the concurrent-toast cap and its eviction exemption, duplicate coalescing, the uniform
  auto-dismiss default, per-intent live-region routing, and the surface's token/motion/mobile contract.

### Modified Capabilities

None.

## Impact

`frontend/src/shared/ui/Toast.tsx` and `toast.css`; `frontend/src/features/toasts/` (`toastsSlice`, `toastListeners`);
`features/sources/ui/AddSourceModal.tsx`; `features/pipelines/ui/PipelineDetailPage.tsx`. Frontend-only; no backend,
API or schema change. No change to HEL-539's inline error components or to any component's inline error rendering.

## Non-goals

- **The toast-versus-inline policy audit — split out as HEL-771** after three design-gate rounds showed it needs a
  mechanically-derived classification rather than a hand-enumerated one. **This change therefore removes no toast that
  is a failure's only report, and does not alter the announcement posture of any existing failure path.** The one
  removal it makes is a *duplicate* success toast, where the action stays announced exactly once.
- `PanelList.tsx` and the `createDashboard.rejected` collision — HEL-770; that file is out of bounds entirely.
- A notification centre or history; redesigning HEL-539's inline components; skeleton/loading branches (HEL-528, live
  in parallel); empty-state CTA copy (HEL-548).
