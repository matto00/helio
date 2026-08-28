import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { setSelectedConversationId } from "../../features/assistant/state/assistantConversationsSlice";
import type { CreateActionResult } from "../../features/dashboards/hooks/useCreateDashboardAction";
import { useCreateDashboardAction } from "../../features/dashboards/hooks/useCreateDashboardAction";
import { setSelectedDashboardId } from "../../features/dashboards/state/dashboardsSlice";
import { selectPipelineOutputDataTypes } from "../../features/dataTypes/state/dataTypesSlice";
import { useCreatePipelineAction } from "../../features/pipelines/hooks/useCreatePipelineAction";
import {
  fetchPipelines,
  selectPipelineNameByOutputTypeId,
} from "../../features/pipelines/state/pipelinesSlice";
import { useAddSourceAction } from "../../features/sources/hooks/useAddSourceAction";
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
  /** The section's display label — identical to `sectionLabel(pathname)`,
   * included here so callers driving the phone title/sheet don't need a
   * second import. */
  heading: string;
  onSelect: (item: PickerSelectionItem) => void;
  /** HEL-773 design.md D6/D7/D8 — the sheet's HEADER create action (rendered
   * above the list, suppressed whenever the empty branch renders instead).
   * `null` for sections with no create action of their own (metrics, chat,
   * registry — registry's create path is empty-branch-only, see
   * `emptyCreateAction`). Backed by the three HEL-548 create-action hooks,
   * called unconditionally here (Rules of Hooks) regardless of `pickerId`. */
  createAction: CreateActionResult | null;
  /** The empty branch's own CTA slot — mirrors `SidebarItemList`'s shipped
   * `onAdd` vs `emptyCta` split. Sources/pipelines/dashboards set this to
   * the SAME hook result as `createAction` (one visible affordance either
   * way, per D6); registry sets ONLY this slot (D7 — types are produced by
   * pipelines, so "create a pipeline" is registry's only create path, with
   * no persistent header icon under a "Data Types" heading); metrics/chat
   * have neither. */
  emptyCreateAction: CreateActionResult | null;
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

  const sourceRouteId = pathname.startsWith("/sources/") ? pathname.split("/")[2] : null;
  const registryRouteId = pathname.startsWith("/registry/") ? pathname.split("/")[2] : null;
  const pipelineRouteId = pathname.startsWith("/pipelines/") ? pathname.split("/")[2] : null;
  const metricRouteId = pathname.startsWith("/metrics/") ? pathname.split("/")[2] : null;

  // HEL-773 design.md D8 — all three HEL-548 create-action hooks are called
  // unconditionally (Rules of Hooks), at every render, regardless of
  // `pickerId`; the switch below just selects which (if any) result each
  // section exposes. Verified inert for the sections that don't use them: no
  // `useEffect` in any of the three (`useCreateDashboardAction`,
  // `useAddSourceAction`, `useCreatePipelineAction`).
  const createDashboardAction = useCreateDashboardAction();
  const addSourceAction = useAddSourceAction();
  const createPipelineAction = useCreatePipelineAction();

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
        heading,
        onSelect: (item) => dispatch(setSelectedDashboardId(item.id)),
        createAction: createDashboardAction,
        emptyCreateAction: createDashboardAction,
      };
    }
    case "sources": {
      // Route-driven, matching the pipelines and metrics cases below. The
      // former `selectedSourceId ?? items[0]` fallback named an arbitrary
      // source in the breadcrumb on a bare `/sources`, which is now the
      // section overview and names no single source at all.
      const items: PickerSelectionItem[] = sources.items.map((source) => ({
        id: source.id,
        name: source.name,
        isActive: source.id === sourceRouteId,
      }));
      return {
        items,
        activeItemId: sourceRouteId,
        activeItemName: items.find((item) => item.id === sourceRouteId)?.name ?? null,
        heading,
        onSelect: (item) => navigate(`/sources/${item.id}`),
        createAction: addSourceAction,
        emptyCreateAction: addSourceAction,
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
        heading,
        onSelect: (item) => navigate(`/pipelines/${item.id}`),
        createAction: createPipelineAction,
        emptyCreateAction: createPipelineAction,
      };
    }
    case "registry": {
      // Route-driven, matching sources/pipelines/metrics. `/registry` is now a
      // section overview, so no type is "current" there — the former
      // `selectedTypeId ?? items[0]` fallback named an arbitrary one.
      const effectiveId = registryRouteId;
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
        heading,
        onSelect: (item) => navigate(`/registry/${item.id}`),
        // D7 — the registry section has no create action of its own (a type
        // exists only as a pipeline's output); the empty-branch CTA is its
        // only create path, matching `SidebarBody`'s `emptyCta` (NOT
        // `onAdd`) treatment of this same section. No persistent header "+"
        // under a "Data Types" heading.
        createAction: null,
        emptyCreateAction: createPipelineAction,
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
        heading,
        onSelect: (item) => navigate(`/metrics/${item.id}`),
        // Metrics has no shared create-action hook (its sidebar CTA
        // dispatches inline) — out of scope, see ticket "Out of scope".
        createAction: null,
        emptyCreateAction: null,
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
        heading,
        onSelect: (item) => dispatch(setSelectedConversationId(item.id)),
        // Assistant has no shared create-action hook (its sidebar "New
        // chat" dispatches inline; the phone command bar has its own
        // separate HEL-746 trigger) — out of scope, see ticket "Out of
        // scope".
        createAction: null,
        emptyCreateAction: null,
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
        heading,
        onSelect: () => undefined,
        createAction: null,
        emptyCreateAction: null,
      };
  }
}
