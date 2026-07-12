import { fireEvent, render, screen } from "@testing-library/react";
import { ExtractHeadingsConfig } from "./ExtractHeadingsConfig";
import type { ExtractHeadingsConfigValue } from "./ExtractHeadingsConfig";
import type { SchemaField } from "../types/pipelineStep";

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const mixedSchema: SchemaField[] = [
  { name: "content", type: "string-body" },
  { name: "filename", type: "string" },
];

const noContentSchema: SchemaField[] = [{ name: "filename", type: "string" }];

const emptyConfig: ExtractHeadingsConfigValue = {
  field: "",
  indexField: "headingIndex",
  levelField: "headingLevel",
};

describe("ExtractHeadingsConfig", () => {
  // Scenario: Field dropdown offers only string-body fields
  it("field dropdown offers only string-body fields", () => {
    render(
      <ExtractHeadingsConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: /content field to extract headings from/i }),
    );
    expect(screen.getByRole("option", { name: "content" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "filename" })).not.toBeInTheDocument();
  });

  // Scenario: No string-body fields renders an empty dropdown
  it("renders an empty dropdown when no string-body fields exist", () => {
    render(
      <ExtractHeadingsConfig
        config={emptyConfig}
        analyzeSchema={noContentSchema}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: /content field to extract headings from/i }),
    );
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  // Scenario: Changing the field updates the step config
  it("selecting a field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    render(
      <ExtractHeadingsConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Content field to extract headings from", "content");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, field: "content" });
  });
});
