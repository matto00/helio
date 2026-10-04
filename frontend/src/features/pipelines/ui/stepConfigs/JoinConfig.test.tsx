import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { JoinConfig } from "./JoinConfig";
import type { JoinConfigValue } from "./JoinConfig";
import type { DataSource } from "../../../sources/types/dataSource";
import type { SchemaField } from "../../types/pipelineStep";
import { OP_TYPES } from "../../state/stepNarrowing";
import type { Step } from "../../types/step";

const testDataSources: DataSource[] = [
  {
    id: "ds-1",
    name: "Customers",
    type: "rest_api",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    inferredSchema: [],
    config: { url: "https://example.com/api" },
  },
];

const sampleSchema: SchemaField[] = [
  { name: "id", type: "string" },
  { name: "qty", type: "number" },
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

const otherSteps: Step[] = [makeStep("current", "Join step"), makeStep("s-up", "Filter rows")];

const emptyConfig: JoinConfigValue = {
  secondary: { kind: "source", dataSourceId: "" },
  joinKey: "",
  joinType: "inner",
};

function renderJoinConfig(config: JoinConfigValue, onChange = jest.fn()) {
  renderWithStore(
    <JoinConfig
      config={config}
      analyzeSchema={sampleSchema}
      allSteps={otherSteps}
      currentStepId="current"
      onChange={onChange}
    />,
    { sources: { items: testDataSources, status: "succeeded" } },
  );
  return onChange;
}

function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("JoinConfig", () => {
  it("does not call onChange on mount", () => {
    const onChange = renderJoinConfig(emptyConfig);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers data sources and other lane nodes as the right input", () => {
    renderJoinConfig(emptyConfig);
    fireEvent.click(screen.getByRole("combobox", { name: "Right source" }));
    expect(screen.getByRole("option", { name: "Data source: Customers" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lane node: Filter rows" })).toBeInTheDocument();
  });

  it("selecting a data source emits a source-kind secondary, other fields unchanged", () => {
    const onChange = renderJoinConfig({ ...emptyConfig, joinKey: "id" });
    chooseSelectOption("Right source", "Data source: Customers");
    expect(onChange).toHaveBeenCalledWith({
      secondary: { kind: "source", dataSourceId: "ds-1" },
      joinKey: "id",
      joinType: "inner",
    });
  });

  it("selecting a lane node emits a lane-kind secondary", () => {
    const onChange = renderJoinConfig(emptyConfig);
    chooseSelectOption("Right source", "Lane node: Filter rows");
    expect(onChange).toHaveBeenCalledWith({
      ...emptyConfig,
      secondary: { kind: "lane", stepId: "s-up" },
    });
  });

  it("a stored lane reference is shown, not replaced", () => {
    renderJoinConfig({ ...emptyConfig, secondary: { kind: "lane", stepId: "s-up" } });
    expect(screen.getByRole("combobox", { name: "Right source" })).toHaveTextContent(
      "Lane node: Filter rows",
    );
  });

  it("selecting a join key from analyzeSchema emits it", () => {
    const onChange = renderJoinConfig(emptyConfig);
    chooseSelectOption("Join key", "id");
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, joinKey: "id" });
  });

  it("offers a stored key missing from the input schema, labelled, and keeps it selected", () => {
    renderJoinConfig({ ...emptyConfig, joinKey: "ghost" });
    expect(screen.getByRole("combobox", { name: "Join key" })).toHaveTextContent(
      "ghost (not in input)",
    );
  });

  it("offers exactly INNER and LEFT, with the stored one pressed and described", () => {
    renderJoinConfig({ ...emptyConfig, joinType: "left" });
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "LEFT", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "INNER", pressed: false })).toBeInTheDocument();
    expect(screen.getByText(/Every input row is kept/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clicking a join type button emits it", () => {
    const onChange = renderJoinConfig(emptyConfig);
    fireEvent.click(screen.getByRole("button", { name: "LEFT" }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, joinType: "left" });
  });

  it("matches join type case-insensitively, as the backend does", () => {
    renderJoinConfig({ ...emptyConfig, joinType: "LEFT" });
    expect(screen.getByRole("button", { name: "LEFT", pressed: true })).toBeInTheDocument();
  });

  it("flags an unsupported stored joinType, presses neither button, and does not coerce it", () => {
    const onChange = renderJoinConfig({ ...emptyConfig, joinType: "outer" });
    expect(screen.queryByRole("button", { pressed: true })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      'Join type "outer" is not supported and will fail at run time',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("notes the right_<name> collision prefix", () => {
    renderJoinConfig(emptyConfig);
    expect(screen.getByText("right_<name>")).toBeInTheDocument();
  });
});
