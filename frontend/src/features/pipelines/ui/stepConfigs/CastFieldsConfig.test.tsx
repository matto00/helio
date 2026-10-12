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

  // HEL-1476: the picker offers exactly the backend's supported targets and shows a stored
  // unsupported one as itself (read-only), not as "keep as is".
  it("RED: offers all nine backend-supported targets plus keep-as-is", () => {
    render(<CastFieldsConfig columns={["amount"]} casts={{}} onChange={jest.fn()} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Target type for amount" }));

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "— keep as is —",
      "string",
      "integer",
      "long",
      "float",
      "double",
      "number",
      "boolean",
      "date",
      "timestamp",
    ]);
  });

  it("RED: shows a stored unsupported target as itself, not as keep as is", () => {
    render(
      <CastFieldsConfig
        columns={["blob", "other"]}
        casts={{ blob: "binary-ref" }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Target type for blob" })).toHaveTextContent(
      "binary-ref (unsupported)",
    );
    expect(screen.getByRole("combobox", { name: "Target type for blob" })).not.toHaveTextContent(
      "keep as is",
    );
  });

  it("offers the unsupported value only on its own row, disabled, and replaces it on selection", () => {
    const onChange = jest.fn();
    render(
      <CastFieldsConfig
        columns={["blob", "other"]}
        casts={{ blob: "binary-ref" }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Target type for other" }));
    expect(screen.queryByRole("option", { name: /unsupported/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Target type for other" }), {
      key: "Escape",
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Target type for blob" }));
    expect(screen.getByRole("option", { name: "binary-ref (unsupported)" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(screen.getByRole("option", { name: "timestamp" }));
    expect(onChange).toHaveBeenCalledWith("blob", "timestamp");
  });

  it("treats a stored empty-string target as keep as is (no unsupported option)", () => {
    render(<CastFieldsConfig columns={["blob"]} casts={{ blob: "" }} onChange={jest.fn()} />);

    expect(screen.getByRole("combobox", { name: "Target type for blob" })).toHaveTextContent(
      "keep as is",
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Target type for blob" }));
    expect(screen.queryByRole("option", { name: /unsupported/ })).not.toBeInTheDocument();
  });
});
