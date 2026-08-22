import { fireEvent, render, screen } from "@testing-library/react";
import { CastFieldsConfig } from "./CastFieldsConfig";

/** Open the custom Select identified by aria-label and click the option with
 * the given label. Replaces fireEvent.change for our app-styled Select. */
function chooseSelectOption(comboboxName: string, optionLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxName }));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("CastFieldsConfig", () => {
  it("renders one combobox per column when columns are provided", () => {
    render(<CastFieldsConfig columns={["id", "name", "value"]} casts={{}} onChange={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: "Target type for id" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Target type for name" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Target type for value" })).toBeInTheDocument();

    // Source field names appear as cells
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("value")).toBeInTheDocument();
  });

  it("renders an empty table body when columns is empty", () => {
    render(<CastFieldsConfig columns={[]} casts={{}} onChange={jest.fn()} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("pre-selects existing cast types from the casts prop", () => {
    render(
      <CastFieldsConfig
        columns={["amount", "label"]}
        casts={{ amount: "integer" }}
        onChange={jest.fn()}
      />,
    );

    // The trigger button's text content reflects the selected option's label.
    expect(screen.getByRole("combobox", { name: "Target type for amount" })).toHaveTextContent(
      "integer",
    );
    expect(screen.getByRole("combobox", { name: "Target type for label" })).toHaveTextContent(
      "keep as is",
    );
  });

  it("calls onChange with field name and target type when a type is selected", () => {
    const onChange = jest.fn();
    render(<CastFieldsConfig columns={["amount", "label"]} casts={{}} onChange={onChange} />);

    chooseSelectOption("Target type for amount", "double");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("amount", "double");
  });

  it("calls onChange with empty string when — keep as is — is selected", () => {
    const onChange = jest.fn();
    render(
      <CastFieldsConfig columns={["amount"]} casts={{ amount: "integer" }} onChange={onChange} />,
    );

    chooseSelectOption("Target type for amount", "— keep as is —");

    expect(onChange).toHaveBeenCalledWith("amount", "");
  });
});
