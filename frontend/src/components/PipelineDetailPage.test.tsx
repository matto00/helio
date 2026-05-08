import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { ThemeProvider } from "../theme/ThemeProvider";
import { sourcesReducer } from "../features/sources/sourcesSlice";
import { authReducer } from "../features/auth/authSlice";
import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { layoutHistoryReducer } from "../features/layout/layoutHistorySlice";
import { panelsReducer } from "../features/panels/panelsSlice";
import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { pipelinesReducer } from "../features/pipelines/pipelinesSlice";
import { OverlayProvider } from "./OverlayProvider";
import { PipelineDetailPage } from "./PipelineDetailPage";
import { fetchPipelines, runPipeline, fetchRunStatus } from "../services/pipelineService";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  runPipeline: jest.fn(),
  fetchRunStatus: jest.fn(),
}));

const fetchPipelinesMock = jest.mocked(fetchPipelines);
const runPipelineMock = jest.mocked(runPipeline);
const fetchRunStatusMock = jest.mocked(fetchRunStatus);

type SourceItem = {
  id: string;
  name: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
};

type PipelinesPreloadedState = {
  runId?: string | null;
  runStatus?: "queued" | "running" | "succeeded" | "failed" | null;
  runError?: string | null;
};

function makeStore(sourcesItems: SourceItem[] = [], pipelinesState: PipelinesPreloadedState = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      dataTypes: dataTypesReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
    } as never,
    preloadedState: {
      sources: {
        items: sourcesItems,
        status: "succeeded" as const,
        error: null,
      },
      pipelines: {
        items: [],
        status: "idle" as const,
        error: null,
        createStatus: "idle" as const,
        createError: null,
        runId: pipelinesState.runId ?? null,
        runStatus: pipelinesState.runStatus ?? null,
        runError: pipelinesState.runError ?? null,
      },
    } as never,
  });
}

function renderDetailPage(id = "pipe-1", store = makeStore()) {
  return render(
    <MemoryRouter initialEntries={[`/pipelines/${id}`]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <Routes>
              <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("PipelineDetailPage", () => {
  beforeEach(() => {
    fetchPipelinesMock.mockResolvedValue([]);
    runPipelineMock.mockResolvedValue({ runId: "test-run-id" });
    fetchRunStatusMock.mockResolvedValue({ runId: "test-run-id", status: "succeeded", rows: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders when route is /pipelines/:id", async () => {
    renderDetailPage();
    expect(screen.getByText("Run pipeline ▶")).toBeInTheDocument();
  });

  it("back navigation link renders and points to /pipelines", () => {
    renderDetailPage();
    const backLink = screen.getByRole("link", { name: /← Data Pipelines/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("href", "/pipelines");
  });

  it("source selector renders sources from store", () => {
    const store = makeStore([
      { id: "src-1", name: "Sales DB", sourceType: "sql", createdAt: "", updatedAt: "" },
      { id: "src-2", name: "CSV Upload", sourceType: "csv", createdAt: "", updatedAt: "" },
    ]);
    renderDetailPage("pipe-1", store);
    expect(screen.getByText("Sales DB")).toBeInTheDocument();
    expect(screen.getByText("CSV Upload")).toBeInTheDocument();
  });

  it("empty state shows 'Add your first transformation step' when steps is empty", () => {
    renderDetailPage();
    expect(screen.getByText("Add your first transformation step")).toBeInTheDocument();
  });

  it("adding a step adds a card to the river view", () => {
    renderDetailPage();

    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Filter rows/i }));

    expect(screen.getByText("Filter rows")).toBeInTheDocument();
    expect(screen.queryByText("Add your first transformation step")).not.toBeInTheDocument();
  });

  it("removing a step removes its card", () => {
    renderDetailPage();

    // Add a step first
    fireEvent.click(screen.getByRole("button", { name: "+ Add step" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename column/i }));

    // Expand it to get the Remove button
    fireEvent.click(screen.getByRole("button", { name: /Rename column/i, expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Remove step" }));

    expect(screen.queryByText("Rename column")).not.toBeInTheDocument();
    expect(screen.getByText("Add your first transformation step")).toBeInTheDocument();
  });

  it("output name field is editable — input appears on click", async () => {
    fetchPipelinesMock.mockResolvedValue([{ id: "pipe-1", name: "My Pipeline" }]);
    renderDetailPage("pipe-1");

    await waitFor(() => expect(fetchPipelinesMock).toHaveBeenCalled());

    const outputNameBtn = await screen.findByRole("button", { name: "Edit output name" });
    fireEvent.click(outputNameBtn);

    const input = screen.getByRole("textbox", { name: "Output name" });
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "New Output" } });
    expect(input).toHaveValue("New Output");
  });

  it("clicking Run pipeline dispatches submitPipelineRun", async () => {
    renderDetailPage("pipe-1");

    fireEvent.click(screen.getByRole("button", { name: "Run pipeline ▶" }));

    await waitFor(() => {
      expect(runPipelineMock).toHaveBeenCalledWith("pipe-1");
    });
  });

  it("status indicator shows 'Queued' when runStatus is queued", () => {
    const store = makeStore([], { runStatus: "queued", runId: "run-1" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByLabelText("Run status: queued")).toBeInTheDocument();
    expect(screen.getByText("Queued…")).toBeInTheDocument();
  });

  it("status indicator shows 'Running' when runStatus is running", () => {
    const store = makeStore([], { runStatus: "running", runId: "run-2" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByText("Running…")).toBeInTheDocument();
  });

  it("status indicator shows 'Succeeded' when runStatus is succeeded", () => {
    const store = makeStore([], { runStatus: "succeeded", runId: "run-3" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });

  it("status indicator shows 'Failed' when runStatus is failed", () => {
    const store = makeStore([], { runStatus: "failed", runId: "run-4", runError: "out of memory" });
    renderDetailPage("pipe-1", store);
    expect(screen.getByText(/Failed.*out of memory/)).toBeInTheDocument();
  });

  it("status indicator is absent when runStatus is null", () => {
    renderDetailPage();
    expect(screen.queryByLabelText(/Run status/)).not.toBeInTheDocument();
  });
});
