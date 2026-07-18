import { configureStore } from "@reduxjs/toolkit";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dataTypesReducer } from "../../features/dataTypes/state/dataTypesSlice";
import type { DataType } from "../../features/dataTypes/types/dataType";
import { pipelinesReducer } from "../../features/pipelines/state/pipelinesSlice";
import * as pipelineService from "../../features/pipelines/services/pipelineService";
import type { PipelineSummary } from "../../features/pipelines/types/pipelineStep";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { SidebarBody } from "./SidebarBody";

jest.mock("../../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn(),
}));

const getPipelinesMock = jest.mocked(pipelineService.getPipelines);

beforeEach(() => {
  getPipelinesMock.mockReset();
  getPipelinesMock.mockResolvedValue([]);
});

function buildDataType(overrides: Partial<DataType>): DataType {
  return {
    id: "type-1",
    name: "Documents",
    sourceId: null,
    version: 1,
    fields: [],
    computedFields: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function buildPipeline(overrides: Partial<PipelineSummary>): PipelineSummary {
  return {
    id: "pipe-1",
    name: "Revenue ETL",
    sourceDataSourceId: "src-1",
    sourceDataSourceName: "Profit",
    outputDataTypeName: "RevenueRow",
    outputDataTypeId: "type-1",
    lastRunStatus: "succeeded",
    lastRunAt: "2026-01-01T00:00:00Z",
    lastRunRowCount: 10,
    ...overrides,
  };
}

interface StoreOptions {
  pipelineItems?: PipelineSummary[];
  pipelineStatus?: "idle" | "loading" | "succeeded" | "failed";
}

function makeStore(dataTypeItems: DataType[], options: StoreOptions = {}) {
  const { pipelineItems = [], pipelineStatus = "idle" } = options;
  return configureStore({
    reducer: {
      dataTypes: dataTypesReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
    } as never,
    preloadedState: {
      dataTypes: {
        items: dataTypeItems,
        status: "succeeded" as const,
        error: null,
        selectedTypeId: null,
      },
      pipelines: {
        items: pipelineItems,
        status: pipelineStatus,
        error: null,
      },
    } as never,
  });
}

function renderAt(path: string, dataTypeItems: DataType[] = [], options: StoreOptions = {}) {
  const store = makeStore(dataTypeItems, options);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <SidebarBody onCollapse={() => {}} />
      </Provider>
    </MemoryRouter>,
  );
}

describe("SidebarBody registry section — unstructured-type badge", () => {
  it("shows the badge for a DataType with a content field", () => {
    const contentType = buildDataType({
      id: "type-content",
      name: "Support Tickets",
      fields: [{ name: "body", displayName: "Body", dataType: "string-body", nullable: false }],
    });

    renderAt("/registry", [contentType]);

    const row = screen.getByText("Support Tickets").closest("li");
    expect(row?.querySelector(".dashboard-list__badge")).toHaveTextContent("Content");
  });

  it("shows no badge for a purely structured DataType", () => {
    const structuredType = buildDataType({
      id: "type-structured",
      name: "Sales",
      fields: [{ name: "amount", displayName: "Amount", dataType: "float", nullable: false }],
    });

    renderAt("/registry", [structuredType]);

    const row = screen.getByText("Sales").closest("li");
    expect(row?.querySelector(".dashboard-list__badge")).not.toBeInTheDocument();
  });
});

describe("SidebarBody registry section — pipeline provenance subtitle", () => {
  it("shows 'Pipeline: <name>' under a DataType produced by a loaded pipeline", () => {
    const dt = buildDataType({ id: "type-1", name: "RevenueRow" });
    renderAt("/registry", [dt], {
      pipelineStatus: "succeeded",
      pipelineItems: [buildPipeline({ outputDataTypeId: "type-1", name: "Revenue ETL" })],
    });

    const row = screen.getByText("RevenueRow").closest("li");
    expect(row?.querySelector(".dashboard-list__subtitle")).toHaveTextContent(
      "Pipeline: Revenue ETL",
    );
  });

  it("shows no subtitle when no loaded pipeline matches the DataType", () => {
    const dt = buildDataType({ id: "type-1", name: "RevenueRow" });
    renderAt("/registry", [dt], {
      pipelineStatus: "succeeded",
      pipelineItems: [buildPipeline({ outputDataTypeId: "type-other", name: "Other ETL" })],
    });

    const row = screen.getByText("RevenueRow").closest("li");
    expect(row?.querySelector(".dashboard-list__subtitle")).not.toBeInTheDocument();
  });

  it("dispatches fetchPipelines once on a cold registry visit (pipelines idle)", async () => {
    const dt = buildDataType({ id: "type-1", name: "RevenueRow" });
    renderAt("/registry", [dt], { pipelineStatus: "idle" });

    await waitFor(() => expect(getPipelinesMock).toHaveBeenCalledTimes(1));
  });

  it("does not refetch pipelines when they are already loaded", async () => {
    const dt = buildDataType({ id: "type-1", name: "RevenueRow" });
    renderAt("/registry", [dt], {
      pipelineStatus: "succeeded",
      pipelineItems: [buildPipeline({ outputDataTypeId: "type-1" })],
    });

    // Give any pending effect a chance to run, then assert no fetch fired.
    await Promise.resolve();
    expect(getPipelinesMock).not.toHaveBeenCalled();
  });
});

describe("SidebarBody — regression check for other sections", () => {
  it("renders the sources sidebar list with no badge markup", () => {
    renderAt("/sources");
    expect(document.querySelector(".dashboard-list__badge")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
  });

  it("renders the pipelines sidebar list with no badge markup", () => {
    renderAt("/pipelines");
    expect(document.querySelector(".dashboard-list__badge")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Data Pipelines" })).toBeInTheDocument();
  });
});
