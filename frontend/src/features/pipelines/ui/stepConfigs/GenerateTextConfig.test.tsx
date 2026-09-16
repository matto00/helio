import { fireEvent, render, screen } from "@testing-library/react";
import { GenerateTextConfig } from "./GenerateTextConfig";
import type { GenerateTextConfigValue } from "./GenerateTextConfig";
import type { SchemaField } from "../../types/pipelineStep";

function chooseSelectOption(comboboxName: string | RegExp, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const mixedSchema: SchemaField[] = [
  { name: "notes", type: "string-body" },
  { name: "title", type: "string" },
  { name: "score", type: "number" },
];

const emptyConfig: GenerateTextConfigValue = { inputField: "", instruction: "", outputField: "" };

describe("GenerateTextConfig", () => {
  // Scenario: A freshly added step has an empty destination
  it("starts with an empty outputField", () => {
    render(
      <GenerateTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByRole("textbox", { name: /destination field/i })).toHaveValue("");
  });

  // Scenario: Choosing an input field does not populate the destination
  it("selecting an input field does not populate outputField", () => {
    const onChange = jest.fn();
    render(
      <GenerateTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={onChange} />,
    );
    chooseSelectOption(/input field to generate from/i, "notes");
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, inputField: "notes" });
  });

  // Scenario: An empty instruction is flagged
  it("flags an empty instruction inline", () => {
    render(
      <GenerateTextConfig
        config={{ inputField: "notes", instruction: "", outputField: "summary" }}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(/instruction is required/i)).toBeInTheDocument();
  });

  // Scenario: A whitespace-only destination is flagged
  it("flags a whitespace-only outputField inline", () => {
    render(
      <GenerateTextConfig
        config={{ inputField: "notes", instruction: "Summarize", outputField: "   " }}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(/destination field is required/i)).toBeInTheDocument();
  });

  // Scenario: An existing column chosen as destination is flagged as overwriting
  it("discloses an overwrite when outputField matches an existing input-schema field", () => {
    render(
      <GenerateTextConfig
        config={{ inputField: "notes", instruction: "Summarize", outputField: "title" }}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText(/already exists in the input schema/i)).toBeInTheDocument();
  });

  it("does not disclose an overwrite for a genuinely new destination name", () => {
    render(
      <GenerateTextConfig
        config={{ inputField: "notes", instruction: "Summarize", outputField: "summary" }}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByText(/already exists in the input schema/i)).not.toBeInTheDocument();
  });

  // Scenario: Only string-bearing fields are offerable
  it("input field picker offers only string/string-body fields", () => {
    render(
      <GenerateTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /input field to generate from/i }));
    expect(screen.getByRole("option", { name: "notes" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "title" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "score" })).not.toBeInTheDocument();
  });

  // Cost/quota disclosure
  it("discloses per-row model cost and no-auto-run", () => {
    render(
      <GenerateTextConfig config={emptyConfig} analyzeSchema={mixedSchema} onChange={jest.fn()} />,
    );
    expect(screen.getByText(/calls the ai model once per input row/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
