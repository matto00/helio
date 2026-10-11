import { render, screen, within } from "@testing-library/react";
import { WindowConfig } from "./WindowConfig";
import type { WindowConfigValue } from "./WindowConfig";
import type { SchemaField } from "../../types/pipelineStep";

const schema: SchemaField[] = [
  { name: "category", type: "string" },
  { name: "amount", type: "number" },
];
const columns = schema.map((f) => f.name);

const base: WindowConfigValue = {
  partitionBy: [],
  orderBy: [],
  function: "row_number",
  field: "amount",
  outputColumn: "out",
  offset: 1,
  frameSize: 7,
  frameUnit: "rows",
};

function editor(testId: string, config: WindowConfigValue) {
  return (
    <div data-testid={testId}>
      <WindowConfig
        config={config}
        analyzeSchema={schema}
        analyzeColumns={columns}
        onChange={jest.fn()}
      />
    </div>
  );
}

describe("WindowConfig input ids with two editors open", () => {
  it("gives every input a unique id and resolves each label inside its own editor", () => {
    const { container } = render(
      <>
        {editor("a", { ...base, function: "rolling_avg" })}
        {editor("b", { ...base, function: "rolling_sum" })}
        {editor("c", { ...base, function: "lag" })}
        {editor("d", { ...base, function: "lag" })}
      </>,
    );

    const ids = Array.from(container.querySelectorAll("[id]")).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const testId of ["a", "b"]) {
      const scope = within(screen.getByTestId(testId));
      for (const name of ["Frame size", "Output column"]) {
        const input = scope.getByLabelText(name);
        expect(input).toBeInTheDocument();
      }
    }

    for (const testId of ["a", "b", "c", "d"]) {
      const scope = screen.getByTestId(testId);
      for (const label of Array.from(scope.querySelectorAll("label[for]"))) {
        const target = document.getElementById(label.getAttribute("for") as string);
        expect(target).not.toBeNull();
        expect(scope.contains(target)).toBe(true);
      }
    }
  });
});
