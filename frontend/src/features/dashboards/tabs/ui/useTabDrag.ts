import { useState, type DragEvent } from "react";

import { moveTab } from "../dashboardTabsSlice";
import { useAppDispatch } from "../../../../hooks/reduxHooks";

export interface TabDropIndicator {
  /** The tab the indicator is drawn beside. */
  id: string;
  side: "before" | "after";
}

/** Native HTML5 drag-to-reorder for the tab strip (HEL-1575 D8; `StepCardHeader` is the codebase precedent, no
 *  drag library). The drop position is the nearer half of the hovered tab; one `moveTab` (hence one saved
 *  order) is dispatched on drop. */
export function useTabDrag(tabIds: string[]) {
  const dispatch = useAppDispatch();
  const [dragId, setDragId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<TabDropIndicator | null>(null);

  function reset() {
    setDragId(null);
    setIndicator(null);
  }

  function handlers(id: string) {
    return {
      draggable: true,
      onDragStart(event: DragEvent<HTMLElement>) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        setDragId(id);
      },
      onDragOver(event: DragEvent<HTMLElement>) {
        if (dragId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
        setIndicator((current) =>
          current?.id === id && current.side === side ? current : { id, side },
        );
      },
      onDrop(event: DragEvent<HTMLElement>) {
        event.preventDefault();
        if (dragId !== null && indicator !== null) {
          const from = tabIds.indexOf(dragId);
          const slot = tabIds.indexOf(indicator.id) + (indicator.side === "after" ? 1 : 0);
          const toIndex = slot > from ? slot - 1 : slot;
          if (from !== -1 && toIndex !== from) dispatch(moveTab({ id: dragId, toIndex }));
        }
        reset();
      },
      onDragEnd: reset,
    };
  }

  return { dragId, indicator, handlers };
}
