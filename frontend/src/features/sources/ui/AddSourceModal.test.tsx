import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  createTextSourceUpload as createTextSourceUploadRequest,
  createTextSourceUrl as createTextSourceUrlRequest,
} from "../services/dataSourceService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { AddSourceModal } from "./AddSourceModal";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  createCsvSource: jest.fn(),
  createRestSource: jest.fn(),
  createTextSourceUpload: jest.fn(),
  createTextSourceUrl: jest.fn(),
  createStaticSource: jest.fn(),
  createSqlSource: jest.fn(),
  inferSqlSource: jest.fn(),
  inferFromCsv: jest.fn(),
  inferFromJson: jest.fn(),
  updateSource: jest.fn(),
  deleteSource: jest.fn(),
  refreshSource: jest.fn(),
}));

jest.mock("../../dataTypes/services/dataTypeService", () => ({
  fetchDataTypes: jest.fn(),
  updateDataType: jest.fn(),
  deleteDataType: jest.fn(),
}));

const createTextSourceUploadMock = jest.mocked(createTextSourceUploadRequest);
const createTextSourceUrlMock = jest.mocked(createTextSourceUrlRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);

describe("AddSourceModal — text/Markdown source (HEL-215)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchDataTypesMock.mockResolvedValue([]);
    // jsdom does not implement showModal/close natively (Modal.tsx uses a
    // native <dialog>); stub them, mirroring shared/ui/Modal.test.tsx.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  function openTextTab() {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /text\/markdown/i }));
  }

  it("shows the text source name field and ingestion-method toggle when selected", () => {
    openTextTab();
    expect(screen.getByLabelText("Source name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /from url/i })).toBeInTheDocument();
  });

  it("creates a text source via upload and refreshes the sources list", async () => {
    createTextSourceUploadMock.mockResolvedValue({
      id: "ds-1",
      name: "Notes",
      type: "text",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      config: { path: "text/ds-1.txt" },
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /text\/markdown/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Notes" } });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/text\/markdown file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() => expect(createTextSourceUploadMock).toHaveBeenCalledWith("Notes", file));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("creates a text source via URL ingestion", async () => {
    createTextSourceUrlMock.mockResolvedValue({
      id: "ds-2",
      name: "URL Notes",
      type: "text",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      config: { path: "text/ds-2.txt", sourceUrl: "https://example.com/notes.txt" },
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /text\/markdown/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "URL Notes" } });
    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/notes.txt" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() =>
      expect(createTextSourceUrlMock).toHaveBeenCalledWith(
        "URL Notes",
        "https://example.com/notes.txt",
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an error and does not close when name is missing", async () => {
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /text\/markdown/i }));

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/text\/markdown file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/name is required/i);
    expect(createTextSourceUploadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
