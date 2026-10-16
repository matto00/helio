import type { MouseEvent } from "react";

import { openTabInBackground } from "../dashboardTabsSlice";
import type { AppDispatch } from "../../../../store/store";

/** HEL-1575: a middle-click, or a click with ⌘ (macOS) / Ctrl held, on a dashboard in the context list opens it
 *  as a background tab: no navigation, no selection change. `true` when the event was one of those (the caller
 *  then skips its normal select). */
export function isBackgroundTabClick(event: MouseEvent): boolean {
  return event.button === 1 || (event.button === 0 && (event.metaKey || event.ctrlKey));
}

export function openInBackgroundTab(dispatch: AppDispatch, dashboardId: string): void {
  dispatch(openTabInBackground(dashboardId));
}

/** Stops the browser's middle-button autoscroll so the auxclick is a clean open-in-tab gesture. */
export function suppressMiddleMouseDown(event: MouseEvent): void {
  if (event.button === 1) event.preventDefault();
}
