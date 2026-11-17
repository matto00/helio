## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: d60b1f799d78291e165bcc1226b4a3c625c66fa0 (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Handle is `touch-action: none` today.** `frontend/src/shared/ui/DataGrid.css:321-331` (`.ui-data-grid__resize-handle`, 8px `--space-2`, `translateX(50%)`, `touch-action: none`). Matches the ticket and design Context.
- **Resize gesture is mouse-only; touch never resized.** `DataGrid.tsx:755-785` `handleResizeStart` is a `ReactMouseEvent` handler that installs window `mousemove`/`mouseup` only; `DataGrid.tsx:1143-1145` wires `onMouseDown`, `onPointerDown={stopPointerPropagation}` (stopPropagation only, `DataGrid.tsx:787-789`), `onKeyDown`. No touch/pointer-move path exists. A touch drag on the handle therefore resized nothing before; `touch-action: none` only blocked panning. Claim confirmed.
- **`pan-y` cannot affect desktop mouse resize.** `touch-action` applies to touch/pen pointer types only; the mouse path (mousedown -> window mousemove) is untouched by construction. The desktop guard (task 3.1) is required to be failable by mutation. Sound.
- **Pen claim.** Plausible (horizontal pen drags under `pan-y` are not panned, so compat mouse events still reach the mouse-driven resize), but it is a rationale, not an AC, and is not tested. Non-blocking.
- **No other touch-action/overscroll blocker on the path.** `grep touch-action|overscroll-behavior frontend/src/**/*.css`: the only header-relevant hit is DataGrid.css:329. `PanelGrid.css:191` is the desktop RGL card handle (`.panel-grid-card__handle`), not on the phone stack. `MobilePanelStack.css:202-204` puts `overscroll-behavior-y: contain` on `.app-content[data-pull-refresh]` only — it constrains chaining past `.app-content`, not into it. DataGrid scrollers (`.ui-data-grid { overflow: auto }` DataGrid.css:63-66; `.mobile-panel-stack__item--table .panel-content--table { max-height: 60dvh; overflow-y: auto }` MobilePanelStack.css:102-106) carry no overscroll-behavior. Design's chaining claim confirmed statically; D3 correctly requires measurement before declaring it.
- **JS touch interference.** `usePullToRefresh.ts:249-250` adds a non-passive `touchmove` on `.app-content` that may `preventDefault` near the top; the e2e plan scrolls `.app-content` away from the top before dragging, which neutralises it. Sound.
- **Phone Tables are resizable.** `DataGrid.tsx:445` `resizable = variant === "full"`; handle rendered for non-inert columns (`:1136`).
- **hel1656 stale comment** exists at `e2e/hel1656-pull-to-refresh.spec.ts:111-112` ("resize handles are `touch-action: none`"); task 2.2 covers it.
- **AC coverage.** AC1 (375/430 touch, handle + header) -> tasks 1.1/1.2/2.1; AC2 (desktop resize) -> 3.1; AC3 (red-first e2e) -> 1.1 with explicit stop-if-not-red; AC4 (capped body triaged) -> 4.1 + spec scenario. No AC uncovered, no scope drift (one CSS property, e2e, comment fix).
- **Product-decision check.** The chosen fix neither adds nor removes a capability (touch resize never existed; keyboard and mouse resize unchanged; handle stays focusable). Hiding the handle / adding touch resize are correctly rejected as product calls. D3 explicitly escalates if a capped-body fix would require an interaction choice. Not escalation-worthy as planned.
- **Placeholders / contradictions.** None found; tasks, design and spec delta agree.

### Verdict: CONFIRM

### Non-blocking notes

- The spec delta softens the AC slightly ("SHALL scroll the page whenever the Table's own body cannot scroll further in that direction"). For an overflowing capped Table, a header drag scrolls the body first. This is the ticket's own "capped-body case ... fixed or documented" carve-out, so documenting it is within the ticket. The PR body should state it plainly so the owner sees it.
- Task 4.1 should name which scroller it reads (`.panel-content--table` vs `.ui-data-grid`, both are scroll containers) and assert the body was really at `scrollTop = 0` and overflowing before the drag. Otherwise the "chains" assertion can pass vacuously on a body that never overflowed.
- 1.2 (header text) may already be green on unmodified CSS. That is fine, but record it as a guard, not as red-first proof.
- The pen-resize rationale in D1 is untested. Either keep it as a stated rationale or drop it from the code comment so the comment makes no claim the tests do not back.
- The spec mentions keyboard resize. Existing DataGrid unit tests should cover it; 5.1 runs them.
