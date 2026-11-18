import { useSyncExternalStore } from "react";

import { getTopOpenModal, subscribeOpenModals } from "./modalDialogRegistry";

// useTopModalDialog -- HEL-1668 D2: the most recently OPENED modal <dialog>, or null. A modal dialog's top layer covers
// (and makes inert) everything outside it, so UI that must stay visible and operable above one (the toast viewport)
// portals into it, the same pattern ActionsMenu, Select and OutputSchemaDisclosure use for their panels.
// HEL-1736: the dialogs come from `modalDialogRegistry` (written only by `Modal`), so nothing observes the document.

export function useTopModalDialog(): HTMLDialogElement | null {
  return useSyncExternalStore(subscribeOpenModals, getTopOpenModal, () => null);
}
