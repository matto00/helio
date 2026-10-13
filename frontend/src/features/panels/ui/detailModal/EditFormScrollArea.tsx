import type { FormEventHandler, ReactNode } from "react";

import { useScrollEdges } from "../../../../shared/ui/useScrollEdges";

interface EditFormScrollAreaProps {
  formId: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}

/**
 * The panel edit form plus a top/bottom scroll-fade overlay (HEL-1449, owner ruling
 * `scroll-hint`): signals content beyond the form's visible area, e.g. the Controls section of an
 * output panel sitting below the fold.
 *
 * It is its own component so `useScrollEdges` mounts WITH the form. The hook attaches its scroll
 * listener and ResizeObserver once, when its caller mounts, and the edit form only renders in edit
 * mode (the modal opens in view mode by default) — a hook call in the modal itself would never see
 * the form element. The fade is a sibling overlay rather than an inset shadow on the form because
 * an inset shadow paints under the form's children, and the Controls rows have an opaque
 * background exactly at the bottom edge.
 */
export function EditFormScrollArea({ formId, onSubmit, children }: EditFormScrollAreaProps) {
  const { ref, edges } = useScrollEdges<HTMLFormElement>();
  const fadeClass = [
    "panel-detail-modal__scroll-fade",
    edges.top ? "panel-detail-modal__scroll-fade--top" : "",
    edges.bottom ? "panel-detail-modal__scroll-fade--bottom" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="panel-detail-modal__scroll-area">
      <form id={formId} ref={ref} className="panel-detail-modal__content" onSubmit={onSubmit}>
        {children}
      </form>
      <div className={fadeClass} aria-hidden="true" />
    </div>
  );
}
