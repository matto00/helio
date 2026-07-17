import { render, screen } from "@testing-library/react";

import { CollectionRenderer } from "./CollectionRenderer";
import type { CollectionPanel } from "../../types/panel";

function makeCollectionPanel(config: Partial<CollectionPanel["config"]> = {}): CollectionPanel {
  return {
    id: "p1",
    dashboardId: "d1",
    title: "Metrics by Region",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "", color: "", transparency: 0 },
    ownerId: "u",
    refreshInterval: null,
    type: "collection",
    config: {
      dataTypeId: "dt-1",
      fieldMapping: { value: "amount", label: "region" },
      baseType: "metric",
      layout: "grid",
      ...config,
    },
  };
}

const HEADERS = ["region", "amount"];
const ROWS = [
  ["North", "100"],
  ["South", "200"],
  ["East", "300"],
];

describe("CollectionRenderer — one row per item (HEL-247)", () => {
  it("expands N bound rows into N metric items, each with its own mapped value", () => {
    const { container } = render(
      <CollectionRenderer panel={makeCollectionPanel()} rawRows={ROWS} headers={HEADERS} />,
    );
    const items = container.querySelectorAll(".panel-content__collection-item");
    expect(items).toHaveLength(3);
    // Each item shows its own row's value, not a shared one.
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    // And its own row's label.
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("South")).toBeInTheDocument();
  });

  it("applies a literal itemOptions.metric.unit to every item", () => {
    const { container } = render(
      <CollectionRenderer
        panel={makeCollectionPanel({ itemOptions: { metric: { unit: "$" } } })}
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    const units = container.querySelectorAll(".panel-content__metric-unit");
    expect(units).toHaveLength(3);
    units.forEach((u) => expect(u).toHaveTextContent("$"));
  });

  it("applies the grid layout class for grid collections", () => {
    const { container } = render(
      <CollectionRenderer
        panel={makeCollectionPanel({ layout: "grid" })}
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    expect(container.querySelector(".panel-content--collection-grid")).toBeInTheDocument();
  });

  it("applies the list layout class for list collections", () => {
    const { container } = render(
      <CollectionRenderer
        panel={makeCollectionPanel({ layout: "list" })}
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    expect(container.querySelector(".panel-content--collection-list")).toBeInTheDocument();
  });
});

describe("CollectionRenderer — empty and unbound states", () => {
  it("shows an unbound placeholder when no data type is bound", () => {
    render(
      <CollectionRenderer
        panel={makeCollectionPanel({ dataTypeId: "" })}
        rawRows={null}
        headers={null}
      />,
    );
    expect(screen.getByText(/bind a data type/i)).toBeInTheDocument();
  });

  it("shows a No data state when bound but the snapshot has zero rows", () => {
    render(<CollectionRenderer panel={makeCollectionPanel()} rawRows={[]} headers={HEADERS} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
