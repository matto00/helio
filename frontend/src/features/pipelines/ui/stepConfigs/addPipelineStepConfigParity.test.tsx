// addPipelineStepConfigParity.test.tsx — HEL-1109 task 4.3 (evaluation-1.md
// CR4). Asserts a card-authored config for each of the three new ops has
// EXACTLY the key set (and, for analyzewithai, the element order)
// `add_pipeline_step` documents for the same intent (`helio-mcp/src/tools/
// write.ts`'s tool description, quoted inline below each test so drift in
// either file is visible at review time without cross-referencing a second
// package):
//
//   convertformat  → {field, from, to, outputField?}
//   analyzewithai  → {inputField, instruction, outputSchema: [{name, type}]}
//   generatetext   → {inputField, instruction, outputField}
//
// UI and agent authoring "agree" (the specs' own wording) means: same keys,
// same value shapes, same declared order for the one array-valued field.
// This is the config-PARITY contract, distinct from (and narrower than) the
// wire-shape assertions `PipelineDetailPage.test.tsx` already makes against
// `createPipelineStepMock`'s call args.

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { ConvertFormatConfig } from "./ConvertFormatConfig";
import { AnalyzeWithAiConfig } from "./AnalyzeWithAiConfig";
import { GenerateTextConfig } from "./GenerateTextConfig";
import type { GenerateTextConfigValue } from "./GenerateTextConfig";
import type { SchemaField } from "../../types/pipelineStep";

// A real StepCard is a CONTROLLED component: each interaction below must be
// reflected back into `config` for the NEXT interaction to build on it, the
// same way `useStepCardState`'s local state does in the real app -- a fixed
// `config` prop across several `fireEvent` calls would only ever exercise
// one field change at a time, never a config with all required fields set.
function ControlledGenerateText({ onChange }: { onChange: (c: GenerateTextConfigValue) => void }) {
  const [config, setConfig] = useState<GenerateTextConfigValue>({
    inputField: "",
    instruction: "",
    outputField: "",
  });
  return (
    <GenerateTextConfig
      config={config}
      analyzeSchema={stringSchemaForWrapper}
      onChange={(next) => {
        setConfig(next);
        onChange(next);
      }}
    />
  );
}
const stringSchemaForWrapper: SchemaField[] = [{ name: "notes", type: "string" }];

function chooseSelectOption(comboboxName: RegExp, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const contentSchema: SchemaField[] = [{ name: "content", type: "string-body" }];

describe("add_pipeline_step config parity (HEL-1109 task 4.3)", () => {
  // write.ts: "convertformat → {field, from, to, outputField?}"
  it("convertformat: card-authored config has exactly {field, from, to} for a full selection", () => {
    const onChange = jest.fn();
    render(
      <ConvertFormatConfig
        config={{ field: "content" }}
        analyzeSchema={contentSchema}
        onChange={onChange}
      />,
    );
    chooseSelectOption(/format conversion/i, "CSV → JSON");

    const emitted = onChange.mock.calls[0][0];
    expect(Object.keys(emitted).sort()).toEqual(["field", "from", "to"]);
    expect(emitted).toEqual({ field: "content", from: "csv", to: "json" });
  });

  it("convertformat: adding an explicit outputField carries exactly {field, from, to, outputField}", () => {
    const onChange = jest.fn();
    render(
      <ConvertFormatConfig
        config={{ field: "content", from: "csv", to: "json" }}
        analyzeSchema={contentSchema}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: /destination field/i });
    fireEvent.change(input, { target: { value: "converted" } });

    const emitted = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(Object.keys(emitted).sort()).toEqual(["field", "from", "outputField", "to"]);
    expect(emitted).toEqual({
      field: "content",
      from: "csv",
      to: "json",
      outputField: "converted",
    });
  });

  // write.ts: "analyzewithai → {inputField, instruction, outputSchema: [{name, type}]}"
  it("analyzewithai: card-authored config has exactly {inputField, instruction, outputSchema}, order preserved", () => {
    const onChange = jest.fn();
    const config = {
      inputField: "content",
      instruction: "Extract sentiment",
      outputSchema: [
        { name: "sentiment", type: "string" as const },
        { name: "confidence", type: "float" as const },
      ],
    };
    render(
      <AnalyzeWithAiConfig config={config} analyzeSchema={contentSchema} onChange={onChange} />,
    );

    // Reorder: move "confidence" above "sentiment" — the emitted array order
    // must reflect the new DISPLAY order, matching the spec's "UI and agent
    // authoring agree, including outputSchema element order" requirement.
    fireEvent.click(screen.getByRole("button", { name: /move output field 2 up/i }));

    const emitted = onChange.mock.calls[0][0];
    expect(Object.keys(emitted).sort()).toEqual(["inputField", "instruction", "outputSchema"]);
    expect(emitted.outputSchema.map((f: { name: string }) => f.name)).toEqual([
      "confidence",
      "sentiment",
    ]);
    expect(
      emitted.outputSchema.every((f: { name: string; type: string }) => "name" in f && "type" in f),
    ).toBe(true);
  });

  // write.ts: "generatetext → {inputField, instruction, outputField}"
  it("generatetext: card-authored config has exactly {inputField, instruction, outputField}", () => {
    const onChange = jest.fn();
    render(<ControlledGenerateText onChange={onChange} />);
    chooseSelectOption(/input field to generate from/i, "notes");
    fireEvent.change(screen.getByRole("textbox", { name: /instruction for the model/i }), {
      target: { value: "Summarize" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /destination field/i }), {
      target: { value: "summary" },
    });

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(Object.keys(lastCall).sort()).toEqual(["inputField", "instruction", "outputField"]);
    expect(lastCall).toEqual({
      inputField: "notes",
      instruction: "Summarize",
      outputField: "summary",
    });
  });
});
