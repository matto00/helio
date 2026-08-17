import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { setSelectedConversationId } from "../../features/assistant/state/assistantConversationsSlice";
import { setSelectedDashboardId } from "../../features/dashboards/state/dashboardsSlice";
import {
  selectPipelineOutputDataTypes,
  setSelectedTypeId,
} from "../../features/dataTypes/state/dataTypesSlice";
import {
  fetchPipelines,
  selectPipelineNameByOutputTypeId,
} from "../../features/pipelines/state/pipelinesSlice";
import { setSelectedSourceId } from "../../features/sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { pickerIdForPathname, sectionLabel } from "./sections";

export interface PickerSelectionItem {
  id: string;
  name: string;
  isActive: boolean;
  /** Optional secondary line (Type Registry "Pipeline: <name>" provenance,
   * HEL-270). Other sections leave it unset. */
  subtitle?: string;
}

export interface PickerSelection {
  items: PickerSelectionItem[];
  activeItemId: string | null;
  /** The current item's display name — intentionally `null` for
   * `pickerId: "dashboards"` (desktop breadcrumb/phone title use
   * `selectedDashboardName` directly for that route instead, per the
   * pre-existing asymmetry this hook preserves) and for any section with no
   * resolvable current item. */
  activeItemName: string | null;
  emptyMessage: string;
  /** The section's display label — identical to `sectionLabel(pathname)`,
   * included here so callers driving the phone title/sheet don't need a
   * second import. */
  heading: string;
  onSelect: (item: PickerSelectionItem) => void;
}

/**
 * Centralizes "what's the current item(s) for the picker at this route" —
 * the one hook consolidating what used to be four independent
 * `mobileSection`/pathname switches in `App.tsx`: the breadcrumb-item-name
 * switch, the mobile-sheet-items switch, the registry-section
 * pipeline-prefetch effect, and the sr-only `<h1>` heading's item-name
 * lookup. Every consumer (the desktop breadcrumb, the phone title/sheet, the
 * sr-only heading) reads from this one implementation, so they can't drift
 * apart the way the four originals did.
 *
 * Takes the pathname explicitly (rather than calling `useLocation` itself)
 * so every consumer shares the exact same `location.pathname` value within
 * a render, whichever component calls it.
 */
export function usePickerSelection(pathname: string): PickerSelection {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const pickerId = pickerIdForPathname(pathname);
  const heading = sectionLabel(pathname);

  const { items: dashboardItems, selectedDashboardId } = useAppSelector(
    (state) => state.dashboards,
  );
  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const dataTypes = useAppSelector((state) => state.dataTypes);
  const metrics = useAppSelector((state) => state.metrics);
  const conversations = useAppSelector((state) => state.assistantConversations);
  // Registry only ever lists pipeline-bound output types (strict
  // source→pipeline→type→panel) — the breadcrumb and the phone sheet must
  // agree on that same filtered set, or the title text and the sheet's
  // active-item highlight could disagree.
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  const pipelineNameByTypeId = useAppSelector(selectPipelineNameByOutputTypeId);

  const pipelineRouteId = pathname.startsWith("/pipelines/") ? pathname.split("/")[2] : null;
  const metricRouteId = pathname.startsWith("/metrics/") ? pathname.split("/")[2] : null;

  // The phone registry sheet resolves each DataType's producing pipeline for its
  // provenance subtitle (HEL-270). Fetch pipelines when the registry section is
  // active and not yet loaded — status-gated so a sidebar-driven fetch and this
  // one don't loop. Mirrors the desktop `SidebarBody` registry-section fetch.
  useEffect(() => {
    if (pickerId === "registry" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [dispatch, pickerId, pipelines.status]);

  switch (pickerId) {
    case "dashboards": {
      const items: PickerSelectionItem[] = dashboardItems.map((dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
        isActive: dashboard.id === selectedDashboardId,
      }));
      return {
        items,
        activeItemId: selectedDashboardId,
        // Asymmetry preserved: desktop breadcrumb/phone title use
        // `selectedDashboardName` directly for this route, not this field.
        activeItemName: null,
        emptyMessage: "No dashboards yet.",
        heading,
        onSelect: (item) => dispatch(setSelectedDashboardId(item.id)),
      };
    }
    case "sources": {
      const effectiveId = sources.selectedSourceId ?? sources.items[0]?.id ?? null;
      const items: PickerSelectionItem[] = sources.items.map((source) => ({
        id: source.id,
        name: source.name,
        isActive: source.id === effectiveId,
      }));
      return {
        items,
        activeItemId: effectiveId,
        activeItemName: items.find((item) => item.id === effectiveId)?.name ?? null,
        emptyMessage: "No data sources yet.",
        heading,
        onSelect: (item) => dispatch(setSelectedSourceId(item.id)),
      };
    }
    case "pipelines": {
      const items: PickerSelectionItem[] = pipelines.items.map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        isActive: pipeline.id === pipelineRouteId,
      }));
      return {
        items,
        activeItemId: pipelineRouteId,
        activeItemName: items.find((item) => item.id === pipelineRouteId)?.name ?? null,
        emptyMessage: "No pipelines yet.",
        heading,
        onSelect: (item) => navigate(`/pipelines/${item.id}`),
      };
    }
    case "registry": {
      const effectiveId = dataTypes.selectedTypeId ?? pipelineOutputDataTypes[0]?.id ?? null;
      // Attach the producing-pipeline provenance subtitle where resolvable;
      // omit it entirely when no pipeline is loaded for the DataType (HEL-270).
      const items: PickerSelectionItem[] = pipelineOutputDataTypes.map((dataType) => {
        const pipelineName = pipelineNameByTypeId.get(dataType.id);
        return {
          id: dataType.id,
          name: dataType.name,
          isActive: dataType.id === effectiveId,
          subtitle: pipelineName !== undefined ? `Pipeline: ${pipelineName}` : undefined,
        };
      });
      return {
        items,
        activeItemId: effectiveId,
        activeItemName: items.find((item) => item.id === effectiveId)?.name ?? null,
        emptyMessage: "No types yet.",
        heading,
        onSelect: (item) => dispatch(setSelectedTypeId(item.id)),
      };
    }
    case "metrics": {
      const items: PickerSelectionItem[] = metrics.items.map((metric) => ({
        id: metric.id,
        name: metric.name,
        isActive: metric.id === metricRouteId,
      }));
      return {
        items,
        activeItemId: metricRouteId,
        activeItemName: items.find((item) => item.id === metricRouteId)?.name ?? null,
        emptyMessage: "No metrics yet.",
        heading,
        onSelect: (item) => navigate(`/metrics/${item.id}`),
      };
    }
    case "chat": {
      const effectiveId =
        conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;
      const items: PickerSelectionItem[] = conversations.items.map((conversation) => ({
        id: conversation.id,
        name: conversation.title,
        isActive: conversation.id === effectiveId,
      }));
      return {
        items,
        activeItemId: effectiveId,
        activeItemName: items.find((item) => item.id === effectiveId)?.name ?? null,
        emptyMessage: "No conversations yet.",
        heading,
        onSelect: (item) => dispatch(setSelectedConversationId(item.id)),
      };
    }
    case "other":
    default:
      // Settings + the proposal/patch-set review routes aren't a picker
      // section (F-016) — the phone title control is hidden entirely for
      // them, so `items`/`onSelect` are never read in practice.
      return {
        items: [],
        activeItemId: null,
        activeItemName: null,
        emptyMessage: "",
        heading,
        onSelect: () => undefined,
      };
  }
}
