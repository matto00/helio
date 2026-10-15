import type { PickerId } from "../../shared/chrome/sections";
import { DashboardList } from "../../features/dashboards/ui/DashboardList";
import { AssistantContextList } from "./AssistantContextList";
import { ScheduledContextList } from "./ScheduledContextList";

/** What each section's context list is called and shows (HEL-1574, owner rulings 2026-10-13). Connectors, Settings
 *  and the review routes (`other`) have no list: the rail alone is their chrome. */
export interface ContextListSection {
  heading: string;
  noun: string;
}

export function contextListSectionFor(pickerId: PickerId): ContextListSection | null {
  switch (pickerId) {
    case "dashboards":
      return { heading: "Dashboards", noun: "dashboard" };
    case "sources":
      return { heading: "Data Sources", noun: "source" };
    case "pipelines":
      return { heading: "Data Pipelines", noun: "pipeline" };
    case "chat":
      return { heading: "Assistant", noun: "assistant" };
    case "other":
      return null;
  }
}

export function ContextListBody({ pickerId }: { pickerId: PickerId }) {
  switch (pickerId) {
    case "dashboards":
      return <DashboardList />;
    case "sources":
      return <ScheduledContextList kind="sources" />;
    case "pipelines":
      return <ScheduledContextList kind="pipelines" />;
    case "chat":
      return <AssistantContextList />;
    case "other":
      return null;
  }
}
