// HEL-399 — Extraction coverage for `ShapeParamsFields` (rendering) and
// `buildShapeParams` (submit-time typed-value transform), pulled out of
// `ShapePickerModal.tsx` (design.md Decision 6). Behavior-preserving: no new
// widget/transform behavior beyond what `ShapePickerModal.test.tsx` already
// covered pre-extraction.

import { fireEvent, render, screen } from "@testing-library/react";

import { buildShapeParams, ShapeParamsFields } from "./ShapeParamsFields";
import type { ShapeParamDescriptor } from "../types/pipelineShape";

const topNParams: ShapeParamDescriptor[] = [
  { name: "measure", label: "Measure", dataType: "string", required: true, description: "" },
  { name: "n", label: "N", dataType: "integer", required: true, description: "" },
  { name: "tags", label: "Tags", dataType: "string[]", required: false, description: "" },
  {
    name: "measures",
    label: "Measures",
    dataType: "object[]",
    required: false,
    description: "Non-empty array of { fn, field, alias }.",
  },
];

describe("ShapeParamsFields", () => {
  it("renders a text input for a string field", () => {
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={jest.fn()}
        idPrefix="test"
      />,
    );
    expect(screen.getByRole("textbox", { name: "Measure" })).toBeInTheDocument();
  });

  it("renders a number input for an integer field", () => {
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={jest.fn()}
        idPrefix="test"
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "N" });
    expect(input).toHaveAttribute("type", "number");
  });

  it("renders a comma-separated placeholder text input for a string[] field", () => {
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={jest.fn()}
        idPrefix="test"
      />,
    );
    expect(screen.getByRole("textbox", { name: "Tags" })).toHaveAttribute(
      "placeholder",
      "comma-separated values",
    );
  });

  it("renders a textarea with its description as helper text for an object[] field", () => {
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={jest.fn()}
        idPrefix="test"
      />,
    );
    expect(screen.getByRole("textbox", { name: "Measures" }).tagName).toBe("TEXTAREA");
    expect(screen.getByText("Non-empty array of { fn, field, alias }.")).toBeInTheDocument();
  });

  it("marks required fields with a visible marker", () => {
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={jest.fn()}
        idPrefix="test"
      />,
    );
    // "Measure" is required; its label should include the "*" marker text node.
    const label = screen.getByText("Measure").closest("label")!;
    expect(label).toHaveTextContent("Measure *");
  });

  it("prefixes field ids with idPrefix so two instances never collide", () => {
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={jest.fn()}
        idPrefix="shape-instantiate-param"
      />,
    );
    expect(screen.getByRole("textbox", { name: "Measure" })).toHaveAttribute(
      "id",
      "shape-instantiate-param-measure",
    );
  });

  it("calls onChange with the field name and raw string value", () => {
    const onChange = jest.fn();
    render(
      <ShapeParamsFields
        paramsSchema={topNParams}
        values={{}}
        onChange={onChange}
        idPrefix="test"
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Measure" }), {
      target: { value: "revenue" },
    });
    expect(onChange).toHaveBeenCalledWith("measure", "revenue");
  });
});

describe("buildShapeParams", () => {
  it("omits empty optional fields", () => {
    const result = buildShapeParams(topNParams, { measure: "revenue", n: "5" });
    expect(result).toEqual({ params: { measure: "revenue", n: 5 } });
  });

  it("parses an integer field with Number.parseInt", () => {
    const result = buildShapeParams(topNParams, { measure: "revenue", n: "10" });
    expect("params" in result && result.params.n).toBe(10);
  });

  it("comma-splits and trims a string[] field, dropping empty entries", () => {
    const result = buildShapeParams(topNParams, {
      measure: "revenue",
      n: "5",
      tags: "a, b ,, c",
    });
    expect("params" in result && result.params.tags).toEqual(["a", "b", "c"]);
  });

  it("JSON.parses a valid object[] field", () => {
    const result = buildShapeParams(topNParams, {
      measure: "revenue",
      n: "5",
      measures: '[{"fn":"sum","field":"amount","alias":"total"}]',
    });
    expect("params" in result && result.params.measures).toEqual([
      { fn: "sum", field: "amount", alias: "total" },
    ]);
  });

  // Behavior-preserving: identical error message shape to the pre-extraction
  // `ShapePickerModal.handleSubmit` loop.
  it("returns a fieldError for invalid JSON in an object[] field, naming the field label", () => {
    const result = buildShapeParams(topNParams, {
      measure: "revenue",
      n: "5",
      measures: "{not valid json",
    });
    expect("fieldError" in result).toBe(true);
    expect("fieldError" in result && result.fieldError).toMatch(
      /Field "Measures" must be valid JSON/,
    );
  });

  it("defaults an unrecognized dataType to the string widget", () => {
    const schema: ShapeParamDescriptor[] = [
      { name: "mode", label: "Mode", dataType: "mystery", required: false, description: "" },
    ];
    const result = buildShapeParams(schema, { mode: "aggregate" });
    expect(result).toEqual({ params: { mode: "aggregate" } });
  });
});
