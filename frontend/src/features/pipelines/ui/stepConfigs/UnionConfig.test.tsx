import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { UnionConfig } from "./UnionConfig";
import type { UnionConfigValue } from "./UnionConfig";
import type { DataSource } from "../../../sources/types/dataSource";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";

const testDataSources: DataSource[] = [
  {
    id: "ds-1",
    name: "Sales API",
    type: "rest_api",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    inferredSchema: [],
    config: { url: "https://example.com/api" },
  },
  {
    id: "ds-2",
    name: "ERP DB",
    type: "sql",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    inferredSchema: [],
    config: {
      dialect: "postgresql",
      host: "h",
      port: 5432,
      database: "d",
      user: "u",
      password: "p",
      query: "SELECT 1",
    },
  },
];

const FILTER_OP = OP_TYPES.find((op) => op.id === "filter")!;

function makeStep(id: string, label: string): Step {
  return {
    id,
    opType: FILTER_OP,
    label,
    config: { combinator: "AND", conditions: [] },
    enabled: true,
  };
}

const otherSteps: Step[] = [
  makeStep("current", "Union step"),
  makeStep("s-upstream", "Filter rows"),
];

const emptyConfig: UnionConfigValue = {
  secondary: { kind: "source", dataSourceId: "" },
  mode: "byPosition",
};

function renderUnionConfig(config: UnionConfigValue, onChange = jest.fn()) {
  renderWithStore(
    <UnionConfig
      config={config}
      allSteps={otherSteps}
      currentStepId="current"
      onChange={onChange}
    />,
    { sources: { items: testDataSources, status: "succeeded" } },
  );
  return onChange;
}

/** Helper: open the other-source Select and pick an option by label. */
function selectOtherSource(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Other source" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("UnionConfig", () => {
  it("populates the picker with available data sources AND other lane nodes", () => {
    renderUnionConfig(emptyConfig);
    fireEvent.click(screen.getByRole("combobox", { name: "Other source" }));
    expect(screen.getByRole("option", { name: "Data source: Sales API" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Data source: ERP DB" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lane node: Filter rows" })).toBeInTheDocument();
  });

  it("selecting a data source calls onChange with a source-kind secondary, mode unchanged", () => {
    const onChange = renderUnionConfig(emptyConfig);
    selectOtherSource("Data source: Sales API");
    expect(onChange).toHaveBeenCalledWith({
      secondary: { kind: "source", dataSourceId: "ds-1" },
      mode: "byPosition",
    });
  });

  it("selecting another lane node calls onChange with a lane-kind secondary", () => {
    const onChange = renderUnionConfig(emptyConfig);
    selectOtherSource("Lane node: Filter rows");
    expect(onChange).toHaveBeenCalledWith({
      secondary: { kind: "lane", stepId: "s-upstream" },
      mode: "byPosition",
    });
  });

  const bySourceConfig: UnionConfigValue = {
    secondary: { kind: "source", dataSourceId: "ds-1" },
    mode: "byPosition",
  };

  it("toggling the mode control from byPosition to byName calls onChange with mode=byName", () => {
    const onChange = renderUnionConfig(bySourceConfig);
    fireEvent.click(screen.getByRole("button", { name: "BY NAME" }));
    expect(onChange).toHaveBeenCalledWith({ ...bySourceConfig, mode: "byName" });
  });

  it("toggling the mode control from byName back to byPosition calls onChange with mode=byPosition", () => {
    const onChange = renderUnionConfig({ ...bySourceConfig, mode: "byName" });
    fireEvent.click(screen.getByRole("button", { name: "BY POSITION" }));
    expect(onChange).toHaveBeenCalledWith({ ...bySourceConfig, mode: "byPosition" });
  });

  it("marks the active mode button with aria-pressed", () => {
    renderUnionConfig({ ...bySourceConfig, mode: "byName" });
    expect(screen.getByRole("button", { name: "BY POSITION" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "BY NAME" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a byPosition-specific description by default", () => {
    renderUnionConfig(emptyConfig);
    expect(screen.getByText(/appended as-is/i)).toBeInTheDocument();
  });

  it("renders a byName-specific description when mode is byName", () => {
    renderUnionConfig({ ...bySourceConfig, mode: "byName" });
    expect(screen.getByText(/aligned by column name/i)).toBeInTheDocument();
  });
});
