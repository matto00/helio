import { fireEvent, screen, waitFor } from "@testing-library/react";

import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import {
  fetchCsvPreview as fetchCsvPreviewRequest,
  refreshSource as refreshSourceRequest,
  deleteSource as deleteSourceRequest,
  updateSource as updateSourceRequest,
} from "../services/dataSourceService";
import { renderWithStore } from "../../../test/renderWithStore";
import { SourceDetailPanel } from "./SourceDetailPanel";
import type { DataSource } from "../types/dataSource";
import type { DataType } from "../../dataTypes/types/dataType";

jest.mock("../services/dataSourceService", () => ({
  fetchCsvPreview: jest.fn(),
  fetchRestPreview: jest.fn(),
  refreshSource: jest.fn(),
  deleteSource: jest.fn(),
  updateSource: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  deleteDataType: jest.fn(),
}));

const refreshSourceMock = jest.mocked(refreshSourceRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);
const fetchCsvPreviewMock = jest.mocked(fetchCsvPreviewRequest);
const deleteSourceMock = jest.mocked(deleteSourceRequest);
const updateSourceMock = jest.mocked(updateSourceRequest);

const csvSource: DataSource = {
  id: "src-1",
  name: "Sales CSV",
  type: "csv",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
  config: { path: "csv/src-1.csv" },
};

const linkedType: DataType = {
  id: "dt-1",
  sourceId: "src-1",
  name: "Sales CSV",
  fields: [
    { name: "id", displayName: "ID", dataType: "integer", nullable: false },
    { name: "amount", displayName: "Amount", dataType: "float", nullable: true },
  ],
  computedFields: [],
  version: 1,
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:00:00Z",
};

describe("SourceDetailPanel", () => {
  beforeEach(() => {
    refreshSourceMock.mockReset();
    fetchDataTypesMock.mockReset();
    fetchDataTypesMock.mockResolvedValue([]);
    deleteSourceMock.mockReset();
    deleteSourceMock.mockResolvedValue(undefined);
    updateSourceMock.mockReset();
  });

  it("renders the schema table when a linked DataType has fields", () => {
    renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [linkedType] },
    });
    expect(screen.getByRole("region", { name: /inferred schema/i })).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("renders its preview DataGrid at condensed density (preview variant default)", async () => {
    fetchCsvPreviewMock.mockResolvedValue({ headers: ["id"], rows: [["1"]] });
    const { container } = renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [linkedType] },
    });

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

    expect(container.querySelector(".ui-data-grid")).toHaveClass("ui-data-grid--condensed");
  });

  it("renders the empty-schema affordance when no linked DataType exists", () => {
    renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [] },
    });
    expect(screen.getByRole("region", { name: /schema not available/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh source/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete and re-upload/i })).toBeInTheDocument();
  });

  it("calls refreshSource and re-fetches dataTypes when Refresh source is clicked", async () => {
    refreshSourceMock.mockResolvedValue(linkedType);
    renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh source/i }));

    await waitFor(() => {
      expect(refreshSourceMock).toHaveBeenCalledWith("src-1", "csv");
    });
    expect(fetchDataTypesMock).toHaveBeenCalled();
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
    renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/missing on disk.*re-upload/i);
  });

  it("falls back to a generic message when the error is not an axios error", async () => {
    refreshSourceMock.mockRejectedValue(new Error("network down"));
    renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [] },
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed to refresh source/i);
  });

  it("F-179: the truncated source name carries a title attribute with the full name", () => {
    renderWithStore(<SourceDetailPanel source={csvSource} />, {
      dataTypes: { items: [linkedType] },
    });
    expect(screen.getByText("Sales CSV")).toHaveAttribute("title", "Sales CSV");
  });

  describe("delete confirmation (F-012)", () => {
    it("requires confirmation before deleting — no single-click delete", () => {
      renderWithStore(<SourceDetailPanel source={csvSource} />, {
        dataTypes: { items: [] },
      });

      fireEvent.click(screen.getByRole("button", { name: /delete and re-upload/i }));

      expect(deleteSourceMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /confirm delete/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));
      expect(deleteSourceMock).toHaveBeenCalledWith("src-1");
    });

    it("Cancel backs out without deleting", () => {
      renderWithStore(<SourceDetailPanel source={csvSource} />, {
        dataTypes: { items: [] },
      });

      fireEvent.click(screen.getByRole("button", { name: /delete and re-upload/i }));
      fireEvent.click(screen.getByRole("button", { name: /cancel delete/i }));

      expect(deleteSourceMock).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /delete and re-upload/i })).toBeInTheDocument();
    });
  });

  describe("inline rename (F-070)", () => {
    it("commits a rename via updateSource on Enter", async () => {
      updateSourceMock.mockResolvedValue({ ...csvSource, name: "Renamed Sales CSV" });
      renderWithStore(<SourceDetailPanel source={csvSource} />, {
        dataTypes: { items: [linkedType] },
      });

      fireEvent.click(screen.getByRole("button", { name: /rename sales csv/i }));
      const input = screen.getByRole("textbox", { name: /rename sales csv/i });
      fireEvent.change(input, { target: { value: "Renamed Sales CSV" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() =>
        expect(updateSourceMock).toHaveBeenCalledWith("src-1", "Renamed Sales CSV"),
      );
    });

    it("Escape cancels without saving", () => {
      renderWithStore(<SourceDetailPanel source={csvSource} />, {
        dataTypes: { items: [linkedType] },
      });

      fireEvent.click(screen.getByRole("button", { name: /rename sales csv/i }));
      const input = screen.getByRole("textbox", { name: /rename sales csv/i });
      fireEvent.change(input, { target: { value: "Something else" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(updateSourceMock).not.toHaveBeenCalled();
      expect(screen.getByText("Sales CSV")).toBeInTheDocument();
    });
  });
});
