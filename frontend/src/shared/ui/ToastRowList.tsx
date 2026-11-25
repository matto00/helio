import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";

import type { ToastListItem } from "../../features/toasts/state/toastsSlice";
import { useScrollEdges } from "./useScrollEdges";

interface ToastRowListProps {
  toastId: string;
  items: ToastListItem[];
}

/** The per-pipeline rows of a multi-item toast (HEL-1172 D5): a link, its reason text and an optional run action. */
export function ToastRowList({ toastId, items }: ToastRowListProps) {
  // D8 — after a row's run action was used with focus on it, that action is gone; its row's link takes focus.
  const focusLinkAfterRef = useRef<number | null>(null);
  const linkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  useLayoutEffect(() => {
    const index = focusLinkAfterRef.current;
    if (index === null) return;
    focusLinkAfterRef.current = null;
    linkRefs.current[index]?.focus();
  }, [items]);

  // HEL-1840 D3 — while the list scrolls and rows remain below, the frame carries the attribute that draws the fade.
  // Rows are never added to or removed from a mounted toast (a run action shrinks an observed row), so the hook's
  // mount-time observation of the list's children is enough.
  const { ref: listRef, edges } = useScrollEdges<HTMLUListElement>();

  return (
    <div className="toast__list-frame" data-overflow-below={edges.bottom ? "true" : undefined}>
      <ul ref={listRef} className="toast__list" aria-label="Pipelines not updated">
        {items.map((item, index) => {
          const rowTextId = `toast-row-${toastId}-${index}`;
          const action = item.action;
          return (
            <li key={item.key} className="toast__list-item">
              <Link
                ref={(el) => {
                  linkRefs.current[index] = el;
                }}
                className="toast__link"
                to={item.linkTo}
              >
                {item.linkLabel}
              </Link>
              <span id={rowTextId} className="toast__list-text">
                {item.text}
              </span>
              {action !== undefined && (
                <button
                  type="button"
                  className="toast__action"
                  aria-label={`${action.label}: ${item.linkLabel}`}
                  aria-describedby={rowTextId}
                  onClick={(e) => {
                    if (document.activeElement === e.currentTarget) {
                      focusLinkAfterRef.current = index;
                    }
                    action.onClick();
                  }}
                >
                  {action.label}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
