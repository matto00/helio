import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { assistantConversationsReducer } from "../../features/assistant/state/assistantConversationsSlice";
import * as assistantConversationsService from "../../features/assistant/services/assistantConversationsService";
import type { AssistantConversationSummary } from "../../features/assistant/types";
import { dataTypesReducer } from "../../features/dataTypes/state/dataTypesSlice";
import type { DataType } from "../../features/dataTypes/types/dataType";
import { metricsReducer } from "../../features/metrics/state/metricsSlice";
import { pipelinesReducer } from "../../features/pipelines/state/pipelinesSlice";
import * as pipelineService from "../../features/pipelines/services/pipelineService";
import type { PipelineSummary } from "../../features/pipelines/types/pipelineStep";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { SidebarBody } from "./SidebarBody";

jest.mock("../../features/pipelines/services/pipelineService", () => ({
  getPipelines: jest.fn(),
}));

jest.mock("../../features/assistant/services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
}));

const getPipelinesMock = jest.mocked(pipelineService.getPipelines);
const listConversationsMock = jest.mocked(assistantConversationsService.listConversations);
const updateConversationMock = jest.mocked(assistantConversationsService.updateConversation);

beforeEach(() => {
  getPipelinesMock.mockReset();
  getPipelinesMock.mockResolvedValue([]);
  listConversationsMock.mockReset();
  listConversationsMock.mockResolvedValue([]);
  updateConversationMock.mockReset();
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
  conversationItems?: AssistantConversationSummary[];
  conversationStatus?: "idle" | "loading" | "succeeded" | "failed";
}

function makeStore(dataTypeItems: DataType[], options: StoreOptions = {}) {
  const {
    pipelineItems = [],
    pipelineStatus = "idle",
    conversationItems = [],
    conversationStatus = "idle",
  } = options;
  return configureStore({
    reducer: {
      dataTypes: dataTypesReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      metrics: metricsReducer,
      assistantConversations: assistantConversationsReducer,
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
      metrics: {
        items: [],
        status: "idle" as const,
        error: null,
      },
      assistantConversations: {
        items: conversationItems,
        status: conversationStatus,
        error: null,
        selectedConversationId: null,
        activeConversation: { data: null, status: "idle" as const, error: null },
      },
    } as never,
  });
}

function renderAt(path: string, dataTypeItems: DataType[] = [], options: StoreOptions = {}) {
  const store = makeStore(dataTypeItems, options);
  return {
    store,
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <Provider store={store}>
          <SidebarBody onCollapse={() => {}} />
        </Provider>
      </MemoryRouter>,
    ),
  };
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

  it("renders the metrics sidebar list with no badge markup", () => {
    renderAt("/metrics");
    expect(document.querySelector(".dashboard-list__badge")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Metrics" })).toBeInTheDocument();
  });
});

function buildConversation(
  overrides: Partial<AssistantConversationSummary>,
): AssistantConversationSummary {
  return {
    id: "conv-1",
    title: "Netflix dashboard build",
    pinned: false,
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("SidebarBody chat section — conversation list (HEL-664)", () => {
  it("renders conversations in the exact order the API returned them, no client re-sort", () => {
    // A pinned conversation with an OLDER updatedAt than the unpinned one —
    // if the list re-sorted by updatedAt client-side, "Older pinned" would
    // render second; server order (design.md D3) keeps it first.
    const items = [
      buildConversation({ id: "conv-pinned", title: "Older pinned", pinned: true }),
      buildConversation({ id: "conv-recent", title: "Newer unpinned", pinned: false }),
    ];
    renderAt("/chat", [], { conversationItems: items, conversationStatus: "succeeded" });

    const names = screen.getAllByText(/Older pinned|Newer unpinned/).map((el) => el.textContent);
    expect(names).toEqual(["Older pinned", "Newer unpinned"]);
  });

  it("shows a pin indicator on pinned items only", () => {
    const items = [
      buildConversation({ id: "conv-pinned", title: "Pinned one", pinned: true }),
      buildConversation({ id: "conv-plain", title: "Plain one", pinned: false }),
    ];
    renderAt("/chat", [], { conversationItems: items, conversationStatus: "succeeded" });

    const pinnedRow = screen.getByText("Pinned one").closest("li");
    const plainRow = screen.getByText("Plain one").closest("li");
    expect(pinnedRow?.querySelector('[data-testid="pin-badge"]')).toBeInTheDocument();
    expect(plainRow?.querySelector('[data-testid="pin-badge"]')).not.toBeInTheDocument();
  });

  it("renders no delete affordance for conversations (HEL-663 has no delete endpoint)", () => {
    const items = [buildConversation({})];
    renderAt("/chat", [], { conversationItems: items, conversationStatus: "succeeded" });

    expect(screen.queryByRole("button", { name: /actions$/ })).not.toBeInTheDocument();
  });

  it("pinning a conversation sends PATCH {pinned: true} and shows the pinned indicator", async () => {
    updateConversationMock.mockResolvedValueOnce({
      id: "conv-1",
      title: "Netflix dashboard build",
      pinned: true,
      updatedAt: "2026-08-01T00:00:00Z",
    });
    const items = [buildConversation({ pinned: false })];
    renderAt("/chat", [], { conversationItems: items, conversationStatus: "succeeded" });

    fireEvent.click(screen.getByRole("button", { name: "Pin Netflix dashboard build" }));

    await waitFor(() =>
      expect(updateConversationMock).toHaveBeenCalledWith("conv-1", { pinned: true }),
    );
    await waitFor(() =>
      expect(
        screen
          .getByText("Netflix dashboard build")
          .closest("li")
          ?.querySelector('[data-testid="pin-badge"]'),
      ).toBeInTheDocument(),
    );
  });

  it("clicking the pin/unpin row action does not also select the conversation", async () => {
    updateConversationMock.mockResolvedValueOnce({
      id: "conv-1",
      title: "Netflix dashboard build",
      pinned: true,
      updatedAt: "2026-08-01T00:00:00Z",
    });
    const items = [buildConversation({ pinned: false })];
    const { store } = renderAt("/chat", [], {
      conversationItems: items,
      conversationStatus: "succeeded",
    });

    fireEvent.click(screen.getByRole("button", { name: "Pin Netflix dashboard build" }));

    await waitFor(() => expect(updateConversationMock).toHaveBeenCalled());
    expect(
      (store.getState() as { assistantConversations: { selectedConversationId: string | null } })
        .assistantConversations.selectedConversationId,
    ).toBeNull();
  });
});
