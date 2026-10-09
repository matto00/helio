import { render, screen } from "@testing-library/react";

import { StepSchemaDiffChips } from "./StepSchemaDiffChips";

describe("StepSchemaDiffChips", () => {
  afterEach(() => jest.restoreAllMocks());

  it("renders two added fields with an empty name as two chips without a duplicate-key warning", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <StepSchemaDiffChips
        input={[]}
        output={[
          { name: "", type: "float" },
          { name: "", type: "float" },
        ]}
      />,
    );
    expect(
      container.querySelectorAll(".pipeline-detail-page__step-card-diff-chip--added"),
    ).toHaveLength(2);
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && /same key|unique "key"/i.test(a)),
    );
    expect(keyWarnings).toEqual([]);
  });

  it("still renders a chip for each diff category", () => {
    render(
      <StepSchemaDiffChips
        input={[
          { name: "gone", type: "string" },
          { name: "n", type: "integer" },
        ]}
        output={[
          { name: "new", type: "string" },
          { name: "n", type: "float" },
        ]}
      />,
    );
    expect(screen.getByText("+ new")).toBeInTheDocument();
    expect(screen.getByText("− gone")).toBeInTheDocument();
    expect(screen.getByText(/~ n: integer→float/)).toBeInTheDocument();
  });
});
