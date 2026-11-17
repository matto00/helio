import { screen, waitFor, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputRows } from "../../pipelines/services/outputService";
import { LiveOutputRender } from "../../pipelines/ui/liveOutput/LiveOutputRender";
import { frameColumns, frameToRecords } from "../../pipelines/state/liveOutput/frameRecords";
import type { Output } from "../../pipelines/types/output";
import { usePanelData } from "../hooks/usePanelData";
import { PanelContent } from "./PanelContent";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  hasRunBaseline: jest.fn(() => false),
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const rows = jest.mocked(getOutputRows);

// HEL-1705 H: a saved table panel (through the real fetch, `usePanelData` and `OutputPanelContent`) and the live table lay
// their columns out in the same order, for a schema that is not alphabetical and holds an integer-like name.
const SCHEMA = ["zeta", "10", "alpha"].map((name) => ({ name, type: "string" }));
const OUTPUT: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Ordered",
  kind: "table",
  config: {},
  schema: SCHEMA,
  createdAt: "",
  updatedAt: "",
};
const PANEL = makeOutputPanel({ id: "panel-1", config: { outputId: "output-1" } });
// What the browser makes of the server's `{"zeta","10","alpha"}` row: the integer-like key is listed first.
const ITEM = JSON.parse('{"zeta":"z","10":"ten","alpha":"a"}') as Record<string, unknown>;

function SavedPanel() {
  const d = usePanelData(PANEL);
  return (
    <PanelContent
      panel={PANEL}
      rawRows={d.rawRows}
      headers={d.headers}
      paginationRows={d.paginationRows}
      columns={d.columns}
      isLoading={d.isLoading}
      noData={d.noData}
      rowsTruncated={d.rowsTruncated}
      output={OUTPUT}
      outputMetaLoading={false}
      crossFilterMode="none"
    />
  );
}

const headerTexts = () =>
  screen.getAllByRole("columnheader").map((h) => h.textContent?.replace(/[^\w]/g, "").trim());

describe("saved table column order (HEL-1705)", () => {
  beforeEach(() => rows.mockReset());

  it("lays the columns out in the response's order, the same as the live table", async () => {
    rows.mockResolvedValue({
      items: [ITEM],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
      columns: ["zeta", "10", "alpha"],
    });
    renderWithStore(<SavedPanel />);
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    const saved = headerTexts();
    expect(saved).toEqual(["zeta", "10", "alpha"]);

    const frame = [{ zeta: "z", "10": "ten", alpha: "a" }];
    const { container } = renderWithStore(
      <LiveOutputRender
        kind="table"
        config={{}}
        schema={SCHEMA}
        records={frameToRecords(frame, SCHEMA)}
        columns={frameColumns(frame, SCHEMA)}
      />,
    );
    const live = within(container)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(live).toEqual(saved);
  });

  it("keeps the natural sort for a window whose response carried no columns (an older server or warm copy)", async () => {
    rows.mockResolvedValue({
      items: [ITEM],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    renderWithStore(<SavedPanel />);
    await waitFor(() => expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0));
    expect(headerTexts()).toEqual(["10", "alpha", "zeta"]);
  });
});
