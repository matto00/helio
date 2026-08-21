## Context

`MobileNavSheet` is a portalled, bottom-anchored sheet with one render site (`MobileShell.tsx`), parameterised
per-section by `usePickerSelection(pathname)` over `PickerId`'s seven members, so every decision lands on all
of them at once. HEL-772 (`98862321`) landed the seam this was blocked on — `--app-safe-top` and
`--app-top-chrome-height`, whose comment names this ticket as the intended consumer and forbids re-deriving
the inset. The desktop twins (`SidebarItemList`/`SidebarBody`, `DashboardList`, `PanelList`) are the
consistency reference.

## Goals / Non-Goals

**Goals:** invert anchor, motion and dismiss gesture to the top edge; consume the HEL-772 seam; add
section-appropriate create actions; keep dismissal, focus-trap, focus-restore and reduced-motion behaviour.
**Non-Goals:** editing the HEL-548 hooks, any modal mount site, or `SidebarBody`/`SidebarItemList`/
`DashboardList` (HEL-554 owns the zero-dashboard surface); HEL-565 polish; bottom-nav/command-bar geometry.

## Decisions

**D1 — Anchor from the seam, on exactly one element.** The **clip wrapper** (D3) owns the anchor:
`top: var(--app-top-chrome-height)`. The command bar's border-box already equals `--app-command-bar-height`
plus the claimed inset, so that token puts the sheet's top edge exactly at the bar's bottom edge, satisfying
AC1/AC2 from one seam. **The panel carries no `top` of its own** — its existing `position: fixed`/`left`/
`right`/`bottom` declarations are removed and `position: relative` (D3) replaces them, so its top edge comes
from the wrapper. Repeating the token on both would be a *relative* offset from an already-correct in-flow
position, pushing the sheet a second seam-height down and detaching it from the bar — the precise failure D2
exists to prevent. The measurable form is `sheetRect.top === commandBarRect.bottom`.
`env(safe-area-inset-top)` MUST NOT appear in `MobileNavSheet.css`.

**D2 — The scrim stops at the seam; the bar stays lit.** This, not the panel, decides "reads as anchored".
Today's backdrop is `inset: 0` at `--z-popover-scrim`, and `.app-shell` is a stacking context at `z-index: 1`,
so the whole bar — trigger included — paints under a heavy dim whatever its local `z-index: 2` says, and a
sheet descending from a dimmed-out bar does not read as hanging off it. So the backdrop also starts at
`--app-top-chrome-height`, leaving the bar undimmed and the sheet attached. Taken deliberately: the trigger
stays hit-testable and is wired to **toggle the sheet closed** (today's full-viewport backdrop already makes a
tap there dismiss, so this preserves behaviour), and the bar's *other* controls go inert while open.
`role="dialog"`, `aria-modal`, the trap and focus restore are unchanged; leaving the disclosure trigger
interactive is a narrow, documented deviation — it already carries `aria-haspopup="dialog"`/`aria-expanded`.

**D3 — Clip wrapper, corrected for stacking.** A naive `translateY(-100%)` entrance sweeps the panel through
the command bar (portal at `--z-popover` 100 vs bar at 2). So the panel is wrapped: wrapper `position: fixed`,
owning the anchor per D1, **`left: 0; right: 0`** (a fixed element with only `top` is shrink-to-fit),
`z-index: var(--z-popover)`, clipped at its top edge only via `clip-path: inset(0 -100vmax -100vmax
-100vmax)`. **The panel becomes `position: relative` inside it** with a non-competing `z-index`: a computed
`clip-path`
establishes a stacking context, which would otherwise re-scope a `--z-popover` panel so the scrim paints over
it. That also makes the `overflow: hidden` fallback real — `overflow` does not clip a `fixed` descendant. The
wrapper takes `pointer-events: none`, the panel `auto`; this matters because a wrapper given `bottom: 0` would
swallow backdrop taps below the panel and break AC4. Fallback if the wrapper misbehaves: animate `clip-path:
inset(0 -100vmax 100% -100vmax)` -> `inset(0 -100vmax -100vmax -100vmax)` on the panel itself, which keeps the
shadow at rest. Prefer the wrapper: a clip wipe reveals static content, while the translate genuinely carries
the panel down from the bar, which is the ticket's point.

**D4 — Drag inverts upward and keeps a real target.** `handlePointerMove` clamps `Math.min(0, delta)`;
dismissal fires below `-DRAG_DISMISS_THRESHOLD_PX`. The grabber moves to the sheet's **bottom free edge** — on
a top-anchored sheet a top grabber would advertise dragging the pinned edge — and its strip carries a literal
`44px` min-height. `padding-bottom: env(safe-area-inset-bottom)` is **removed**: under a top anchor it double-
counts the inset D5 already subtracts, and it would float the grabber above the true bottom edge. Pre-existing
and out of scope: the panel does not visually track the finger, because `animation: … both` leaves
`translateY(0)` at the animation origin outranking the inline transform. Do not debug it (HEL-565 is parked).

**D5 — Height must clear the floating capsule and the home indicator.** `max-height:
calc(100dvh - var(--app-top-chrome-height) - var(--bottom-nav-height) - var(--space-3))`. `--bottom-nav-height`
is already the aggregate of capsule height, inset and bottom safe-area inset, and its comment names itself the
single source of truth for consumers that just need to clear the bar — so consume it rather than re-inlining a
fourth copy. `--space-3` matches `--bottom-nav-inset`, so the two gaps read as one rhythm. This is load-bearing: the capsule floats at `z-index: 5`, below scrim and panel,
so a sheet extending into that band paints over a translucent capsule, and D4's strip would land in the iOS
home-indicator band where the dismissal gesture is now an *upward* drag, the same direction as the system edge
swipe. The HEL-772 prohibition is on deriving the **top anchor** from bottom-nav tokens; bottom clearance is
exactly what they are for, and the CSS lock is scoped to the `top` declaration accordingly.

**D6 — Two create slots, one visible affordance.** `PickerSelection` carries `createAction` (header) and
`emptyCreateAction` (empty-branch CTA) separately, mirroring `SidebarItemList`'s shipped `onAdd` vs `emptyCta`
distinction. Per section: dashboards/sources/pipelines set both to the same result; **registry sets
`emptyCreateAction` only** (see D7); metrics/chat/other set neither. Arbitration is unchanged — when the empty
branch renders, its CTA is the sole affordance and the header action is suppressed — which also keeps "one
primary per view" intact, since `EmptyState`'s CTA is Primary and the header action is DESIGN.md §5 Secondary.

**D7 — Registry is not create-less; the ticket's premise was wrong.** `SidebarBody` already passes
`useCreatePipelineAction().cta` as the Data Types list's `emptyCta`, with a comment recording the decision:
the section has no create action of its own, so it gets the CTA without a header icon. Types are produced by
pipelines, so "create a pipeline" *is* registry's create path, and desktop parity is the argument: the sheet
mirrors the sidebar, and the sidebar gives this section a CTA. Precisely: the registry *page* already renders
its own main `EmptyState` with this same CTA, so omitting it would leave only the sheet's empty branch
actionless, not the section — one dismiss from the page's hero CTA. So registry gets the empty-branch CTA
only. No new hook and no new modal mount: the hook is already called unconditionally by D8,
and `CreatePipelineModal` is mounted on every route except `/pipelines`, which covers `/registry`. Metrics and
assistant genuinely have no hook (their sidebar CTAs dispatch inline), so they stay create-less by scope.

**D8 — Per-section plumbing.** All three hooks are called unconditionally at the top of `usePickerSelection`
and the switch selects. It has **three** call sites (`CommandBar`, `MobileShell`, `App`), so they run per
render at every viewport — verified inert (no `useEffect` in any). `CreateActionResult` is declared separately
in each hook file; the fence forbids consolidating them, so import one, do not refactor.

**D9 — Error, pending, and when the sheet closes.** Only `useCreateDashboardAction` can go pending or fail, so
this is one treatment, not three — and dismissal must not race it. **Sources/pipelines/registry dismiss on
fire**: pure flag flips that cannot fail, and their modal must not open behind the sheet. **Dashboards keeps
the sheet open while pending and dismisses only on success**, so its label swap and any error land on a
control that still exists. On failure the sheet stays open and renders error-intent `EmptyState` (empty
branch, mirroring `PanelList`'s shipped treatment for this same hook) or the shared inline-error primitive
beside the header action (list branch) — `EmptyState` cannot be reused there, being a whole-surface treatment
that would replace the list the user opened the sheet to use. `isPending` is expressed by the hook's own
label swap; the control is **not** disabled, preserving a choice the hook explicitly locked. **All of this is
consumer-side.** The hook returns only `{cta, error, isPending}` — no reset function, no success callback —
and it is fenced, so none of it may be added. So the sheet keeps its own "a create was fired during this open
session" flag, set on fire and reset when `open` flips true, and surfaces `createAction.error` only while that
flag is set; success is inferred from an `isPending` true->false transition observed with `error === null`
(the hook's `setError` and its `finally` batch into one render, so this is safe, but it needs a ref to
distinguish the transition from the initial `false`). That is what keeps a stale failure from resurfacing —
`MobileShell` never unmounts, so the hook's state outlives the sheet — without touching a fenced file.

**D9b — The chevron becomes a direction affordance.** `CommandBar` renders `ChevronDown`. Under a bottom
sheet it pointed away from the motion; under a top sheet it points at it. But D2 makes the trigger a toggle,
so its direction now also encodes state, and a chevron left pointing down while the sheet is open reads as
"more to pull". It flips (or rotates over `--app-transition`) while open — one line, no new token, the
smallest possible reinforcement of the ticket's thesis.

**D10 — Initial focus stays off the create action.** The sheet focuses the first focusable in DOM order —
today the first row; D6 puts the create action above the list, so unchanged code would focus it, and pressing
Enter on the dashboards picker would create an untitled dashboard. Focus therefore targets the **active item,
else the first item, else the panel itself** when the list is empty; the empty CTA is one Tab away.

**D11 — Empty-state copy: one table, honestly scoped.** `EmptyState` requires `icon`/`title`/`description`
while the sheet has only `emptyMessage` (retired here, with all seven of its values). A shared per-section
table supplies all three, covering every `PickerId` member including the unreachable `other`. Parity with the
desktop sidebar is **locked by test for the sidebar-owned sections only**; dashboards is excluded because its
sidebar copy lives in `DashboardList`, the zero-dashboard surface HEL-554 is rewriting, so a lock pinned to it
is a scheduled breakage. The spec claims only what is built.

**D12 — Reduced motion.** The existing `prefers-reduced-motion` block sits *after* the panel's `animation`
and works today; the hazard is additive, since a wrapper rule declared after it at equal specificity would
win. So the wrapper selector joins that existing block — extend it, do not "fix" it — and AC5 is proven on the
running app by computed `animation-name: none` for both elements.

**D13 — Guards narrowed, not deleted; stale text owned.** The "no CRUD affordances" guard is rewritten to
assert the surviving prohibitions AND the single create action. The spec requirement is renamed via
REMOVED+ADDED, the sibling "Tappable command-bar title" requirement (whose scenario still said "bottom sheet")
is modified in the same delta, and the stale capability Purpose is corrected by an explicit task, not a
promise. `EmptyState.css`'s 44px comment calls the floor defensive because "the sidebar column is not mounted
at this breakpoint" — this change renders `variant="sidebar"` at phone width for the first time, so that
comment becomes false and is corrected too.

**D14 — Mount constraint holds structurally, and must be proven.** The sheet is section-scoped: "Add source"
exists only on `/sources`, where `SourcesPage` mounts `AddSourceModal`; pipelines are covered on both
branches, registry via the off-route mount, dashboards need no modal. AC9 wants a test opening the real modal
— the dashboards action, having none, is verified by its POST instead.

## Risks / Trade-offs

- **The 44px floor has regressed six times here**, twice via rules that read right and computed wrong. Rows,
  header action, empty-branch CTA (`.ui-empty-state__cta`) and drag strip must all be measured with
  `getComputedStyle`/`getBoundingClientRect` on the running app at 430 and 768 — never read off the CSS.
- **D2 is the highest-consequence decision.** Its fallback is a full-viewport scrim with a dimmed trigger,
  degrading to today's behaviour minus the anchoring read. Inert-but-undimmed bar controls are a small honesty
  gap worth judging visually at the final gate — as is dark theme, where the panel (`--app-surface-strong`) is
  lighter than the bar (`--app-surface`), separated only by the bar's hairline. Judge "reads as anchored"
  visually in both themes rather than by token, and confirm D3's clipping empirically.

## Planner Notes

Self-approved: the bounded HEL-782 fold-in; D2's scrim decision; D7's registry correction (the ticket's "no
hook exists" premise was factually wrong); D9's per-section dismissal rule. Spinoffs to file: (1) phone users
cannot rename a quick-created dashboard, rename living only in the sidebar's per-row menu; (2) metrics and
assistant have no sheet create action while their desktop siblings do, and chat's lives in the command bar
(HEL-746) one tap away; (3) HEL-565 should note that the inverted drag has neither gestural feedback nor an
exit animation to teach it — the sheet unmounts instantly, so dismissal has no motion back toward the bar.
