import { screen, waitFor } from "@testing-library/react";

import {
  getFilterCapabilities as getFilterCapabilitiesRequest,
  getOutputById as getOutputByIdRequest,
  getOutputRows as getOutputRowsRequest,
} from "../../../pipelines/services/outputService";
import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { resetCapabilitiesStoreForTests } from "../../state/filterCapabilitiesStore";
import type { Output } from "../../../pipelines/types/output";
import { PanelDetailModal } from "./PanelDetailModal";

// HEL-1191 design.md D9/D9b — the detail modal owns its own `usePanelData` AND resolves the
// Output, so it computes the cross-filter decision itself: server mode sends the eq and does NOT
// filter client-side; fallback mode filters client-side and sends no eq.

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(),
  getOutputRows: jest.fn(),
  getFilterCapabilities: jest.fn(),
  getDistinctValues: jest.fn().mockResolvedValue({ column: "", values: [] }),
  listOutputPanels: jest.fn().mockResolvedValue([]),
}));

const getOutputById = jest.mocked(getOutputByIdRequest);
const getOutputRows = jest.mocked(getOutputRowsRequest);
const getFilterCapabilities = jest.mocked(getFilterCapabilitiesRequest);

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "table",
  config: { columnOrder: ["quarter", "revenue"] },
  schema: [
    { name: "quarter", type: "string" },
    { name: "revenue", type: "integer" },
  ],
  createdAt: "",
  updatedAt: "",
};

const panel = makeOutputPanel({
  id: "p-sibling",
  dashboardId: "d1",
  title: "Revenue",
  config: { outputId: "output-1" },
});

const hasEq = (call: unknown[]) =>
  ((call[4] as { ops?: { op: string }[] } | undefined)?.ops ?? []).some((o) => o.op === "eq");

function renderModal() {
  return renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    panels: {
      items: [panel],
      crossFilter: { panelId: "origin", dimension: "quarter", value: "Q1", series: "" },
    },
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
  getOutputById.mockResolvedValue(output);
});

describe("PanelDetailModal — HEL-1191 cross-filter", () => {
  it("server mode: the fetch carries the eq and the rows are NOT filtered a second time client-side", async () => {
    getFilterCapabilities.mockResolvedValue({
      columns: [{ column: "quarter", operators: ["eq"] }],
    });
    // A (fake) server that returns whatever it likes: a Q2 row proves the client applies no filter.
    getOutputRows.mockImplementation((_id, _o, _l, _s, filter) =>
      Promise.resolve({
        items: (filter?.ops ?? []).some((o) => o.op === "eq")
          ? [
              { quarter: "Q1", revenue: 100 },
              { quarter: "Q2", revenue: 777 },
            ]
          : [{ quarter: "Q1", revenue: 100 }],
        total: 2,
        offset: 0,
        limit: 200,
        materialized: true,
      }),
    );
    renderModal();

    expect(await screen.findByText("777")).toBeInTheDocument();
    expect(getOutputRows.mock.calls.some(hasEq)).toBe(true);
    expect(screen.queryByText(/loaded rows match/)).not.toBeInTheDocument();
  });

  it("fallback mode (contract disallows eq): no eq is sent and the loaded rows narrow client-side", async () => {
    getFilterCapabilities.mockResolvedValue({
      columns: [{ column: "quarter", operators: ["contains"] }],
    });
    getOutputRows.mockResolvedValue({
      items: [
        { quarter: "Q1", revenue: 100 },
        { quarter: "Q2", revenue: 777 },
      ],
      total: 2,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    renderModal();

    expect(await screen.findByText("100")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("777")).not.toBeInTheDocument());
    expect(getOutputRows.mock.calls.some(hasEq)).toBe(false);
  });
});
