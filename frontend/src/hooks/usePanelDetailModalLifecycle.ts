// Modal lifecycle wiring for `PanelDetailModal`.
//
// Owns:
//   - the <dialog> ref + initial showModal() on mount
//   - the cancel/click/keydown listeners that drive close + discard prompts
//   - the modal-mode ref + dirty-flag ref kept in sync with React state so
//     the event handlers always see the latest values without re-binding
//
// Extracted from the modal so the modal stays under the file-size cap.

import * as React from "react";
import { useEffect, useRef } from "react";

export interface PanelDetailModalLifecycleOptions {
  modalMode: "view" | "edit";
  isAnyDirty: boolean;
  setShowDiscardWarning: (show: boolean) => void;
  setModalMode: (mode: "view" | "edit") => void;
  onClose: () => void;
  resetFormToPanel: () => void;
}

export interface PanelDetailModalLifecycleResult {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
}

export function usePanelDetailModalLifecycle(
  options: PanelDetailModalLifecycleOptions,
): PanelDetailModalLifecycleResult {
  const { modalMode, isAnyDirty, setShowDiscardWarning, setModalMode, onClose, resetFormToPanel } =
    options;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const modalModeRef = useRef(modalMode);
  modalModeRef.current = modalMode;

  const isAnyDirtyRef = useRef(isAnyDirty);
  isAnyDirtyRef.current = isAnyDirty;

  // Keep the cancel handler pointing at the latest closure so the DOM event
  // listeners (registered once) call into current React state.
  const cancelEditModeRef = useRef<() => void>(() => {});
  cancelEditModeRef.current = () => {
    resetFormToPanel();
    setModalMode("view");
  };

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    function attemptClose() {
      if (modalModeRef.current === "view") {
        dialog!.close();
        onCloseRef.current();
        return;
      }
      if (isAnyDirtyRef.current) {
        setShowDiscardWarning(true);
      } else {
        cancelEditModeRef.current();
      }
    }

    function handleCancelEvent(e: Event) {
      e.preventDefault();
      attemptClose();
    }

    function handleClick(e: MouseEvent) {
      if (e.target === dialog) attemptClose();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (modalModeRef.current !== "view") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "e" || e.key === "E") {
        setModalMode("edit");
      }
    }

    dialog.addEventListener("cancel", handleCancelEvent);
    dialog.addEventListener("click", handleClick);
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("cancel", handleCancelEvent);
      dialog.removeEventListener("click", handleClick);
      dialog.removeEventListener("keydown", handleKeyDown);
    };
    // Event listeners read from refs; intentionally bound once. The
    // referenced setters are stable React state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { dialogRef };
}
