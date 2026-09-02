import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { LookupConfig } from "./LookupConfig";
import type { LookupConfigValue } from "./LookupConfig";
import type { DataSource } from "../../../sources/types/dataSource";
import type { SchemaField } from "../../types/pipelineStep";

const testDataSources: DataSource[] = [
  {
    id: "ds-1",
    name: "Products",
    type: "rest_api",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    inferredSchema: [],
    config: { url: "https://example.com/api" },
  },
  {
    id: "ds-2",
    name: "Codes DB",
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

const sampleSchema: SchemaField[] = [
  { name: "code", type: "string" },
  { name: "qty", type: "number" },
];

const emptyConfig: LookupConfigValue = {
  referenceDataSourceId: "",
  sourceKey: "",
  lookupKey: "",
  columns: [],
};

function renderLookupConfig(config: LookupConfigValue, onChange = jest.fn()) {
  renderWithStore(
    <LookupConfig config={config} analyzeSchema={sampleSchema} onChange={onChange} />,
    { sources: { items: testDataSources, status: "succeeded" } },
  );
  return onChange;
}

function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("LookupConfig", () => {
  // Scenario: Editing the reference-source picker updates the step config
  it("populates the reference-source picker with available sources", () => {
    renderLookupConfig(emptyConfig);
    fireEvent.click(screen.getByRole("combobox", { name: "Reference data source" }));
    expect(screen.getByRole("option", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Codes DB" })).toBeInTheDocument();
  });

  it("selecting a reference source calls onChange with the updated referenceDataSourceId, other fields unchanged", () => {
    const onChange = renderLookupConfig({ ...emptyConfig, sourceKey: "code", lookupKey: "code" });
    chooseSelectOption("Reference data source", "Codes DB");
    expect(onChange).toHaveBeenCalledWith({
      referenceDataSourceId: "ds-2",
      sourceKey: "code",
      lookupKey: "code",
      columns: [],
    });
  });

  it("populates the match-on-field picker from analyzeSchema", () => {
    renderLookupConfig(emptyConfig);
    fireEvent.click(screen.getByRole("combobox", { name: "Match on field" }));
    expect(screen.getByRole("option", { name: "code" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "qty" })).toBeInTheDocument();
  });

  it("selecting sourceKey calls onChange with the updated field", () => {
    const onChange = renderLookupConfig(emptyConfig);
    chooseSelectOption("Match on field", "code");
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, sourceKey: "code" });
  });

  it("editing the reference match field (lookupKey) input calls onChange with the updated value", () => {
    const onChange = renderLookupConfig(emptyConfig);
    fireEvent.change(screen.getByLabelText(/reference match field/i), {
      target: { value: "code" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, lookupKey: "code" });
  });

  // Scenario: Adding a column to bring in updates the step config
  it("clicking Add column appends an empty column row", () => {
    const onChange = renderLookupConfig(emptyConfig);
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, columns: [""] });
  });

  it("renders a text row per persisted column", () => {
    renderLookupConfig({ ...emptyConfig, columns: ["label", "price"] });
    expect(screen.getByLabelText("Column 1")).toHaveValue("label");
    expect(screen.getByLabelText("Column 2")).toHaveValue("price");
  });

  it("editing a column row calls onChange with the updated column name", () => {
    const onChange = renderLookupConfig({ ...emptyConfig, columns: ["label"] });
    fireEvent.change(screen.getByLabelText("Column 1"), { target: { value: "category" } });
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, columns: ["category"] });
  });

  it("removing a column row calls onChange without that row", () => {
    const onChange = renderLookupConfig({ ...emptyConfig, columns: ["label", "price"] });
    fireEvent.click(screen.getByRole("button", { name: /remove column 1/i }));
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, columns: ["price"] });
  });
});
