import { render, screen } from "@testing-library/react";

import { CollectionRenderer } from "./CollectionRenderer";

const FIELD_MAPPING = { value: "amount", label: "region" };

const HEADERS = ["region", "amount"];
const ROWS = [
  ["North", "100"],
  ["South", "200"],
  ["East", "300"],
];

describe("CollectionRenderer — one row per item (HEL-247)", () => {
  it("expands N bound rows into N metric items, each with its own mapped value", () => {
    const { container } = render(
      <CollectionRenderer
        fieldMapping={FIELD_MAPPING}
        layout="grid"
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    const items = container.querySelectorAll(".panel-content__collection-item");
    expect(items).toHaveLength(3);
    // Each item shows its own row's value, not a shared one.
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("South")).toBeInTheDocument();
  });

  it("applies a literal metricOptions.unit to every item", () => {
    const { container } = render(
      <CollectionRenderer
        fieldMapping={FIELD_MAPPING}
        layout="grid"
        metricOptions={{ unit: "$" }}
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
        fieldMapping={FIELD_MAPPING}
        layout="grid"
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    expect(container.querySelector(".panel-content--collection-grid")).toBeInTheDocument();
  });

  it("applies the list layout class for list collections", () => {
    const { container } = render(
      <CollectionRenderer
        fieldMapping={FIELD_MAPPING}
        layout="list"
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    expect(container.querySelector(".panel-content--collection-list")).toBeInTheDocument();
  });
});

describe("CollectionRenderer format (HEL-876)", () => {
  it("forwards format to each item's MetricRenderer (baseType: metric)", () => {
    render(
      <CollectionRenderer
        fieldMapping={FIELD_MAPPING}
        layout="grid"
        format="currency"
        rawRows={ROWS}
        headers={HEADERS}
      />,
    );
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("$200.00")).toBeInTheDocument();
    expect(screen.getByText("$300.00")).toBeInTheDocument();
  });
});

describe("CollectionRenderer — empty state", () => {
  it("shows a No data state when the snapshot has zero rows", () => {
    render(
      <CollectionRenderer
        fieldMapping={FIELD_MAPPING}
        layout="grid"
        rawRows={[]}
        headers={HEADERS}
      />,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
