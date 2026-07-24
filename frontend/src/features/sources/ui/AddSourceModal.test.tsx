import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  createImageSourceUpload as createImageSourceUploadRequest,
  createImageSourceUrl as createImageSourceUrlRequest,
  createTextSourceUpload as createTextSourceUploadRequest,
  createTextSourceUrl as createTextSourceUrlRequest,
  createPdfSourceUpload as createPdfSourceUploadRequest,
  createPdfSourceUrl as createPdfSourceUrlRequest,
  inferFromJson as inferFromJsonRequest,
  testConnection as testConnectionRequest,
} from "../services/dataSourceService";
import { fetchDataTypes as fetchDataTypesRequest } from "../../dataTypes/services/dataTypeService";
import { renderWithStore } from "../../../test/renderWithStore";
import { AddSourceModal } from "./AddSourceModal";

// HEL-484: SourceTypeToggle fetches GET /api/connectors on mount. Resolve
// with the same 7-kind/order/label set the pre-registry hardcoded toggle
// rendered, so every existing assertion here (which locates buttons by their
// pre-registry labels) keeps passing unchanged.
jest.mock("../services/connectorService", () => ({
  listConnectors: jest.fn().mockResolvedValue([
    {
      kind: "rest_api",
      displayName: "REST API",
      supportsIncremental: false,
      authKind: "configurable",
      requiredFields: [{ name: "url", label: "URL", secret: false }],
    },
    {
      kind: "csv",
      displayName: "CSV File",
      supportsIncremental: false,
      authKind: "none",
      requiredFields: [{ name: "path", label: "Path", secret: false }],
    },
    {
      kind: "static",
      displayName: "Manual",
      supportsIncremental: false,
      authKind: "none",
      requiredFields: [],
    },
    {
      kind: "sql",
      displayName: "SQL Database",
      supportsIncremental: false,
      authKind: "basic",
      requiredFields: [],
    },
    {
      kind: "text",
      displayName: "Text/Markdown",
      supportsIncremental: false,
      authKind: "none",
      requiredFields: [],
    },
    {
      kind: "pdf",
      displayName: "PDF",
      supportsIncremental: false,
      authKind: "none",
      requiredFields: [],
    },
    {
      kind: "image",
      displayName: "Image",
      supportsIncremental: false,
      authKind: "none",
      requiredFields: [],
    },
  ]),
}));

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn().mockResolvedValue([]),
  createCsvSource: jest.fn(),
  createRestSource: jest.fn(),
  createTextSourceUpload: jest.fn(),
  createTextSourceUrl: jest.fn(),
  createPdfSourceUpload: jest.fn(),
  createPdfSourceUrl: jest.fn(),
  createImageSourceUpload: jest.fn(),
  createImageSourceUrl: jest.fn(),
  createStaticSource: jest.fn(),
  createSqlSource: jest.fn(),
  inferSqlSource: jest.fn(),
  inferFromCsv: jest.fn(),
  inferFromJson: jest.fn(),
  testConnection: jest.fn(),
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
const createPdfSourceUploadMock = jest.mocked(createPdfSourceUploadRequest);
const createPdfSourceUrlMock = jest.mocked(createPdfSourceUrlRequest);
const createImageSourceUploadMock = jest.mocked(createImageSourceUploadRequest);
const createImageSourceUrlMock = jest.mocked(createImageSourceUrlRequest);
const fetchDataTypesMock = jest.mocked(fetchDataTypesRequest);
const inferFromJsonMock = jest.mocked(inferFromJsonRequest);
const testConnectionMock = jest.mocked(testConnectionRequest);

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

describe("AddSourceModal — PDF source (HEL-214)", () => {
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

  function openPdfTab() {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^pdf$/i }));
  }

  it("shows the pdf source name field and ingestion-method toggle when selected", () => {
    openPdfTab();
    expect(screen.getByLabelText("Source name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /from url/i })).toBeInTheDocument();
  });

  it("creates a pdf source via upload and refreshes the sources list", async () => {
    createPdfSourceUploadMock.mockResolvedValue({
      id: "ds-1",
      name: "Report",
      type: "pdf",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      config: { path: "pdf/ds-1.pdf" },
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^pdf$/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Report" } });
    const file = new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/pdf file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() => expect(createPdfSourceUploadMock).toHaveBeenCalledWith("Report", file));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("creates a pdf source via URL ingestion", async () => {
    createPdfSourceUrlMock.mockResolvedValue({
      id: "ds-2",
      name: "URL Report",
      type: "pdf",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      config: { path: "pdf/ds-2.pdf", sourceUrl: "https://example.com/report.pdf" },
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^pdf$/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "URL Report" } });
    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/report.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() =>
      expect(createPdfSourceUrlMock).toHaveBeenCalledWith(
        "URL Report",
        "https://example.com/report.pdf",
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an error and does not close when name is missing", async () => {
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^pdf$/i }));

    const file = new File(["%PDF-1.4"], "report.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText(/pdf file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/name is required/i);
    expect(createPdfSourceUploadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AddSourceModal — image source (HEL-216)", () => {
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

  function openImageTab() {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
  }

  it("shows the image source name field and ingestion-method toggle when selected", () => {
    openImageTab();
    expect(screen.getByLabelText("Source name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /from url/i })).toBeInTheDocument();
  });

  it("creates an image source via upload and refreshes the sources list", async () => {
    createImageSourceUploadMock.mockResolvedValue({
      id: "ds-1",
      name: "Photo",
      type: "image",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      config: { path: "image/ds-1.png" },
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Photo" } });
    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/image file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() => expect(createImageSourceUploadMock).toHaveBeenCalledWith("Photo", file));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("creates an image source via URL ingestion", async () => {
    createImageSourceUrlMock.mockResolvedValue({
      id: "ds-2",
      name: "URL Photo",
      type: "image",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      config: { path: "image/ds-2.png", sourceUrl: "https://example.com/photo.png" },
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "URL Photo" } });
    fireEvent.click(screen.getByRole("button", { name: /from url/i }));
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/photo.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() =>
      expect(createImageSourceUrlMock).toHaveBeenCalledWith(
        "URL Photo",
        "https://example.com/photo.png",
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an error and does not close when name is missing", async () => {
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));

    const file = new File(["fake-bytes"], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/image file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/name is required/i);
    expect(createImageSourceUploadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AddSourceModal — REST API connection test (HEL-480)", () => {
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

  // REST API is the modal's default source type, so RestApiForm — and its
  // new TestConnectionAffordance — render without any tab switch.

  it("renders a 'Test connection' affordance alongside the URL/JSON path fields", () => {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
  });

  // Design Decision 5a regression: TestConnectionAffordance's button MUST be
  // type="button" — AddSourceModal wraps RestApiForm in one native
  // <form onSubmit={handlePreview}> (configure step), so a submit-typed
  // button would fire handlePreview -> inferFromJson and silently advance
  // the modal to the preview step instead of just triggering the test.
  it("clicking 'Test connection' does not submit the configure form or advance past the configure step", async () => {
    testConnectionMock.mockResolvedValue({ ok: true, error: null });
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://api.example.com/data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(testConnectionMock).toHaveBeenCalled());

    expect(inferFromJsonMock).not.toHaveBeenCalled();
    // Still on the configure step: "Preview schema" (the configure-step
    // submit button) is present; "Create source" only exists once `step`
    // has advanced to "preview", so its absence proves it never did.
    expect(screen.getByRole("button", { name: /preview schema/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create source/i })).not.toBeInTheDocument();
  });

  it("shows a success indicator after a successful test", async () => {
    testConnectionMock.mockResolvedValue({ ok: true, error: null });
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://api.example.com/data" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });
  });
});
