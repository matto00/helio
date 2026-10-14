// Inline panel-title editing state for `DesktopPanelGrid` (HEL-1418 split; behaviour unchanged).

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useAppDispatch } from "../../../../hooks/reduxHooks";
import { accumulatePanelUpdate } from "../../state/panelsSlice";

export function usePanelTitleEditing() {
  const dispatch = useAppDispatch();
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingTitleError, setEditingTitleError] = useState<string | null>(null);
  const titleCancelledRef = useRef(false);
  // Ref so that commitTitleEdit can read the latest editingTitle without
  // being recreated on every keystroke (keeps onTitleKeyDown stable).
  const editingTitleRef = useRef(editingTitle);
  useEffect(() => {
    editingTitleRef.current = editingTitle;
  });

  const cancelEditingTitle = useCallback(() => {
    titleCancelledRef.current = true;
    setEditingTitleId(null);
    setEditingTitleError(null);
  }, []);

  const commitTitleEdit = useCallback(
    (panelId: string) => {
      if (titleCancelledRef.current) return;
      const trimmed = editingTitleRef.current.trim();
      if (trimmed.length === 0) {
        setEditingTitleError("Title must not be blank.");
        return;
      }
      setEditingTitleId(null);
      setEditingTitleError(null);
      dispatch(accumulatePanelUpdate({ panelId, fields: { title: trimmed } }));
    },
    [dispatch],
  );

  /** Enters title edit for `panelId`. Stable identity (`[]` deps). */
  const beginTitleEdit = useCallback((panelId: string, currentTitle: string) => {
    setEditingTitleId(panelId);
    setEditingTitle(currentTitle);
    setEditingTitleError(null);
    titleCancelledRef.current = false;
  }, []);

  const handleTitleChange = useCallback((value: string) => {
    setEditingTitle(value);
    setEditingTitleError(null);
  }, []);

  const handleTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, panelId: string) => {
      if (event.key === "Enter") {
        commitTitleEdit(panelId);
      } else if (event.key === "Escape") {
        cancelEditingTitle();
      }
    },
    [commitTitleEdit, cancelEditingTitle],
  );

  const handleTitleBlur = useCallback(
    (panelId: string) => {
      commitTitleEdit(panelId);
    },
    [commitTitleEdit],
  );

  return {
    editingTitleId,
    editingTitle,
    editingTitleError,
    beginTitleEdit,
    handleTitleChange,
    handleTitleKeyDown,
    handleTitleBlur,
  };
}
