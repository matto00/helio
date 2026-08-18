import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Pencil, Pin, PinOff } from "lucide-react";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDatabase,
  faComments,
  faLayerGroup,
  faCodeBranch,
  faGaugeHigh,
  faLock,
} from "@fortawesome/free-solid-svg-icons";

import {
  fetchConversations,
  renameConversation,
  setSelectedConversationId,
  startNewConversation,
  TierRequestAccessCopy,
  togglePinned,
} from "../../features/assistant/state/assistantConversationsSlice";
import {
  deleteDataType,
  fetchDataTypes,
  selectPipelineOutputDataTypes,
  setSelectedTypeId,
} from "../../features/dataTypes/state/dataTypesSlice";
import { isUnstructuredDataType } from "../../features/dataTypes/types/dataType";
import {
  deleteMetric,
  fetchMetrics,
  setCreateMetricModalOpen,
} from "../../features/metrics/state/metricsSlice";
import {
  deletePipeline,
  fetchPipelines,
  selectPipelineNameByOutputTypeId,
  setCreatePipelineModalOpen,
} from "../../features/pipelines/state/pipelinesSlice";
import {
  deleteSource,
  fetchSources,
  setAddSourceModalOpen,
  setSelectedSourceId,
} from "../../features/sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { DashboardList } from "../../features/dashboards/ui/DashboardList";
import "./SidebarBody.css";
import { pickerIdForPathname } from "./sections";
import { SidebarItemList, type SidebarItem } from "./SidebarItemList";

/** Picks the section-appropriate list based on the current route. The dashboards
 * section keeps DashboardList (full CRUD); other sections use the lighter
 * SidebarItemList (filter + navigate). All sections render a list when their
 * route is active so the sidebar is consistent across sections. */
export function SidebarBody() {
  const { pathname } = useLocation();
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const dataTypes = useAppSelector((state) => state.dataTypes);
  const metrics = useAppSelector((state) => state.metrics);
  const conversations = useAppSelector((state) => state.assistantConversations);
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  const pipelineNameByTypeId = useAppSelector(selectPipelineNameByOutputTypeId);

  const section = pickerIdForPathname(pathname);
  // HEL-703 design.md D9 (cycle-2 evaluator CR1) — mirrors `ChatPage.tsx`/`QuickLauncherOverlay.tsx`'s
  // own guard: this was the one `fetchConversations()` dispatch site those two missed, since the
  // sidebar's "chat" section list is driven from here, not from either of those components.
  const isFreeTier = currentUser?.tier === "free";

  useEffect(() => {
    if (section === "sources" && sources.status === "idle") {
      void dispatch(fetchSources());
    } else if (section === "pipelines" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    } else if (section === "registry" && dataTypes.status === "idle") {
      void dispatch(fetchDataTypes());
    } else if (section === "metrics" && metrics.status === "idle") {
      void dispatch(fetchMetrics());
    } else if (section === "chat" && !isFreeTier && conversations.status === "idle") {
      void dispatch(fetchConversations());
    }
    // The sources section also needs pipelines loaded: the delete-confirm
    // warning counts pipelines that read from the source being deleted. The
    // registry section needs them too, to resolve each DataType's producing
    // pipeline for the provenance subtitle (HEL-270).
    if ((section === "sources" || section === "registry") && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    }
    // F-144: the pipelines section's own delete-confirm warning needs to name
    // the DataType a pipeline produces (see `deleteWarning` below).
    if (section === "pipelines" && dataTypes.status === "idle") {
      void dispatch(fetchDataTypes());
    }
  }, [
    section,
    dispatch,
    sources.status,
    pipelines.status,
    dataTypes.status,
    metrics.status,
    conversations.status,
    isFreeTier,
  ]);

  if (section === "sources") {
    // Drive the page's selection via Redux so the sidebar acts as the source
    // list (mirroring the dashboards pattern). Fall back to the first item
    // when no explicit selection — the page renders the resolved selection.
    const effectiveSourceId = sources.selectedSourceId ?? sources.items[0]?.id ?? null;
    return (
      <SidebarItemList
        heading="Data Sources"
        items={sources.items}
        status={sources.status}
        error={sources.error}
        onSelect={(item) => dispatch(setSelectedSourceId(item.id))}
        activeId={effectiveSourceId}
        emptyText="Connect a data source"
        emptyIcon={faDatabase}
        emptyDescription="Pull in data from PostgreSQL, MySQL, CSV, or static input."
        onAdd={() => dispatch(setAddSourceModalOpen(true))}
        addLabel="Add source"
        deleteWarning={(item) => {
          const dependents = pipelines.items.filter((p) => p.sourceDataSourceId === item.id).length;
          if (dependents === 0) return null;
          return `${dependents} pipeline${dependents === 1 ? "" : "s"} read${dependents === 1 ? "s" : ""} from this source and will stop working.`;
        }}
        onDelete={async (item) => {
          await dispatch(deleteSource(item.id));
          if (sources.selectedSourceId === item.id) {
            dispatch(setSelectedSourceId(null));
          }
        }}
      />
    );
  }

  if (section === "pipelines") {
    return (
      <SidebarItemList
        heading="Data Pipelines"
        items={pipelines.items}
        status={pipelines.status}
        error={pipelines.error}
        toHref={(item) => `/pipelines/${item.id}`}
        activeId={routeId ?? null}
        emptyText="Build your first pipeline"
        emptyIcon={faCodeBranch}
        emptyDescription="Pipelines transform raw source data into typed rows you can chart."
        onAdd={() => dispatch(setCreatePipelineModalOpen(true))}
        addLabel="New pipeline"
        // F-144: deleting a pipeline silently orphaned the data type it
        // produces (and anything bound to it) with no warning, unlike the
        // sources section just above. One hop deep, mirroring that same
        // shallow-dependency style — not a live panel/metric count, but
        // enough to stop a surprise silent break.
        deleteWarning={(item) => {
          const pipeline = pipelines.items.find((p) => p.id === item.id);
          const outputTypeId = pipeline?.outputDataTypeId;
          if (outputTypeId === undefined || outputTypeId === null) return null;
          const outputType = dataTypes.items.find((dt) => dt.id === outputTypeId);
          const typeName = outputType?.name ?? "its output type";
          return `Also deletes the "${typeName}" data type — any panels or metrics using it will stop working.`;
        }}
        onDelete={async (item) => {
          await dispatch(deletePipeline(item.id));
          if (routeId === item.id) navigate("/pipelines");
        }}
      />
    );
  }

  if (section === "metrics") {
    return (
      <SidebarItemList
        heading="Metrics"
        items={metrics.items}
        status={metrics.status}
        error={metrics.error}
        toHref={(item) => `/metrics/${item.id}`}
        activeId={routeId ?? null}
        emptyText="Define your first metric"
        emptyIcon={faGaugeHigh}
        emptyDescription="Metrics reuse a pipeline-output data type's measure field, aggregation, and format."
        onAdd={() => dispatch(setCreateMetricModalOpen(true))}
        addLabel="New metric"
        onDelete={async (item) => {
          await dispatch(deleteMetric(item.id));
          if (routeId === item.id) navigate("/metrics");
        }}
      />
    );
  }

  if (section === "registry") {
    const effectiveTypeId = dataTypes.selectedTypeId ?? pipelineOutputDataTypes[0]?.id ?? null;
    // Classify over the full DataType[] list here — `renderBadge`'s `item` param
    // is typed `SidebarItem` ({id, name}), which has no `fields` to classify on.
    const unstructuredTypeIds = new Set(
      pipelineOutputDataTypes.filter(isUnstructuredDataType).map((dt) => dt.id),
    );
    // Attach the producing-pipeline provenance subtitle where resolvable; omit
    // it entirely when no pipeline is loaded for the DataType (HEL-270).
    const registryItems: SidebarItem[] = pipelineOutputDataTypes.map((dt) => {
      const pipelineName = pipelineNameByTypeId.get(dt.id);
      return {
        id: dt.id,
        name: dt.name,
        subtitle: pipelineName !== undefined ? `Pipeline: ${pipelineName}` : undefined,
      };
    });
    return (
      <SidebarItemList
        heading="Data Types"
        items={registryItems}
        status={dataTypes.status}
        error={dataTypes.error}
        onSelect={(item) => dispatch(setSelectedTypeId(item.id))}
        activeId={effectiveTypeId}
        emptyText="No types defined"
        emptyIcon={faLayerGroup}
        emptyDescription="Types are created by pipelines."
        onDelete={async (item) => {
          await dispatch(deleteDataType(item.id));
          if (dataTypes.selectedTypeId === item.id) {
            dispatch(setSelectedTypeId(null));
          }
        }}
        renderBadge={(item) =>
          unstructuredTypeIds.has(item.id) ? (
            <span className="dashboard-list__badge">Content</span>
          ) : null
        }
      />
    );
  }

  if (section === "chat" && isFreeTier) {
    // HEL-703 design.md D9 (cycle-2 evaluator CR1) — a `free`-tier user never sees the sidebar's
    // conversation list at all (its fetch is gated above, so `conversations.status` would
    // otherwise sit at "idle" with an empty list forever, falling through to `SidebarItemList`'s
    // own generic "No conversations yet" + "+ New chat" empty state — misleading, since starting a
    // conversation is not actually possible). No heading/filter/"+" — none of that list chrome
    // applies to a section the user cannot use.
    //
    // F-056 — this used to reuse `<EmptyState variant="sidebar">`, the same icon+title+description
    // card shape `ActiveConversationPanel`'s main-content locked state renders (just scaled down),
    // which read as an accidental duplicate stacked directly below it in one viewport. A compact,
    // single-purpose notice (small icon+heading row, one description line, a text-style link) is
    // deliberately a different shape from the main pane's full hero card, not just a smaller
    // version of it — while still sharing `TierRequestAccessCopy` so the two surfaces' wording
    // never drifts apart.
    //
    // F-017: `TierRequestAccessCopy`'s "Contact the workspace owner" text used to be the entire
    // message, even though a self-serve "Request Beta access" flow already exists in Settings
    // (`BetaAccessSection`) — this was actively steering free users away from the one path that
    // works. The link below reaches that flow directly.
    return (
      <section className="sidebar-body__locked-notice" aria-label="assistant">
        <p className="sidebar-body__locked-notice-heading">
          <FontAwesomeIcon icon={faLock} aria-hidden className="sidebar-body__locked-notice-icon" />
          {TierRequestAccessCopy.title}
        </p>
        <p className="sidebar-body__locked-notice-description">
          {TierRequestAccessCopy.description}
        </p>
        <button
          type="button"
          className="sidebar-body__locked-notice-link"
          onClick={() => navigate("/settings")}
        >
          Request access in Settings
        </button>
      </section>
    );
  }

  if (section === "chat") {
    // Server-ordered (`pinned DESC, updatedAt DESC`, HEL-663) — rendered
    // exactly as returned, no client-side re-sort (design.md D3).
    const conversationItems: SidebarItem[] = conversations.items.map((conversation) => ({
      id: conversation.id,
      name: conversation.title,
    }));
    const pinnedIds = new Set(
      conversations.items.filter((conversation) => conversation.pinned).map((c) => c.id),
    );
    const effectiveConversationId =
      conversations.selectedConversationId ?? conversations.items[0]?.id ?? null;
    return (
      <SidebarItemList
        // F-009/F-085: "Chat" vs "Assistant" naming drift — the interaction
        // surfaces (QuickLauncherOverlay, the command-bar trigger, the
        // message-turn role label) already say "Assistant"; this heading and
        // the nav-destination label (navDestinations.ts) are updated to
        // match. The route path (/chat) is unaffected.
        heading="Assistant"
        items={conversationItems}
        status={conversations.status}
        error={conversations.error}
        onSelect={(item) => dispatch(setSelectedConversationId(item.id))}
        activeId={effectiveConversationId}
        emptyText="No conversations yet"
        emptyIcon={faComments}
        emptyDescription="Start a conversation to see it here."
        onAdd={() => dispatch(startNewConversation())}
        addLabel="New chat"
        // No `onDelete` — HEL-663's API has no delete endpoint (design.md D3).
        renderBadge={(item) =>
          pinnedIds.has(item.id) ? (
            <Pin
              className="dashboard-list__pin-badge"
              size={12}
              aria-label="Pinned"
              data-testid="pin-badge"
            />
          ) : null
        }
        renderRowAction={(item, helpers) => {
          const pinned = pinnedIds.has(item.id);
          return (
            <>
              <button
                type="button"
                className="dashboard-list__row-action-btn"
                aria-label={`Rename ${item.name}`}
                title={`Rename ${item.name}`}
                onClick={helpers.startRename}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="dashboard-list__row-action-btn"
                aria-label={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
                title={pinned ? `Unpin ${item.name}` : `Pin ${item.name}`}
                onClick={() => dispatch(togglePinned({ id: item.id, pinned: !pinned }))}
              >
                {pinned ? (
                  <PinOff size={14} aria-hidden="true" />
                ) : (
                  <Pin size={14} aria-hidden="true" />
                )}
              </button>
            </>
          );
        }}
        // HEL-693 design.md D5 — `unwrap()` re-throws the thunk's `rejectValue` (a
        // human-readable message from `extractErrorMessage`) so SidebarItemList's
        // `onRename` reject path shows it inline.
        onRename={async (item, title) => {
          await dispatch(renameConversation({ id: item.id, title })).unwrap();
        }}
      />
    );
  }

  if (section === "other") {
    // F-016: Settings and the proposal/patch-set review routes aren't a list
    // section — they used to fall through to the `DashboardList` default
    // below, which showed a "DASHBOARDS" sidebar with no active nav item and
    // let picking a dashboard silently do nothing (still on the same route).
    // Rendering nothing here is the correct "no section" state; the desktop
    // top nav above already correctly shows no active destination for these
    // routes.
    return null;
  }

  return <DashboardList />;
}
