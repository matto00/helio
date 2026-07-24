import { render, screen, waitFor } from "@testing-library/react";

import { listConnectors as listConnectorsRequest } from "../services/connectorService";
import { SourceTypeToggle } from "./SourceTypeToggle";

jest.mock("../services/connectorService", () => ({
  listConnectors: jest.fn(),
}));

const listConnectorsMock = jest.mocked(listConnectorsRequest);

// HEL-484: the 7-entry registry payload, in the order/labels design.md
// Decision 6 pins to match the pre-registry hardcoded toggle exactly.
const REGISTRY_ENTRIES = [
  {
    kind: "rest_api",
    displayName: "REST API",
    supportsIncremental: false,
    authKind: "configurable",
    requiredFields: [],
  },
  {
    kind: "csv",
    displayName: "CSV File",
    supportsIncremental: false,
    authKind: "none",
    requiredFields: [],
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
];

const EXPECTED_LABELS = [
  "REST API",
  "CSV File",
  "Manual",
  "SQL Database",
  "Text/Markdown",
  "PDF",
  "Image",
];

describe("SourceTypeToggle (HEL-484 — registry-driven)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the same 7 buttons, in the same order, with the same labels as the pre-registry toggle once GET /api/connectors resolves", async () => {
    listConnectorsMock.mockResolvedValue(REGISTRY_ENTRIES);
    render(<SourceTypeToggle active="rest_api" onChange={jest.fn()} />);

    await waitFor(() => expect(listConnectorsMock).toHaveBeenCalled());

    const group = await screen.findByRole("group", { name: "Source type" });
    const buttons = await waitFor(() => {
      const found = Array.from(group.querySelectorAll("button"));
      expect(found).toHaveLength(7);
      return found;
    });
    expect(buttons.map((b) => b.textContent)).toEqual(EXPECTED_LABELS);
  });

  it("marks the active kind's button with the active class", async () => {
    listConnectorsMock.mockResolvedValue(REGISTRY_ENTRIES);
    render(<SourceTypeToggle active="sql" onChange={jest.fn()} />);

    const sqlButton = await screen.findByRole("button", { name: "SQL Database" });
    await waitFor(() =>
      expect(sqlButton.className).toContain("add-source-modal__type-btn--active"),
    );
  });

  it("calls onChange with the clicked entry's kind", async () => {
    listConnectorsMock.mockResolvedValue(REGISTRY_ENTRIES);
    const onChange = jest.fn();
    render(<SourceTypeToggle active="rest_api" onChange={onChange} />);

    const pdfButton = await screen.findByRole("button", { name: "PDF" });
    pdfButton.click();

    expect(onChange).toHaveBeenCalledWith("pdf");
  });

  it("renders the same 7 fallback buttons immediately (before the fetch resolves) so the toggle never flashes empty", () => {
    listConnectorsMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SourceTypeToggle active="rest_api" onChange={jest.fn()} />);

    const group = screen.getByRole("group", { name: "Source type" });
    expect(group.querySelectorAll("button")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "REST API" })).toBeInTheDocument();
  });

  it("keeps rendering the same 7 fallback buttons if the fetch fails", async () => {
    listConnectorsMock.mockRejectedValue(new Error("network error"));
    render(<SourceTypeToggle active="rest_api" onChange={jest.fn()} />);

    await waitFor(() => expect(listConnectorsMock).toHaveBeenCalled());

    const group = screen.getByRole("group", { name: "Source type" });
    expect(group.querySelectorAll("button")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "REST API" })).toBeInTheDocument();
  });
});
