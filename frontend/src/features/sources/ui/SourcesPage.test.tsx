import { fireEvent, screen, waitFor } from "@testing-library/react";

import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { fetchSources as fetchSourcesRequest } from "../services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import { SourcesPage } from "./SourcesPage";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  deleteSource: jest.fn(),
  refreshSource: jest.fn(),
  createRestSource: jest.fn(),
  createCsvSource: jest.fn(),
  inferFromJson: jest.fn(),
  inferFromCsv: jest.fn(),
  updateSource: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  deleteDataType: jest.fn(),
}));

const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);
const fetchSourcesMock = jest.mocked(fetchSourcesRequest);

describe("SourcesPage", () => {
  beforeEach(() => {
    fetchDataTypesMock.mockResolvedValue([]);
    fetchSourcesMock.mockClear();
    fetchDataTypesMock.mockClear();
  });

  it("renders the page shell (heading lives in the top breadcrumb, not in-page)", () => {
    renderWithStore(<SourcesPage />);
    // The in-page section heading was removed because the top breadcrumb
    // already shows "Data Sources / <name>"; just verify the page mounts.
    expect(document.querySelector(".sources-page")).toBeInTheDocument();
  });

  it("renders the empty-state message when no sources exist", async () => {
    // The page renders an EmptyState when no sources are connected.
    renderWithStore(<SourcesPage />);
    expect(await screen.findByText(/Connect a data source/i)).toBeInTheDocument();
  });

  it("HEL-528: renders a skeleton, not the empty state, while sources are loading", () => {
    fetchSourcesMock.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { container } = renderWithStore(<SourcesPage />);

    expect(container.querySelector(".ui-empty-state--main .ui-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/Connect a data source/i)).not.toBeInTheDocument();
  });

  it("HEL-528: keeps rendering the selected source's detail panel during a refetch instead of the skeleton", async () => {
    renderWithStore(<SourcesPage />, {
      sources: {
        items: [
          {
            id: "src-1",
            name: "Sales CSV",
            type: "csv" as const,
            createdAt: "2026-05-01T00:00:00Z",
            updatedAt: "2026-05-01T00:00:00Z",
            config: { path: "csv/src-1.csv" },
          },
        ],
        status: "loading",
      },
    });

    expect(document.querySelector(".ui-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("Sales CSV")).toBeInTheDocument();
  });

  it("dispatches fetchDataTypes on mount to populate the source schema preview", async () => {
    renderWithStore(<SourcesPage />);
    await screen.findByText(/Connect a data source/i);
    // The source detail panel renders its inferred-schema table from the
    // dataTypes slice, so the page warms the slice on mount.
    expect(fetchDataTypesMock).toHaveBeenCalled();
  });

  it("F-011: the empty-state copy names the pipeline step, not a direct source-to-panel binding", async () => {
    renderWithStore(<SourcesPage />);
    expect(
      await screen.findByText(/shape into a bindable type with a pipeline/i),
    ).toBeInTheDocument();
  });

  it("F-072: fetches sources and data types on a cold mount", () => {
    renderWithStore(<SourcesPage />, {
      sources: { items: [], status: "idle" },
      dataTypes: { items: [], status: "idle" },
    });
    expect(fetchSourcesMock).toHaveBeenCalled();
    expect(fetchDataTypesMock).toHaveBeenCalled();
  });

  it("F-072: does not re-dispatch fetchSources/fetchDataTypes once already loaded", () => {
    renderWithStore(<SourcesPage />, {
      sources: { items: [], status: "succeeded" },
      dataTypes: { items: [], status: "succeeded" },
    });
    expect(fetchSourcesMock).not.toHaveBeenCalled();
    expect(fetchDataTypesMock).not.toHaveBeenCalled();
  });

  // HEL-539 — error state + retry recovery
  it("renders a visible error state with Retry on fetch failure, and Retry recovers on success", async () => {
    fetchSourcesMock.mockRejectedValueOnce(new Error("network error"));
    renderWithStore(<SourcesPage />, {
      sources: { items: [], status: "idle" },
      dataTypes: { items: [], status: "succeeded" },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load sources");
    expect(alert).toHaveTextContent("Failed to load sources.");
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    fetchSourcesMock.mockResolvedValueOnce([]);
    fireEvent.click(retryBtn);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(await screen.findByText(/Connect a data source/i)).toBeInTheDocument();
    expect(fetchSourcesMock).toHaveBeenCalledTimes(2);
  });
});
