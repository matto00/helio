import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { UnionConfig } from "./UnionConfig";
import type { UnionConfigValue } from "./UnionConfig";
import type { DataSource } from "../../../sources/types/dataSource";

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

const emptyConfig: UnionConfigValue = { otherDataSourceId: "", mode: "byPosition" };

function renderUnionConfig(config: UnionConfigValue, onChange = jest.fn()) {
  renderWithStore(<UnionConfig config={config} onChange={onChange} />, {
    sources: { items: testDataSources, status: "succeeded" },
  });
  return onChange;
}

/** Helper: open the other-source Select and pick an option by label. */
function selectOtherSource(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Other data source" }));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("UnionConfig", () => {
  // Scenario: Editing the other-source picker updates the step config
  it("populates the other-source picker with available sources", () => {
    renderUnionConfig(emptyConfig);
    fireEvent.click(screen.getByRole("combobox", { name: "Other data source" }));
    expect(screen.getByRole("option", { name: "Sales API" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ERP DB" })).toBeInTheDocument();
  });

  it("selecting a data source calls onChange with the updated otherDataSourceId, mode unchanged", () => {
    const onChange = renderUnionConfig(emptyConfig);
    selectOtherSource("Sales API");
    expect(onChange).toHaveBeenCalledWith({ otherDataSourceId: "ds-1", mode: "byPosition" });
  });

  // Scenario: Toggling mode updates the step config
  it("toggling the mode control from byPosition to byName calls onChange with mode=byName", () => {
    const onChange = renderUnionConfig({ otherDataSourceId: "ds-1", mode: "byPosition" });
    fireEvent.click(screen.getByRole("button", { name: "BY NAME" }));
    expect(onChange).toHaveBeenCalledWith({ otherDataSourceId: "ds-1", mode: "byName" });
  });

  it("toggling the mode control from byName back to byPosition calls onChange with mode=byPosition", () => {
    const onChange = renderUnionConfig({ otherDataSourceId: "ds-1", mode: "byName" });
    fireEvent.click(screen.getByRole("button", { name: "BY POSITION" }));
    expect(onChange).toHaveBeenCalledWith({ otherDataSourceId: "ds-1", mode: "byPosition" });
  });

  it("marks the active mode button with aria-pressed", () => {
    renderUnionConfig({ otherDataSourceId: "ds-1", mode: "byName" });
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
    renderUnionConfig({ otherDataSourceId: "ds-1", mode: "byName" });
    expect(screen.getByText(/aligned by column name/i)).toBeInTheDocument();
  });
});
