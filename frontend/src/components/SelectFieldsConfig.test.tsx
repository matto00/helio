import { fireEvent, render, screen } from "@testing-library/react";
import { SelectFieldsConfig } from "./SelectFieldsConfig";

describe("SelectFieldsConfig", () => {
  // 3.3 — renders checklist from run result
  it("renders a checklist of column names when run result is available", () => {
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

  // 3.3 — renders prompt when no run result
  it("renders prompt when no run result is available (columns is empty)", () => {
    render(<SelectFieldsConfig columns={[]} selectedFields={[]} onToggle={jest.fn()} />);

    expect(screen.getByText(/Run the pipeline to preview available fields/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("calls onToggle with field name and true when an unchecked box is clicked", () => {
    const onToggle = jest.fn();
    render(
      <SelectFieldsConfig columns={["name", "dept"]} selectedFields={[]} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "name" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("name", true);
  });

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
