import { fireEvent, render, screen } from "@testing-library/react";
import { DateBucketConfig } from "./DateBucketConfig";
import type { DateBucketConfigValue } from "./DateBucketConfig";

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const columns = ["ts", "name", "amount"];

const emptyConfig: DateBucketConfigValue = {
  field: "",
  granularity: "day",
  outputColumn: "",
};

describe("DateBucketConfig", () => {
  // Scenario: field dropdown offers every column, unfiltered (mirrors cast)
  it("field dropdown offers every analyzeColumns entry", () => {
    render(<DateBucketConfig config={emptyConfig} analyzeColumns={columns} onChange={jest.fn()} />);

    fireEvent.click(screen.getByRole("combobox", { name: /source field to bucket/i }));
    expect(screen.getByRole("option", { name: "ts" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "name" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "amount" })).toBeInTheDocument();
  });

  // Scenario: selecting a field calls onChange with the field patched in
  it("selecting a field calls onChange with the field patched in", () => {
    const onChange = jest.fn();
    render(<DateBucketConfig config={emptyConfig} analyzeColumns={columns} onChange={onChange} />);

    chooseSelectOption("Source field to bucket", "ts");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, field: "ts" });
  });

  // Scenario: granularity dropdown offers exactly the five supported values
  it("granularity dropdown offers exactly day/week/month/quarter/year", () => {
    render(<DateBucketConfig config={emptyConfig} analyzeColumns={columns} onChange={jest.fn()} />);

    fireEvent.click(screen.getByRole("combobox", { name: /bucket granularity/i }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["day", "week", "month", "quarter", "year"]);
  });

  // Scenario: editing granularity updates the step config
  it("selecting a granularity calls onChange with the granularity patched in", () => {
    const onChange = jest.fn();
    render(
      <DateBucketConfig
        config={{ ...emptyConfig, field: "ts" }}
        analyzeColumns={columns}
        onChange={onChange}
      />,
    );

    chooseSelectOption("Bucket granularity", "month");

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, field: "ts", granularity: "month" });
  });

  // Scenario: leaving outputColumn blank keeps it as an empty string in local
  // editor state (useStepCardState is responsible for omitting it from the
  // persisted PATCH — see DateBucketConfig.tsx's docblock).
  it("changing the output column input patches outputColumn", () => {
    const onChange = jest.fn();
    render(<DateBucketConfig config={emptyConfig} analyzeColumns={columns} onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: /output column/i }), {
      target: { value: "ts_month" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, outputColumn: "ts_month" });
  });

  // HEL sweep F-147: DateBucket's required "Source field" previously had no
  // validation, letting an unset (or upstream-corrupted, empty-named)
  // schema field silently propagate downstream as blank chips/messages.
  it("shows a required-field error when the source field is empty", () => {
    render(<DateBucketConfig config={emptyConfig} analyzeColumns={columns} onChange={jest.fn()} />);

    expect(screen.getByText(/source field is required/i)).toBeInTheDocument();
  });

  it("does not show a required-field error once a source field is selected", () => {
    render(
      <DateBucketConfig
        config={{ ...emptyConfig, field: "ts" }}
        analyzeColumns={columns}
        onChange={jest.fn()}
      />,
    );

    expect(screen.queryByText(/source field is required/i)).not.toBeInTheDocument();
  });

  it("clearing the output column input patches outputColumn back to empty string", () => {
    const onChange = jest.fn();
    render(
      <DateBucketConfig
        config={{ ...emptyConfig, outputColumn: "ts_month" }}
        analyzeColumns={columns}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /output column/i }), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith({ ...emptyConfig, outputColumn: "" });
  });
});
