import { fireEvent, screen, waitFor } from "@testing-library/react";

import {
  createImageSourceUpload as createImageSourceUploadRequest,
  createImageSourceUrl as createImageSourceUrlRequest,
  createTextSourceUpload as createTextSourceUploadRequest,
  createTextSourceUrl as createTextSourceUrlRequest,
  createPdfSourceUpload as createPdfSourceUploadRequest,
  createPdfSourceUrl as createPdfSourceUrlRequest,
  createRestSource as createRestSourceRequest,
  createStaticSource as createStaticSourceRequest,
  inferFromJson as inferFromJsonRequest,
  testConnection as testConnectionRequest,
} from "../services/dataSourceService";
import { fetchConnectors as fetchConnectorsRequest } from "../../connectors/services/connectorEntityService";
import { renderWithStore } from "../../../test/renderWithStore";
import { AddSourceModal } from "./AddSourceModal";

// HEL-827: ConnectorSelectField fetches GET /api/connectors on mount
// (connectorsSlice's fetchConnectors thunk). Resolve with one Connector so
// the REST tests below can select it the way a real user would.
jest.mock("../../connectors/services/connectorEntityService", () => ({
  fetchConnectors: jest.fn().mockResolvedValue([
    {
      id: "connector-1",
      ownerId: "user-1",
      name: "Test API",
      kind: "rest_api",
      baseUrl: "https://api.example.com",
      config: { authType: "none" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      dependentCount: 0,
    },
  ]),
  createConnector: jest.fn().mockResolvedValue({
    id: "connector-new",
    ownerId: "user-1",
    name: "New API",
    kind: "rest_api",
    baseUrl: "https://new.example.com",
    config: { authType: "none" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    dependentCount: 0,
  }),
  updateConnector: jest.fn(),
  deleteConnector: jest.fn(),
  rotateConnectorCredential: jest.fn(),
}));

// HEL-484: SourceTypeToggle fetches GET /api/connector-types on mount. Resolve
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

const createTextSourceUploadMock = jest.mocked(createTextSourceUploadRequest);
const createTextSourceUrlMock = jest.mocked(createTextSourceUrlRequest);
const createPdfSourceUploadMock = jest.mocked(createPdfSourceUploadRequest);
const createPdfSourceUrlMock = jest.mocked(createPdfSourceUrlRequest);
const createImageSourceUploadMock = jest.mocked(createImageSourceUploadRequest);
const createImageSourceUrlMock = jest.mocked(createImageSourceUrlRequest);
const createStaticSourceMock = jest.mocked(createStaticSourceRequest);
const createRestSourceMock = jest.mocked(createRestSourceRequest);
const inferFromJsonMock = jest.mocked(inferFromJsonRequest);
const testConnectionMock = jest.mocked(testConnectionRequest);
const fetchConnectorsMock = jest.mocked(fetchConnectorsRequest);

/** HEL-827: selects the mocked Connector via the picker — the REST form now
 *  requires this before endpoint/test/create are reachable. */
async function selectTestConnector() {
  fireEvent.click(screen.getByRole("combobox", { name: "Connector" }));
  const option = await screen.findByRole("option", { name: /test api/i });
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByLabelText("Endpoint path")).toBeEnabled());
}

describe("AddSourceModal — text/Markdown source (HEL-215)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      inferredSchema: [],
      config: { path: "text/ds-1.txt" },
    });
    const onClose = jest.fn();
    const { store } = renderWithStore(<AddSourceModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /text\/markdown/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Notes" } });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/text\/markdown file/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() => expect(createTextSourceUploadMock).toHaveBeenCalledWith("Notes", file));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // F-008: the new source is selected (not silently buried at the bottom
    // of the list) and exactly one confirmation toast is pushed.
    expect(store.getState().sources.selectedSourceId).toBe("ds-1");
    // HEL-535 5.11 — a direct-service create path (no thunk, no listener):
    // this toast can only come from finishCreate itself.
    expect(store.getState().toasts.items).toHaveLength(1);
    expect(store.getState().toasts.items[0]).toMatchObject({
      variant: "success",
      message: 'Data source "Notes" created.',
    });
  });

  it("creates a text source via URL ingestion", async () => {
    createTextSourceUrlMock.mockResolvedValue({
      id: "ds-2",
      name: "URL Notes",
      type: "text",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      inferredSchema: [],
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

    // F-051: the shared <InlineError> default variant carries no alert role
    // (matches every other plain-text InlineError consumer app-wide); F-052
    // moves focus to the invalid field and marks it `aria-invalid` instead —
    // assert both.
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/source name/i);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveFocus();
    expect(createTextSourceUploadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AddSourceModal — PDF source (HEL-214)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      inferredSchema: [],
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
      inferredSchema: [],
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

    // F-051: the shared <InlineError> default variant carries no alert role
    // (matches every other plain-text InlineError consumer app-wide); F-052
    // moves focus to the invalid field and marks it `aria-invalid` instead —
    // assert both.
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/source name/i);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveFocus();
    expect(createPdfSourceUploadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AddSourceModal — image source (HEL-216)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      inferredSchema: [],
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
      inferredSchema: [],
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

    // F-051: the shared <InlineError> default variant carries no alert role
    // (matches every other plain-text InlineError consumer app-wide); F-052
    // moves focus to the invalid field and marks it `aria-invalid` instead —
    // assert both.
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    const nameInput = screen.getByLabelText(/source name/i);
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveFocus();
    expect(createImageSourceUploadMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("AddSourceModal — REST API connection test (HEL-480)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchConnectorsMock.mockResolvedValue([
      {
        id: "connector-1",
        ownerId: "user-1",
        name: "Test API",
        kind: "rest_api",
        baseUrl: "https://api.example.com",
        config: { authType: "none" },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        dependentCount: 0,
      },
    ]);
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

  it("renders a Connector picker and a 'Test connection' affordance alongside the endpoint/JSON path fields", () => {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    expect(screen.getByRole("combobox", { name: "Connector" })).toBeInTheDocument();
    expect(screen.getByLabelText("Endpoint path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument();
  });

  // HEL-827: no Connector selected yet — save/test before this point must be
  // unreachable, proving the UI never emits a bare-url create/test request.
  it("disables 'Test connection' and the endpoint field until a Connector is selected", () => {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    expect(screen.getByLabelText("Endpoint path")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  // Design Decision 5a regression: TestConnectionAffordance's button MUST be
  // type="button" — AddSourceModal wraps RestApiForm in one native
  // <form onSubmit={handlePreview}> (configure step), so a submit-typed
  // button would fire handlePreview -> inferFromJson and silently advance
  // the modal to the preview step instead of just triggering the test.
  it("clicking 'Test connection' does not submit the configure form or advance past the configure step", async () => {
    testConnectionMock.mockResolvedValue({ ok: true, error: null });
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    await selectTestConnector();

    fireEvent.change(screen.getByLabelText("Endpoint path"), {
      target: { value: "/v1/accounts" },
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
    await selectTestConnector();

    fireEvent.change(screen.getByLabelText("Endpoint path"), {
      target: { value: "/v1/accounts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Connected/)).toBeInTheDocument();
    });
  });

  it("test request carries the selected connectorId and endpoint, never a bare url", async () => {
    testConnectionMock.mockResolvedValue({ ok: true, error: null });
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);
    await selectTestConnector();

    fireEvent.change(screen.getByLabelText("Endpoint path"), {
      target: { value: "/v1/accounts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(testConnectionMock).toHaveBeenCalled());
    const [, config] = testConnectionMock.mock.calls[0];
    expect(config).toMatchObject({ connectorId: "connector-1", endpoint: "/v1/accounts" });
    expect(config).not.toHaveProperty("url");
  });

  it("creates a REST source via the Connector + endpoint composed config", async () => {
    inferFromJsonMock.mockResolvedValue([]);
    createRestSourceMock.mockResolvedValue({
      source: {
        id: "ds-rest-1",
        name: "Sales API",
        type: "rest_api",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        inferredSchema: [],
        config: { url: "https://api.example.com/v1/accounts" },
      },
      fetchError: null,
    });
    const onClose = jest.fn();
    renderWithStore(<AddSourceModal onClose={onClose} />);
    await selectTestConnector();

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Sales API" } });
    fireEvent.change(screen.getByLabelText("Endpoint path"), {
      target: { value: "/v1/accounts" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview schema/i }));

    await waitFor(() => expect(inferFromJsonMock).toHaveBeenCalled());
    const previewConfig = inferFromJsonMock.mock.calls[0][0];
    expect(previewConfig).toMatchObject({ connectorId: "connector-1", endpoint: "/v1/accounts" });
    expect(previewConfig).not.toHaveProperty("url");

    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() => expect(createRestSourceMock).toHaveBeenCalled());
    const [, createConfig] = createRestSourceMock.mock.calls[0];
    expect(createConfig).toMatchObject({ connectorId: "connector-1", endpoint: "/v1/accounts" });
    expect(createConfig).not.toHaveProperty("url");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // design.md Decision 1 / spec scenario "User creates a Connector inline":
  // creating a Connector via the picker's "create new" flow selects the
  // returned Connector and preserves other REST field values already entered.
  it("creates a Connector inline via the picker and selects it without losing other field values", async () => {
    renderWithStore(<AddSourceModal onClose={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Sales API" } });

    fireEvent.click(screen.getByRole("combobox", { name: "Connector" }));
    fireEvent.click(await screen.findByRole("option", { name: /create new connector/i }));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New API" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://new.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create connector" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Create connector" })).not.toBeInTheDocument(),
    );
    // The inner modal closed and the picker now shows the newly created
    // Connector selected — endpoint becomes reachable.
    await waitFor(() => expect(screen.getByLabelText("Endpoint path")).toBeEnabled());
    // The source name typed before opening the inner modal survived the
    // round trip (state lives in useRestSourceForm, unaffected by the child
    // modal mounting/unmounting).
    expect(screen.getByLabelText("Source name")).toHaveValue("Sales API");
  });
});

// F-008: the text-source-upload test above covers `finishCreate`'s direct
// (non-thunk) service-call shape, shared by text/pdf/image/REST/CSV. Static
// and SQL instead go through `dispatch(thunk(...)).unwrap()` — a distinct
// code path in `AddSourceModal.tsx` — so it gets its own coverage here.
describe("AddSourceModal — static source (thunk-dispatched create path, F-008)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  // HEL-535 D6/5.11 — `renderWithStore`'s plain store (used everywhere else
  // in this file) doesn't wire `listenerMiddleware`, so it can't observe the
  // toastListeners.ts `.fulfilled` entry this thunk path relies on for its
  // ONE toast (finishCreate passes `{ toast: false }` here — see
  // AddSourceModal.tsx). `withToastListeners: true` wires it in, mirroring
  // the real app store, so this test can assert exactly one toast — proving
  // the create path doesn't double-toast (finishCreate's own push plus the
  // listener's) the way it used to.
  it("selects the newly created source (not silently buried) and toasts exactly once, matching the direct-service path's wording", async () => {
    createStaticSourceMock.mockResolvedValue({
      id: "ds-static-1",
      name: "Ref table",
      type: "static",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      inferredSchema: [],
    });
    const onClose = jest.fn();
    const { store } = renderWithStore(<AddSourceModal onClose={onClose} />, undefined, "/", {
      withToastListeners: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /manual/i }));

    fireEvent.change(screen.getByLabelText("Source name"), { target: { value: "Ref table" } });
    fireEvent.change(screen.getByLabelText(/column 1 name/i), { target: { value: "id" } });
    fireEvent.click(screen.getByRole("button", { name: /next: add rows/i }));
    fireEvent.click(screen.getByRole("button", { name: /create source/i }));

    await waitFor(() =>
      expect(createStaticSourceMock).toHaveBeenCalledWith(
        "Ref table",
        [{ name: "id", type: "string" }],
        [],
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(store.getState().sources.selectedSourceId).toBe("ds-static-1");
    await waitFor(() => expect(store.getState().toasts.items).toHaveLength(1));
    // Same wording template as the direct-service path's toast above
    // (`Data source "<name>" created.`) — one action, one wording,
    // regardless of which of the modal's seven internal paths ran it.
    expect(store.getState().toasts.items[0]).toMatchObject({
      variant: "success",
      message: 'Data source "Ref table" created.',
    });
  });
});
