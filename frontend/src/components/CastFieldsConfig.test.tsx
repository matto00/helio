import { fireEvent, render, screen } from "@testing-library/react";
import { CastFieldsConfig } from "./CastFieldsConfig";

describe("CastFieldsConfig", () => {
  // renders one row per column from inputSchema
  it("renders one table row per column when columns are provided", () => {
    render(<CastFieldsConfig columns={["id", "name", "value"]} casts={{}} onChange={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: "Target type for id" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Target type for name" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Target type for value" })).toBeInTheDocument();

    // Source field names appear as cells
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("value")).toBeInTheDocument();
  });

  // empty table when no columns
  it("renders an empty table body when columns is empty", () => {
    render(<CastFieldsConfig columns={[]} casts={{}} onChange={jest.fn()} />);

    // Table is still rendered
    expect(screen.getByRole("table")).toBeInTheDocument();

    // No dropdowns
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  // hydrates from persisted config — pre-selects existing cast types
  it("pre-selects existing cast types from the casts prop", () => {
    render(
      <CastFieldsConfig
        columns={["amount", "label"]}
        casts={{ amount: "integer" }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Target type for amount" })).toHaveValue("integer");
    // label not in casts — should show "keep as is" (empty value)
    expect(screen.getByRole("combobox", { name: "Target type for label" })).toHaveValue("");
  });

  // selecting a type calls onChange with correct field + type
  it("calls onChange with field name and target type when a type is selected", () => {
    const onChange = jest.fn();
    render(<CastFieldsConfig columns={["amount", "label"]} casts={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Target type for amount" }), {
      target: { value: "double" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("amount", "double");
  });

  // selecting "keep as is" calls onChange with empty string (removes from casts map)
  it("calls onChange with empty string when — keep as is — is selected", () => {
    const onChange = jest.fn();
    render(
      <CastFieldsConfig columns={["amount"]} casts={{ amount: "integer" }} onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Target type for amount" }), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith("amount", "");
  });
});
