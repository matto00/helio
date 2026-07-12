import { fireEvent, render, screen } from "@testing-library/react";
import { ChunkByTokenCountConfig } from "./ChunkByTokenCountConfig";
import type { ChunkByTokenCountConfigValue } from "./ChunkByTokenCountConfig";
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

const emptyConfig: ChunkByTokenCountConfigValue = {
  field: "",
  targetTokenCount: 500,
  encoding: "o200k_base",
  indexField: "chunkIndex",
  tokenCountField: "tokenCount",
};

describe("ChunkByTokenCountConfig", () => {
  // Scenario: Field dropdown offers only string-body fields
  it("field dropdown offers only string-body fields", () => {
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: /content field to chunk/i }));
    expect(screen.getByRole("option", { name: "content" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "filename" })).not.toBeInTheDocument();
  });

  // Scenario: No string-body fields renders an empty dropdown
  it("renders an empty dropdown when no string-body fields exist", () => {
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={noContentSchema}
        onChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: /content field to chunk/i }));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  // Scenario: Changing the field updates the step config
  it("selecting a field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Content field to chunk", "content");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, field: "content" });
  });

  // Scenario: Target token count input
  it("changing the target token count input patches targetTokenCount", () => {
    const onChange = jest.fn();
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: /target token count/i }), {
      target: { value: "1000" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, targetTokenCount: 1000 });
  });

  it("ignores a non-positive target token count input", () => {
    const onChange = jest.fn();
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: /target token count/i }), {
      target: { value: "0" },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  // Scenario: Encoding dropdown defaults to o200k_base and can be changed
  it("defaults the encoding dropdown to o200k_base", () => {
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: /token encoding/i })).toHaveTextContent(
      "o200k_base (GPT-4o family)",
    );
  });

  it("selecting cl100k_base patches the encoding", () => {
    const onChange = jest.fn();
    render(
      <ChunkByTokenCountConfig
        config={emptyConfig}
        analyzeSchema={mixedSchema}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Token encoding", "cl100k_base (GPT-3.5/4 family)");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, encoding: "cl100k_base" });
  });
});
