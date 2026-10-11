import type { ToastInput } from "../../toasts/state/toastsSlice";
import type { PatchSetUndoResponse } from "../types/patchSet";

/** How long a toast that reports a kept data source stays up: its reason is a full sentence, which the default
 *  auto-dismiss would not leave time to read. */
const KEPT_TOAST_DURATION_MS = 12000;

/** The toast shown after a successful undo (HEL-1493). A plain `Undone.` success unless undo kept an inline source
 *  the apply had created; then a warning that adds one line per kept source, each using that source's own `reason`
 *  (never hardcoded wording). The lines are separated by `\n`, which `.toast__message` renders as line breaks. */
export function undoSuccessToast(response: PatchSetUndoResponse): ToastInput {
  const keptLines = response.edits
    .flatMap((edit) => edit.inlineSources ?? [])
    .filter((source) => source.result === "kept")
    .map((source) => {
      const reason = source.reason ?? "";
      return source.name
        ? `Kept data source "${source.name}": ${reason}`
        : `Kept a data source: ${reason}`;
    });
  if (keptLines.length === 0) return { variant: "success", message: "Undone." };
  return {
    variant: "warning",
    message: ["Undone.", ...keptLines].join("\n"),
    duration: KEPT_TOAST_DURATION_MS,
  };
}
