import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { dataTypesReducer } from "../../features/dataTypes/state/dataTypesSlice";
import type { DataType } from "../../features/dataTypes/types/dataType";
import { pipelinesReducer } from "../../features/pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { SidebarBody } from "./SidebarBody";

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

function makeStore(dataTypeItems: DataType[]) {
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
    } as never,
  });
}

function renderAt(path: string, dataTypeItems: DataType[] = []) {
  const store = makeStore(dataTypeItems);
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
