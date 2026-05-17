import { fireEvent, render, screen } from "@testing-library/react";
import { RenameFieldsConfig } from "./RenameFieldsConfig";

describe("RenameFieldsConfig", () => {
  // renders one row per column
  it("renders one table row per column when columns are provided", () => {
    render(
      <RenameFieldsConfig columns={["id", "name", "value"]} renames={{}} onChange={jest.fn()} />,
    );

    expect(screen.getByRole("textbox", { name: "New name for id" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New name for name" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New name for value" })).toBeInTheDocument();

    // Source field names appear as cells
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("value")).toBeInTheDocument();
  });

  // empty table when no columns
  it("renders an empty table body when columns is empty", () => {
    render(<RenameFieldsConfig columns={[]} renames={{}} onChange={jest.fn()} />);

    // Table is still rendered
    expect(screen.getByRole("table")).toBeInTheDocument();

    // No text inputs
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // pre-fills inputs from renames prop
  it("pre-fills text inputs from the renames prop", () => {
    render(
      <RenameFieldsConfig
        columns={["name", "dept"]}
        renames={{ name: "full_name" }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "New name for name" })).toHaveValue("full_name");
    expect(screen.getByRole("textbox", { name: "New name for dept" })).toHaveValue("");
  });

  // text input change fires callback
  it("calls onChange with field name and new value when text input changes", () => {
    const onChange = jest.fn();
    render(<RenameFieldsConfig columns={["name", "dept"]} renames={{}} onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox", { name: "New name for name" }), {
      target: { value: "full_name" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("name", "full_name");
  });

  // clearing a text input fires callback with empty string
  it("calls onChange with empty string when a text input is cleared", () => {
    const onChange = jest.fn();
    render(
      <RenameFieldsConfig columns={["name"]} renames={{ name: "full_name" }} onChange={onChange} />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "New name for name" }), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith("name", "");
  });
});
