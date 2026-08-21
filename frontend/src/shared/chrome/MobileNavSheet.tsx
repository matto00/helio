import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import "./MobileNavSheet.css";
import type { CreateActionResult } from "../../features/dashboards/hooks/useCreateDashboardAction";
import { InlineError } from "./InlineError";
import { useOverlay } from "./OverlayProvider";
import type { PickerEmptyStateCopy } from "./pickerEmptyState";
import { EmptyState } from "../ui/EmptyState";

export interface MobileNavSheetItem {
  id: string;
  name: string;
  isActive: boolean;
  /** Optional secondary line under the name (Type Registry "Pipeline: <name>"
   * provenance, HEL-270). Other sections leave it unset and render name-only,
   * matching the desktop sidebar's `SidebarItem.subtitle`. */
  subtitle?: string;
}

interface MobileNavSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  items: MobileNavSheetItem[];
  onSelect: (item: MobileNavSheetItem) => void;
  /** Icon/title/description for the empty branch's `EmptyState` — see
   *  `pickerEmptyState.tsx` (HEL-773 design.md D11, replacing the retired
   *  `emptyMessage` string prop). */
  emptyState: PickerEmptyStateCopy;
  /** Header (list-branch) create action — `null` for sections with none.
   *  Suppressed whenever the empty branch renders instead (design.md D6). */
  createAction: CreateActionResult | null;
  /** Empty-branch CTA — `null` for sections with none. Registry sets ONLY
   *  this slot (design.md D7). */
  emptyCreateAction: CreateActionResult | null;
}

const DRAG_DISMISS_THRESHOLD_PX = 80;

// F-235: matches `PanelCreationModal.tsx`'s own hand-rolled focus-trap
// selector — this sheet isn't built on the native `<dialog>` `Modal`
// primitive (it's a portalled div, for the drag-to-dismiss gesture), so none
// of the trap/initial-focus/return-focus behavior `<dialog showModal>` gives
// the app's other "modal" implementations for free happens here on its own.
const FOCUSABLE_SELECTORS =
  'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Renders either a FontAwesome `IconDefinition` or a `ReactNode` (e.g. a
 *  `lucide-react` icon) — mirrors `EmptyState.tsx`'s private `renderCtaIcon`
 *  (not exported, so duplicated here rather than imported), markup AND
 *  sizing: the paired CSS (`.mobile-nav-sheet__create-action-icon` /
 *  `-icon svg`) mirrors `.ui-empty-state__cta-icon` / `-icon svg` verbatim
 *  (skeptic-final-1.md CR1 — without that pairing, a lucide `ReactNode`'s
 *  literal `width="24" height="24"` renders 2x the app's shipped CTA-icon
 *  size, since only the CSS half actually neutralises it). Used for the
 *  header create action, which is NOT an `EmptyState` CTA (design.md
 *  task 3.4: rendered as its own DESIGN.md §5 Secondary-recipe button, not
 *  an `li` of the item list) — hence the separate function and classes,
 *  not a shared import. */
function renderCreateActionIcon(icon: IconDefinition | ReactNode | undefined) {
  if (icon === undefined) return null;
  if (isValidElement(icon)) {
    return (
      <span className="mobile-nav-sheet__create-action-icon" aria-hidden="true">
        {icon}
      </span>
    );
  }
  return (
    <FontAwesomeIcon
      icon={icon as IconDefinition}
      className="mobile-nav-sheet__create-action-icon"
      aria-hidden
    />
  );
}

/**
 * Generic top-anchored sheet picker, portalled to `document.body`. Reused
 * for both the dashboard switcher and section-item navigation — one overlay
 * mechanism, not two, per `notes/mobile-pwa-handoff.md` §W3.2/§W3.3.
 *
 * HEL-773: descends from the top-chrome seam instead of rising from the
 * bottom (design.md D1/D2/D3) and offers a section-appropriate create
 * action (design.md D6-D10). Registers with `useOverlay` for
 * single-active-overlay + Escape semantics; dismisses on backdrop tap,
 * Escape, the trigger being tapped again, or an upward swipe past the
 * threshold.
 */
export function MobileNavSheet({
  open,
  onClose,
  title,
  items,
  onSelect,
  emptyState,
  createAction,
  emptyCreateAction,
}: MobileNavSheetProps) {
  const overlay = useOverlay();
  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  // Tracks whether `overlay.isActive` has actually become true for THIS open
  // session. Needed because `overlay.open()` (called below) updates shared
  // context state asynchronously: on the very render where `open` flips
  // true, `overlay.isActive` is still stale (false) from before the call.
  // Without this guard, the "external close" effect below would misread
  // that one-render staleness as an external dismissal and call `onClose()`
  // immediately — most visible when a consumer ever mounts the sheet with
  // `open` already `true` (e.g. a controlled test, or a future caller),
  // rather than always mounting closed and flipping `open` true later.
  const wasActiveRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const isEmpty = items.length === 0;
  // design.md D6 — exactly one create affordance is ever visible: the
  // header action when the list is showing, the empty branch's own CTA slot
  // when it isn't. Sources/pipelines/dashboards set both slots to the SAME
  // hook result (so this is a no-op distinction for them); registry sets
  // only `emptyCreateAction`, so its header action is `null` regardless of
  // `isEmpty` — never rendered, matching D7.
  const activeCreateAction = isEmpty ? emptyCreateAction : createAction;

  // design.md D9 — "a create was fired during this open session" flag,
  // gating whether `activeCreateAction.error` is shown (so a stale failure
  // from an earlier open never resurfaces — spec "A stale failure does not
  // resurface"). `useState`, not a plain ref: it must affect render output
  // (the error/pending presentation), so mutating it needs to schedule a
  // re-render on its own.
  const [attemptFired, setAttemptFired] = useState(false);

  // CR1 (evaluation-1.md) — reset on EVERY `open` transition, not just when
  // opening. The old `if (open)` guard left `attemptFired` uncleared across
  // a close: `App.tsx` recreates `onClose` on every `AppShell` render, so
  // the dismissal effect below re-evaluates far more often than `open`/
  // `attemptFired` actually change, and a stale `true` surviving the close
  // closed the very next open again (a ~14ms open-then-close flash,
  // requiring a second tap). Clearing here unconditionally means the flag
  // can never outlive its session, even for one render.
  useEffect(() => {
    setAttemptFired(false);
  }, [open]);

  // design.md D9 — dismissal timing for whichever create action is
  // currently active, handled uniformly for all four sections without this
  // component ever needing to know which hook backs it: only
  // `useCreateDashboardAction` ever reports `isPending: true` (the three
  // flag-flip hooks never do — their `isPending`/`error` are permanently
  // `false`/`null`), so a single "not pending and no error" check
  // dismisses a flag-flip hook on the very first post-fire pass (its values
  // never actually change, but `attemptFired` flipping true is itself
  // enough to re-run this effect once) while genuinely waiting out
  // dashboards' async create: `handleCreate` calls `setIsPending(true)`
  // synchronously, in the same event-handler tick as this component's own
  // `setAttemptFired(true)` below, so React's automatic batching guarantees
  // `isPending` already reads `true` by the time this effect's FIRST
  // post-fire pass runs — it only dismisses later, when the real
  // `isPending` true -> false transition lands (success), and stays open
  // when that same transition instead carries a non-null `error` (failure).
  //
  // CR1 (evaluation-1.md) — `!open` is load-bearing, not defensive filler:
  // `onClose` is recreated by `AppShell` on every one of its renders (it's
  // an inline closure, not memoized), and `onClose` sits in this effect's
  // own dependency array — so this effect re-evaluates on renders that have
  // nothing to do with `attemptFired`/`isPending`/`error` actually
  // changing, including the render where the sheet has just reopened but
  // the close-effect's `setAttemptFired(false)` (above) hasn't landed yet.
  // Never acting while `!open` means a stale `attemptFired` reread on that
  // race can't call `onClose()` on a session the user just started.
  useEffect(() => {
    if (!open || !attemptFired || activeCreateAction === null) return;
    if (!activeCreateAction.isPending && activeCreateAction.error === null) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attemptFired, activeCreateAction?.isPending, activeCreateAction?.error, onClose]);

  // F-235: initial focus + return focus. Moves focus into the sheet when it
  // opens (nothing does this automatically for a plain portalled div, unlike
  // `<dialog showModal>`), and restores focus to whatever opened it — the
  // mobile-title trigger button, typically — when it closes.
  //
  // design.md D10 — targets the active item, else the first item, else the
  // panel itself when the list is empty; NEVER the create action or the
  // empty-branch CTA (both of which sit ahead of the list in DOM order), so
  // that pressing Enter immediately after the sheet opens switches/selects
  // rather than creates.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (!panel) return;
    const activeItem = panel.querySelector<HTMLElement>(".mobile-nav-sheet__item--active");
    const firstItem = panel.querySelector<HTMLElement>(".mobile-nav-sheet__item");
    (activeItem ?? firstItem ?? panel).focus();
    return () => {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  // F-235: Tab/Shift+Tab cycle only through the sheet's own focusable
  // elements while it's open, mirroring `PanelCreationModal.tsx`'s identical
  // hand-rolled trap.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    function handleFocusTrapKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    panel.addEventListener("keydown", handleFocusTrapKeyDown);
    return () => panel.removeEventListener("keydown", handleFocusTrapKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      overlay.open();
    } else {
      overlay.close();
      setDragY(0);
      wasActiveRef.current = false;
    }
    // overlay.open/close are stable (useCallback), but re-running this effect
    // only on `open` changing is the intent here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (overlay.isActive) {
      wasActiveRef.current = true;
      return;
    }
    // The global Escape handler in OverlayProvider clears activeId directly;
    // when that happens while we're still "open" per our prop — and we had
    // actually become the active overlay at some point — tell the parent to
    // close so controlled state stays in sync. The `wasActiveRef` guard is
    // what prevents the stale-first-render false positive described above.
    if (open && wasActiveRef.current) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay.isActive]);

  if (!open) return null;

  function handleCreateClick() {
    if (activeCreateAction === null) return;
    setAttemptFired(true);
    activeCreateAction.cta.onClick();
  }

  // design.md D4 — inverted: an UPWARD drag (negative delta) past the
  // threshold dismisses. Clamped to `Math.min(0, delta)` so a downward drag
  // (toward the pinned top edge) does nothing.
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    dragStartYRef.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    const delta = event.clientY - dragStartYRef.current;
    setDragY(Math.min(0, delta));
  }

  function handlePointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY < -DRAG_DISMISS_THRESHOLD_PX) {
      onClose();
      return;
    }
    setDragY(0);
  }

  // Dynamic, user-driven drag position — the DESIGN.md inline-style exception
  // for gesture-following geometry.
  const panelStyle: CSSProperties | undefined =
    dragY < 0 ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined;

  const showCreateError =
    attemptFired && activeCreateAction !== null && activeCreateAction.error !== null;

  return createPortal(
    <>
      <button
        type="button"
        className="mobile-nav-sheet__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      {/* design.md D3 — the clip wrapper owns the top anchor (D1) and clips
          the panel's entrance at the top-chrome seam, correcting for the
          stacking context its own `clip-path` introduces (a naive
          `translateY` on a plain `--z-popover` panel would otherwise sweep
          through the command bar). */}
      <div className="mobile-nav-sheet__clip">
        <div
          ref={panelRef}
          className="mobile-nav-sheet__panel"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          style={panelStyle}
        >
          <div className="mobile-nav-sheet__header">
            <h2 className="mobile-nav-sheet__title">{title}</h2>
            {!isEmpty && createAction !== null && (
              <div className="mobile-nav-sheet__header-action-row">
                <button
                  type="button"
                  className="mobile-nav-sheet__create-action"
                  onClick={handleCreateClick}
                >
                  {renderCreateActionIcon(createAction.cta.icon)}
                  {createAction.cta.label}
                </button>
                {showCreateError && <InlineError error={activeCreateAction?.error ?? null} />}
              </div>
            )}
          </div>
          {isEmpty ? (
            <div className="mobile-nav-sheet__empty-wrap">
              <EmptyState
                variant="sidebar"
                intent={showCreateError ? "error" : "neutral"}
                // Hardcoded "dashboard" copy is deliberate, not a
                // section-generic label (design.md D9): only
                // `useCreateDashboardAction` can ever report a non-null
                // `error`, so this branch is unreachable for every other
                // section. Mirrors `PanelList.tsx`'s shipped treatment of
                // this exact same hook's failure state verbatim.
                icon={showCreateError ? <TriangleAlert /> : emptyState.icon}
                title={showCreateError ? "Couldn't create dashboard" : emptyState.title}
                description={
                  showCreateError ? (activeCreateAction?.error ?? "") : emptyState.description
                }
                // `EmptyState` wires its CTA's `onClick` directly, bypassing
                // `handleCreateClick` — the wrapped `onClick` below is what
                // gives this SAME cta the "attempt fired" tracking (D9) that
                // powers the error/pending presentation and dismissal
                // timing above, without diverging from the hook's own
                // label/icon/disabled.
                cta={
                  emptyCreateAction !== null
                    ? { ...emptyCreateAction.cta, onClick: handleCreateClick }
                    : undefined
                }
              />
            </div>
          ) : (
            <ul className="mobile-nav-sheet__list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={
                      item.isActive
                        ? "mobile-nav-sheet__item mobile-nav-sheet__item--active"
                        : "mobile-nav-sheet__item"
                    }
                    aria-pressed={item.isActive}
                    onClick={() => {
                      onSelect(item);
                      onClose();
                    }}
                  >
                    <span className="mobile-nav-sheet__item-text">
                      <span className="mobile-nav-sheet__item-name">{item.name}</span>
                      {item.subtitle !== undefined && (
                        <span className="mobile-nav-sheet__item-subtitle">{item.subtitle}</span>
                      )}
                    </span>
                    {item.isActive && (
                      <span className="mobile-nav-sheet__active-dot" aria-label="Current" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* design.md D4 — the grabber lives at the sheet's BOTTOM free
              edge on a top-anchored sheet (a top grabber would advertise
              dragging the pinned edge instead). Its own pointer-tracked
              region, distinct from the header above, so the create action's
              tap is never swallowed by the drag handler. */}
          <div
            className="mobile-nav-sheet__drag-strip"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <span className="mobile-nav-sheet__grabber" aria-hidden="true" />
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
