import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";

import { fetchDataTypes } from "../features/dataTypes/dataTypesSlice";
import { fetchPipelines } from "../features/pipelines/pipelinesSlice";
import { fetchSources } from "../features/sources/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { DashboardList } from "./DashboardList";
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
    return (
      <SidebarItemList
        heading="Data Sources"
        items={sources.items}
        status={sources.status}
        error={sources.error}
        toHref={() => "/sources"}
        emptyText="No data sources yet"
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
        emptyText="No pipelines yet"
      />
    );
  }

  if (section === "registry") {
    return (
      <SidebarItemList
        heading="Type Registry"
        items={dataTypes.items}
        status={dataTypes.status}
        error={dataTypes.error}
        toHref={() => "/registry"}
        emptyText="No data types yet"
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
