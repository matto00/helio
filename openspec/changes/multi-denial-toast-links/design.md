## Context

See proposal.md (Why). Current state, verified on main 1b3c309e0:

- `buildDeniedPipelinesToast(denied, onRunToUpdate)` (`features/pipelines/services/deniedPipelinesToast.ts`)
  is pure; for N >= 2 it returns `{variant: "warning", message}` — no action, default 4 s duration.
- `Toast` (`features/toasts/state/toastsSlice.ts`) carries one optional `action: {label, onClick}` and a
  plain-text `message`. `pushToast` coalesces an identical variant+message; `isEvictionExempt` exempts
  `duration === 0` or an `action`. Functions already live in toast state (the existing `action.onClick`).
- `ToastItem` (`shared/ui/Toast.tsx`) renders the message as an `aria-hidden` `<p id=messageId>` and one
  `.toast__action` button `aria-describedby={messageId}`; announcement comes only from the viewport's
  polite/assertive live regions, which render `toast.message`.
- `ToastViewport` is mounted inside `BrowserRouter` (`App.tsx:433`, `main.tsx:114`), so a react-router
  `Link` works inside a toast.
- The only caller is `FormPanelView.pushDenialToastIfAny`; `useRunToUpdate()` returns
  `(pipelineId, dismissToastId?) => void` and pushes the run outcome as its own toast.
- `canRun` (server, `AutoRunTriggerService.handleDenied`): owner or editor grantee -> true unless a
  `step-config-invalid` reason; viewer grantee -> false; no grant -> not returned at all.

Owner ruling (HEL-1172 Planning escalation, answered 2026-11-23): Q1 = per-row link + inline
"Run to update" where `canRun`; Q2 = list every pipeline, scroll inside the toast, no truncation.

## Goals / Non-Goals

**Goals:** per-pipeline link + per-pipeline run for N >= 2; persistent while it holds links/actions;
keyboard reachable; computed-ARIA distinguishable rows; no toast storm.

**Non-Goals:** changing the N = 1 toast; touching any pipeline page component (HEL-1794 in flight);
backend/schema changes; a generic multi-action toast API beyond what this needs; truncation.

## Decisions

**D1 — Data model: optional `items` on `Toast`, not multiple `action`s.**
Add to `toastsSlice.ts`:
```ts
export interface ToastListItem {
  key: string;            // stable per toast (the pipeline id)
  linkLabel: string;      // pipeline name
  linkTo: string;         // in-app path, "/pipelines/<encodeURIComponent(id)>"
  text: string;           // the reason sentence(s) for this row
  action?: ToastAction;   // per-row action; absent = link only
}
// Toast gains: items?: ToastListItem[]
```
`message` stays the deterministic aggregate (`"Name: reasons"` lines, sorted by id) — it is still the
coalescing key and the live-region announcement, so dedup and announcement behaviour are unchanged.
`isEvictionExempt` additionally exempts a toast whose `items` is non-empty (a link the user must be
able to reach). Alternative considered: `actions: ToastAction[]` — rejected, it cannot express
link-only rows (viewer) or pair each action with its reason for `aria-describedby`.

**D2 — New reducer `consumeToastItemAction({toastId, key})`.** Removes that row's `action` (row and
link stay). If after removal no row in that toast has an `action` AND the toast had at least one row
action before, the toast is removed (same as `dismissToast`). A toast that never had row actions (all
viewer rows) is unaffected by this reducer and stays until the user dismisses it. Unknown
toastId/key is a no-op. Rationale: mirrors the single-pipeline toast, which dismisses itself on run
(useRunToUpdate's `dismissToastId`), so a used affordance never lingers clickable.
Note: removing via the reducer skips the exit animation (as `useRunToUpdate`'s existing synchronous
`dismissToast` already does); acceptable and consistent. Focus after a consume is D8.

**D3 — Builder signature.** `buildDeniedPipelinesToast(denied, onRunToUpdate: (pipelineId: string) => void)`.
- N = 1: unchanged output (same message, same `action` when `canRun`, `duration: 0` only with the
  action); its onClick calls `onRunToUpdate(denied[0].pipelineId)`.
- N >= 2: `{variant: "warning", message, duration: 0, items}` with one item per denied pipeline in the
  same id-sorted order as the message; `text` = that pipeline's `reasons.map(denyReasonCopy).join(" ")`
  (the exact text after "Name: " in the message line); `action = {label: "Run to update", onClick: () =>
  onRunToUpdate(p.pipelineId)}` only when `p.canRun`. Always `duration: 0` (every row is a link).
Builder stays pure; no `toastId` knowledge.

**D4 — Caller (`FormPanelView`).** For N = 1 keep today's `runToUpdateAction(id, toastId)` (dismiss on
click). For N >= 2 the callback is `(id) => { runToUpdateAction(id); dispatch(consumeToastItemAction(
{toastId, key: id})); }`. `toastId` is the const assigned from `pushToast(...)` (already the existing
closure pattern). Keep `FormPanelView` changes minimal (HEL-1618 just split it); if the closure logic
grows, put it in a small helper next to the builder rather than in the component.

**D5 — Rendering (`ToastItem`).** When `toast.items` is non-empty:
- The message `<p id={messageId}>` is rendered with the `hidden` attribute (still a valid
  `aria-describedby` target for the dismiss button; not shown, since the rows show the same text).
- Below it a `<ul className="toast__list" aria-label="Pipelines not updated">` with one `<li
  className="toast__list-item">` per item, in order: `<Link className="toast__link" to={linkTo}>
  {linkLabel}</Link>`, then `<span id={rowTextId} className="toast__list-text">{text}</span>`, then
  (when `action`) `<button type="button" className="toast__action" aria-label={`${label}: ${linkLabel}`}
  aria-describedby={rowTextId} onClick={action.onClick}>{label}</button>`. `rowTextId` is derived from
  toast id + row index (not the raw key, which may contain any characters).
- The accessible name "Run to update: <name>" begins with the visible label (WCAG 2.5.3 label in name)
  and makes identical buttons distinguishable. The link's name is the pipeline name.
- Row reason text is visible to AT (not aria-hidden) — the region landmark is how a keyboard/SR user
  browses to the controls, and each row needs its reason there; the live region still announces the
  aggregate once (no change to announcement).
- Link click does not dismiss the toast (the user may want the other rows); the dismiss button is
  unchanged. Tab order: link, action (if any), next row..., then dismiss — DOM order.
- When `items` is absent, rendering is byte-identical to today.
- `.toast__list` carries a small inline/block padding (`--space-*` token) so the global
  `:focus-visible` outline (`theme.css`, `outline-offset: 2px`) of a link/button at the list edge is
  not clipped by the scroll container.

**D6 — Styling (`toast.css`, tokens only, DESIGN.md).** `.toast__list` : no bullets, zero padding,
`display:flex; flex-direction:column; gap: var(--space-1)`, `max-height: min(40vh, 16rem)`,
`overflow-y: auto` (Q2: scroll, no truncation; it holds focusable links, so it is keyboard-scrollable
by focus — axe `scrollable-region-focusable` satisfied). `.toast__link`: inherits the toast text
color, underlined, `font-weight` of the existing action. No toast-local focus rule: links and buttons
rely on the global `:focus-visible { outline: var(--app-focus-ring) }` rule in `theme/theme.css`, as
the other toast controls do (never a bare `:focus` rule). Row action reuses the
existing `.toast__action` class unchanged. Must look right in light and dark themes, desktop and the
390 px mobile toast width.

**D7 — Toast storm.** No new throttle: the message is deterministic over (sorted ids, reasons), so
identical repeated writes coalesce into one toast through the existing reducer (now also covering the
N >= 2 shape, which gains `duration: 0` — the coalesce replaces, it never stacks). A repeat write after
a row action was consumed replaces the toast with a fresh one carrying all row actions again — a new
write is a new denial, so offering the run again is correct.

**D8 — Focus after a row action is consumed (keyboard reachability, AC2).** Activating a row's
"Run to update" unmounts that button (D2), and the last one unmounts the whole toast; focus must never
fall to `<body>`.
- **Rows remain (the toast survives):** the activated row's own link, which survives the consume,
  receives focus. Implemented in `ToastItem`: the row button's click handler records the row index,
  and a layout effect keyed on the toast's `items` focuses that row's link after the action is gone
  (only if focus was inside this toast at the click, i.e. the button was `document.activeElement`).
  Tab from there reaches the next row's link/button in row order.
- **Last action consumed (the toast is removed):** `ToastItem`'s existing unmount hand-off (the
  `useLayoutEffect` cleanup that today only runs inside a modal dialog) is extended to the
  non-modal case: if the removed toast contained `document.activeElement`, focus moves to, in order,
  (1) the element that had focus immediately before focus entered the toast viewport — recorded by
  `ToastViewport` from the viewport's `focusin` event `relatedTarget` (only an element outside the
  viewport), if it is still connected and focusable (e.g. the form's Submit button); else (2) the first
  focusable control of another toast still in the viewport; else (3) the `<main id="app-main-content">`
  landmark (the skip-link target), focused programmatically with `tabIndex=-1` set if absent. Inside a
  modal the existing dialog behaviour is kept unchanged. Alternative rejected: keeping the toast open
  after its last action (contradicts the owner-accepted Q1 behaviour, "closes when nothing actionable is
  left").
- The same hand-off applies to the N = 1 toast's own run action and the dismiss button, which today
  drop focus to `<body>` outside a modal; that is a strict improvement and not a behaviour regression.

## Risks / Trade-offs

- [Functions in Redux state] → `store.ts` `ignoredPaths: ["toasts"]` already covers state, but
  `ignoredActionPaths: ["payload.action.onClick"]` does NOT cover `payload.items.N.action.onClick` in the
  `pushToast` action: extend it (e.g. add `payload.items`) and add a failable `store.test.ts` case
  mirroring the existing one.
- [Persistent link-only toasts can stack past MAX_VISIBLE_TOASTS] → distinct all-viewer denials from
  different panels are all exempt, and the reducer admits when everything is exempt. Accepted under the
  Q1 ruling; noted in the PR.
- [Persistent N >= 2 toast fills the 3-toast cap with exempt toasts] → the reducer already admits a push
  when every toast is exempt; coalescing keeps one per distinct denial.
- [Many pipelines] → scroll region with a bounded max height; checked at 390 px.
- [Running an AI pipeline from e2e would call a model] → e2e uses non-AI denial reasons
  (`steps-above-bound`, as hel1096's spec does) and/or routes the run POST; servers start with
  ANTHROPIC_API_KEY empty.

## Migration Plan

Frontend only; ship and roll back with the release. No data migration.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit-invoked script is touched.
