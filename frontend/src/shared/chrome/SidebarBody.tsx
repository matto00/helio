import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { faDatabase, faLayerGroup, faCodeBranch } from "@fortawesome/free-solid-svg-icons";

import {
  deleteDataType,
  fetchDataTypes,
  selectPipelineOutputDataTypes,
  setSelectedTypeId,
} from "../../features/dataTypes/state/dataTypesSlice";
import { isUnstructuredDataType } from "../../features/dataTypes/types/dataType";
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
import { SidebarItemList, type SidebarItem } from "./SidebarItemList";

interface SidebarBodyProps {
  onCollapse: () => void;
}

/** Picks the section-appropriate list based on the current route. The dashboards
 * section keeps DashboardList (full CRUD); other sections use the lighter
 * SidebarItemList (filter + navigate). All sections render a list when their
 * route is active so the sidebar is consistent across sections. */
export function SidebarBody({ onCollapse }: SidebarBodyProps) {
  const { pathname } = useLocation();
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const dataTypes = useAppSelector((state) => state.dataTypes);
  const pipelineOutputDataTypes = useAppSelector(selectPipelineOutputDataTypes);
  const pipelineNameByTypeId = useAppSelector(selectPipelineNameByOutputTypeId);

  const section = sectionFromPathname(pathname);

  useEffect(() => {
    if (section === "sources" && sources.status === "idle") {
      void dispatch(fetchSources());
    } else if (section === "pipelines" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    } else if (section === "registry" && dataTypes.status === "idle") {
      void dispatch(fetchDataTypes());
    }
    // The sources section also needs pipelines loaded: the delete-confirm
    // warning counts pipelines that read from the source being deleted. The
    // registry section needs them too, to resolve each DataType's producing
    // pipeline for the provenance subtitle (HEL-270).
    if ((section === "sources" || section === "registry") && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [section, dispatch, sources.status, pipelines.status, dataTypes.status]);

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
        onDelete={async (item) => {
          await dispatch(deletePipeline(item.id));
          if (routeId === item.id) navigate("/pipelines");
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
        heading="Type Registry"
        items={registryItems}
        status={dataTypes.status}
        error={dataTypes.error}
        onSelect={(item) => dispatch(setSelectedTypeId(item.id))}
        activeId={effectiveTypeId}
        emptyText="No types defined"
        emptyIcon={faLayerGroup}
        emptyDescription="Types describe the shape of your data. Each pipeline produces one type as its output."
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

  return <DashboardList onCollapse={onCollapse} />;
}

/** Exported so `App.tsx` can drive the phone section-item sheet off the same
 * route-matching logic as the desktop sidebar — one source of truth for
 * "which section is this route" (see notes/mobile-pwa-handoff.md §W3.3). */
export function sectionFromPathname(
  pathname: string,
): "dashboards" | "sources" | "pipelines" | "registry" {
  if (pathname.startsWith("/sources")) return "sources";
  if (pathname.startsWith("/pipelines")) return "pipelines";
  if (pathname.startsWith("/registry")) return "registry";
  return "dashboards";
}
