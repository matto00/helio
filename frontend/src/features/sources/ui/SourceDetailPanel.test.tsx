import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  fetchCsvPreview as fetchCsvPreviewRequest,
  refreshSource as refreshSourceRequest,
  deleteSource as deleteSourceRequest,
  updateSource as updateSourceRequest,
} from "../services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import { SourceDetailPanel } from "./SourceDetailPanel";
import type { DataSource } from "../types/dataSource";

jest.mock("../services/dataSourceService", () => ({
  fetchCsvPreview: jest.fn(),
  fetchRestPreview: jest.fn(),
  refreshSource: jest.fn(),
  deleteSource: jest.fn(),
  updateSource: jest.fn(),
}));

const refreshSourceMock = jest.mocked(refreshSourceRequest);
const fetchCsvPreviewMock = jest.mocked(fetchCsvPreviewRequest);
const deleteSourceMock = jest.mocked(deleteSourceRequest);
const updateSourceMock = jest.mocked(updateSourceRequest);

const csvSourceNoSchema: DataSource = {
  id: "src-1",
  name: "Sales CSV",
  type: "csv",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
  config: { path: "csv/src-1.csv" },
  inferredSchema: [],
};

const csvSource: DataSource = {
  ...csvSourceNoSchema,
  inferredSchema: [
    { name: "id", displayName: "ID", dataType: "integer", nullable: false },
    { name: "amount", displayName: "Amount", dataType: "float", nullable: true },
  ],
};

// HEL-539 (D5a) — `sql` is one of the 4 DataSourceKind values whose preview
// is not implemented; selecting it hits the deterministic
// previewUnsupported branch, never the real fetch/catch branch.
const sqlSource: DataSource = {
  id: "src-2",
  name: "Warehouse DB",
  type: "sql",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
  config: {
    dialect: "postgresql",
    host: "localhost",
    port: 5432,
    database: "warehouse",
    user: "reader",
    password: "secret",
    query: "select 1",
  },
  inferredSchema: [],
};

describe("SourceDetailPanel", () => {
  beforeEach(() => {
    refreshSourceMock.mockReset();
    deleteSourceMock.mockReset();
    deleteSourceMock.mockResolvedValue(undefined);
    updateSourceMock.mockReset();
  });

  it("renders the schema table when the source has an inferred schema", () => {
    renderWithStore(<SourceDetailPanel source={csvSource} />);
    expect(screen.getByRole("region", { name: /inferred schema/i })).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("renders its preview DataGrid at condensed density (preview variant default)", async () => {
    fetchCsvPreviewMock.mockResolvedValue({ headers: ["id"], rows: [["1"]] });
    const { container } = renderWithStore(<SourceDetailPanel source={csvSource} />);

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

    expect(container.querySelector(".ui-data-grid")).toHaveClass("ui-data-grid--condensed");
  });

  describe("preview skeleton (HEL-528)", () => {
    it("shows a shape-matched preview skeleton on the initial load, not the 'Click Preview' hint", () => {
      fetchCsvPreviewMock.mockReturnValue(new Promise(() => {})); // never resolves
      const { container } = renderWithStore(<SourceDetailPanel source={csvSource} />);

      fireEvent.click(screen.getByRole("button", { name: /preview/i }));

      expect(container.querySelector(".ui-data-grid--preview")).toBeInTheDocument();
      expect(container.querySelector(".ui-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/click preview to load a sample/i)).not.toBeInTheDocument();
    });

    it("keeps the resolved DataGrid rendered during a Reload — does not replace it with the skeleton", async () => {
      fetchCsvPreviewMock.mockResolvedValueOnce({ headers: ["id"], rows: [["1"]] });
      const { container } = renderWithStore(<SourceDetailPanel source={csvSource} />);

      fireEvent.click(screen.getByRole("button", { name: /preview/i }));
      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

      // Reload — never resolves, so isLoading stays true with rows already populated.
      fetchCsvPreviewMock.mockReturnValueOnce(new Promise(() => {}));
      fireEvent.click(screen.getByRole("button", { name: /reload/i }));

      expect(screen.getByText("1")).toBeInTheDocument();
      expect(container.querySelectorAll(".ui-skeleton").length).toBe(0);
    });
  });

  it("renders the empty-schema affordance when the source has no inferred schema", () => {
    renderWithStore(<SourceDetailPanel source={csvSourceNoSchema} />);
    expect(screen.getByRole("region", { name: /schema not available/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh source/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete and re-upload/i })).toBeInTheDocument();
  });

  it("calls refreshSource and re-fetches sources when Refresh source is clicked", async () => {
    refreshSourceMock.mockResolvedValue(csvSource);
    renderWithStore(<SourceDetailPanel source={csvSourceNoSchema} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh source/i }));

    await waitFor(() => {
      expect(refreshSourceMock).toHaveBeenCalledWith("src-1", "csv");
    });
  });

  it("shows the backend's actionable error message when refresh fails with an axios 400", async () => {
    const axiosError = Object.assign(new Error("Request failed with status code 400"), {
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: "Source file is missing on disk — delete the source and re-upload." },
      },
    });
    refreshSourceMock.mockRejectedValue(axiosError);
    renderWithStore(<SourceDetailPanel source={csvSourceNoSchema} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/missing on disk.*re-upload/i);
  });

  it("falls back to a generic message when the error is not an axios error", async () => {
    refreshSourceMock.mockRejectedValue(new Error("network down"));
    renderWithStore(<SourceDetailPanel source={csvSourceNoSchema} />);

    fireEvent.click(screen.getByRole("button", { name: /refresh source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to refresh source/i);
  });

  it("F-179: the truncated source name carries a title attribute with the full name", () => {
    renderWithStore(<SourceDetailPanel source={csvSource} />);
    expect(screen.getByText("Sales CSV")).toHaveAttribute("title", "Sales CSV");
  });

  describe("delete confirmation (F-012)", () => {
    it("requires confirmation before deleting — no single-click delete", () => {
      renderWithStore(<SourceDetailPanel source={csvSourceNoSchema} />);

      fireEvent.click(screen.getByRole("button", { name: /delete and re-upload/i }));

      expect(deleteSourceMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
      expect(deleteSourceMock).toHaveBeenCalledWith("src-1");
    });

    it("Cancel backs out without deleting", () => {
      renderWithStore(<SourceDetailPanel source={csvSourceNoSchema} />);

      fireEvent.click(screen.getByRole("button", { name: /delete and re-upload/i }));
      fireEvent.click(screen.getByRole("button", { name: /cancel delete/i }));

      expect(deleteSourceMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /delete and re-upload/i })).toBeInTheDocument();
    });
  });

  describe("inline rename (F-070)", () => {
    it("commits a rename via updateSource on Enter", async () => {
      updateSourceMock.mockResolvedValue({ ...csvSource, name: "Renamed Sales CSV" });
      renderWithStore(<SourceDetailPanel source={csvSource} />);

      fireEvent.click(screen.getByRole("button", { name: /rename sales csv/i }));
      const input = screen.getByRole("textbox", { name: /rename sales csv/i });
      fireEvent.change(input, { target: { value: "Renamed Sales CSV" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() =>
        expect(updateSourceMock).toHaveBeenCalledWith("src-1", "Renamed Sales CSV"),
      );
    });

    it("Escape cancels without saving", () => {
      renderWithStore(<SourceDetailPanel source={csvSource} />);

      fireEvent.click(screen.getByRole("button", { name: /rename sales csv/i }));
      const input = screen.getByRole("textbox", { name: /rename sales csv/i });
      fireEvent.change(input, { target: { value: "Something else" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(updateSourceMock).not.toHaveBeenCalled();
      expect(screen.getByText("Sales CSV")).toBeInTheDocument();
    });
  });

  // HEL-539 (D5a/task 2.7/4.3) — the prod-reachable retry-spam defect: a
  // deterministic capability limitation must never carry a Retry action,
  // while a real fetch failure on a preview-capable kind still does.
  describe("preview error/unsupported split (D5a)", () => {
    it("selecting an unsupported-preview source (sql) and clicking Preview renders the capability message with no Retry action", async () => {
      fetchCsvPreviewMock.mockClear();
      renderWithStore(<SourceDetailPanel source={sqlSource} />);

      fireEvent.click(screen.getByRole("button", { name: /preview/i }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Preview is not supported for SQL sources.");
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      // The fetch-based mocks were never invoked — this is a deterministic
      // branch, not a caught error.
      expect(fetchCsvPreviewMock).not.toHaveBeenCalled();
    });

    it("a real fetch failure on a preview-capable source (csv) renders previewError with a working Retry", async () => {
      fetchCsvPreviewMock.mockReset();
      fetchCsvPreviewMock.mockRejectedValueOnce(new Error("network down"));
      renderWithStore(<SourceDetailPanel source={csvSource} />);

      fireEvent.click(screen.getByRole("button", { name: /preview/i }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/failed to fetch preview/i);
      const retryBtn = screen.getByRole("button", { name: "Retry" });

      fetchCsvPreviewMock.mockResolvedValueOnce({ headers: ["id"], rows: [["1"]] });
      fireEvent.click(retryBtn);

      await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(fetchCsvPreviewMock).toHaveBeenCalledTimes(2);
    });
  });
});
