import type { ReactNode } from "react";
import { Database, GitBranch, LayoutDashboard } from "lucide-react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faComments } from "@fortawesome/free-solid-svg-icons";

import type { PickerId } from "./sections";

export interface PickerEmptyStateCopy {
  icon: IconDefinition | ReactNode;
  title: string;
  description: string;
}

/** HEL-773 design.md D11/task 4.1 — the one shared source of icon/title/
 *  description copy for `MobileNavSheet`'s empty branch (`EmptyState
 *  variant="sidebar"`), keyed by `PickerId` so every section (including the
 *  unreachable `other`) has a complete entry. `sources`/`pipelines`/`chat`
 *  intentionally match `SidebarBody.tsx`'s `SidebarItemList` props verbatim
 *  (`emptyText`/`emptyIcon`/`emptyDescription`) — locked against that
 *  rendered copy by `pickerEmptyState.test.ts` (task 5.8) for those
 *  sections only.
 *  `dashboards` mirrors `DashboardList.tsx`'s own empty-state copy for
 *  consistency but is deliberately NOT locked: that surface is the
 *  zero-dashboard surface HEL-554 is concurrently rewriting, so pinning a
 *  test to it here would be a scheduled breakage (design.md D11). `other`
 *  is unreachable in practice (`CommandBar`'s phone title control is hidden
 *  entirely for `pickerId: "other"` routes), so its copy is a harmless,
 *  never-rendered placeholder kept only for `Record<PickerId, ...>`
 *  exhaustiveness. */
export const PICKER_EMPTY_STATE: Record<PickerId, PickerEmptyStateCopy> = {
  dashboards: {
    icon: <LayoutDashboard />,
    title: "No dashboards yet",
    description: "Create your first dashboard to start visualizing data.",
  },
  sources: {
    icon: <Database />,
    title: "Connect a data source",
    description: "Pull in data from PostgreSQL, MySQL, CSV, or static input.",
  },
  pipelines: {
    icon: <GitBranch />,
    title: "Build your first pipeline",
    description: "Pipelines transform raw source data into typed rows you can chart.",
  },
  chat: {
    icon: faComments,
    title: "No conversations yet",
    description: "Start a conversation to see it here.",
  },
  other: {
    icon: <LayoutDashboard />,
    title: "Nothing here yet",
    description: "",
  },
};
