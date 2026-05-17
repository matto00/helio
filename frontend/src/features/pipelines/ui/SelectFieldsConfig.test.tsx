import { fireEvent, render, screen } from "@testing-library/react";
import { SelectFieldsConfig } from "./SelectFieldsConfig";

describe("SelectFieldsConfig", () => {
  // 4.3 — renders checklist from columns prop (from analyze response)
  it("renders a checklist of column names when columns are provided", () => {
    render(
      <SelectFieldsConfig
        columns={["id", "name", "value"]}
        selectedFields={["id"]}
        onToggle={jest.fn()}
      />,
    );

    const idCheckbox = screen.getByRole("checkbox", { name: "id" });
    const nameCheckbox = screen.getByRole("checkbox", { name: "name" });
    const valueCheckbox = screen.getByRole("checkbox", { name: "value" });

    expect(idCheckbox).toBeInTheDocument();
    expect(nameCheckbox).toBeInTheDocument();
    expect(valueCheckbox).toBeInTheDocument();

    expect((idCheckbox as HTMLInputElement).checked).toBe(true);
    expect((nameCheckbox as HTMLInputElement).checked).toBe(false);
    expect((valueCheckbox as HTMLInputElement).checked).toBe(false);
  });

  // 4.3 — renders empty checklist (not prompt) when columns is empty
  it("renders an empty list (not a run-pipeline prompt) when columns is empty", () => {
    render(<SelectFieldsConfig columns={[]} selectedFields={[]} onToggle={jest.fn()} />);

    // No prompt text
    expect(
      screen.queryByText(/Run the pipeline to preview available fields/i),
    ).not.toBeInTheDocument();

    // No checkboxes
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    // An empty list element is still rendered (empty <ul>)
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  // 4.3 — toggling an unchecked checkbox calls onToggle with (field, true)
  it("calls onToggle with field name and true when an unchecked box is clicked", () => {
    const onToggle = jest.fn();
    render(
      <SelectFieldsConfig columns={["name", "dept"]} selectedFields={[]} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "name" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("name", true);
  });

  // 4.3 — toggling a checked checkbox calls onToggle with (field, false)
  it("calls onToggle with field name and false when a checked box is clicked", () => {
    const onToggle = jest.fn();
    render(
      <SelectFieldsConfig
        columns={["name", "dept"]}
        selectedFields={["name"]}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "name" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("name", false);
  });
});
