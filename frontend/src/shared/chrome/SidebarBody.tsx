import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { faDatabase, faLayerGroup, faCodeBranch } from "@fortawesome/free-solid-svg-icons";

import {
  deleteDataType,
  fetchDataTypes,
  setSelectedTypeId,
} from "../../features/dataTypes/dataTypesSlice";
import {
  deletePipeline,
  fetchPipelines,
  setCreatePipelineModalOpen,
} from "../../features/pipelines/pipelinesSlice";
import {
  deleteSource,
  fetchSources,
  setAddSourceModalOpen,
  setSelectedSourceId,
} from "../../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { DashboardList } from "../../features/dashboards/ui/DashboardList";
import { SidebarItemList } from "./SidebarItemList";

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

  const section = sectionFromPathname(pathname);

  useEffect(() => {
    if (section === "sources" && sources.status === "idle") {
      void dispatch(fetchSources());
    } else if (section === "pipelines" && pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    } else if (section === "registry" && dataTypes.status === "idle") {
      void dispatch(fetchDataTypes());
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
    const effectiveTypeId = dataTypes.selectedTypeId ?? dataTypes.items[0]?.id ?? null;
    return (
      <SidebarItemList
        heading="Type Registry"
        items={dataTypes.items}
        status={dataTypes.status}
        error={dataTypes.error}
        onSelect={(item) => dispatch(setSelectedTypeId(item.id))}
        activeId={effectiveTypeId}
        emptyText="No types defined"
        emptyIcon={faLayerGroup}
        emptyDescription="Types describe the shape of your data. Pipelines auto-generate types from their inputs."
        onDelete={async (item) => {
          await dispatch(deleteDataType(item.id));
          if (dataTypes.selectedTypeId === item.id) {
            dispatch(setSelectedTypeId(null));
          }
        }}
      />
    );
  }

  return <DashboardList onCollapse={onCollapse} />;
}

function sectionFromPathname(
  pathname: string,
): "dashboards" | "sources" | "pipelines" | "registry" {
  if (pathname.startsWith("/sources")) return "sources";
  if (pathname.startsWith("/pipelines")) return "pipelines";
  if (pathname.startsWith("/registry")) return "registry";
  return "dashboards";
}
