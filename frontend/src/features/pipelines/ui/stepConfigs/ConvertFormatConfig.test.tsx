import { fireEvent, render, screen } from "@testing-library/react";
import { ConvertFormatConfig } from "./ConvertFormatConfig";
import {
  SUPPORTED_CONVERT_FORMAT_PAIRS,
  type ConvertFormatConfigValue,
} from "../../state/stepNarrowing";
import type { SchemaField } from "../../types/pipelineStep";

function chooseSelectOption(comboboxName: string | RegExp, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const mixedSchema: SchemaField[] = [
  { name: "content", type: "string-body" },
  { name: "filename", type: "string" },
];

const emptyConfig: ConvertFormatConfigValue = { field: "" };

describe("ConvertFormatConfig", () => {
  // Scenario: Only supported conversions are offerable
  it("offers exactly the four supported conversions, no combination outside SupportedPairs", () => {
    render(
      <ConvertFormatConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /format conversion/i }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(SUPPORTED_CONVERT_FORMAT_PAIRS.length);
    expect(options.map((o) => o.textContent)).toEqual([
      "CSV → JSON",
      "JSON → CSV",
      "Text → Markdown",
      "Markdown → Text",
    ]);
  });

  // Scenario: A chosen conversion writes both keys together
  it("selecting a conversion emits from/to as a matched pair", () => {
    const onChange = jest.fn();
    render(
      <ConvertFormatConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={onChange} />,
    );
    chooseSelectOption(/format conversion/i, "CSV → JSON");
    expect(onChange).toHaveBeenCalledWith({ field: "", from: "csv", to: "json" });
  });

  // Scenario: A legacy unsupported pair survives being viewed
  it("preserves an unsupported persisted pair as the current selection without emitting a change", () => {
    const onChange = jest.fn();
    const legacyConfig: ConvertFormatConfigValue = {
      field: "body",
      from: "csv" as never,
      to: "csv" as never,
    };
    render(
      <ConvertFormatConfig config={legacyConfig} analyzeSchema={mixedSchema} onChange={onChange} />,
    );
    expect(screen.getByRole("combobox", { name: /format conversion/i })).toHaveTextContent(
      "csv → csv (unsupported)",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  // Scenario: Non-content fields are not offerable
  it("field picker offers only string-body fields", () => {
    render(
      <ConvertFormatConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /content field to convert/i }));
    expect(screen.getByRole("option", { name: "content" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "filename" })).not.toBeInTheDocument();
  });

  // Scenario: A freshly added step pre-selects no field
  it("starts with no field selected", () => {
    render(
      <ConvertFormatConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: /content field to convert/i })).toHaveTextContent(
      "— select a string-body field —",
    );
  });

  // Scenario: Default destination is disclosed
  it("discloses the in-place overwrite when no distinct outputField is set", () => {
    render(
      <ConvertFormatConfig
        config={{ field: "content", from: "csv", to: "json" }}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(/replaces "content"'s own content in place/i)).toBeInTheDocument();
  });

  // Scenario: A distinct destination is accepted
  it("supplying an outputField persists it and drops the in-place disclosure", () => {
    const onChange = jest.fn();
    render(
      <ConvertFormatConfig
        config={{ field: "content", from: "csv", to: "json" }}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: /destination field/i });
    fireEvent.change(input, { target: { value: "convertedContent" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ outputField: "convertedContent" }),
    );
  });

  // Scenario: A non-AI step card carries no such disclosure (pipeline-ai-step-authoring spec)
  it("carries no AI cost/quota disclosure — convertformat calls no model", () => {
    render(
      <ConvertFormatConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.queryByText(/calls the ai model/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/never runs automatically/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/shared daily/i)).not.toBeInTheDocument();
  });
});
