import { fireEvent, render, screen } from "@testing-library/react";
import { SortConfig } from "./SortConfig";
import type { SortKey } from "./SortConfig";

const COLUMNS = ["name", "age", "dept"];

describe("SortConfig", () => {
  it("renders empty-state message when sortBy is empty", () => {
    render(<SortConfig sortBy={[]} columns={COLUMNS} onChange={jest.fn()} />);
    expect(screen.getByText(/no sort keys/i)).toBeInTheDocument();
  });

  it("renders an 'Add sort key' button", () => {
    render(<SortConfig sortBy={[]} columns={COLUMNS} onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /add sort key/i })).toBeInTheDocument();
  });

  it("renders existing sort keys as list items with field selects and direction buttons", () => {
    const sortBy: SortKey[] = [
      { field: "name", direction: "asc" },
      { field: "age", direction: "desc" },
    ];
    render(<SortConfig sortBy={sortBy} columns={COLUMNS} onChange={jest.fn()} />);
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    expect(selects[0]).toHaveTextContent("name");
    expect(selects[1]).toHaveTextContent("age");
    expect(screen.getByLabelText(/sort key 1 direction/i)).toHaveTextContent(/asc/i);
    expect(screen.getByLabelText(/sort key 2 direction/i)).toHaveTextContent(/desc/i);
  });

  it("calls onChange with new key appended when 'Add sort key' is clicked", () => {
    const onChange = jest.fn();
    render(<SortConfig sortBy={[]} columns={COLUMNS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add sort key/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as { sortBy: SortKey[] };
    expect(parsed.sortBy).toHaveLength(1);
    expect(parsed.sortBy[0].field).toBe("name");
    expect(parsed.sortBy[0].direction).toBe("asc");
  });

  it("calls onChange with key removed when remove button is clicked", () => {
    const onChange = jest.fn();
    const sortBy: SortKey[] = [
      { field: "name", direction: "asc" },
      { field: "age", direction: "desc" },
    ];
    render(<SortConfig sortBy={sortBy} columns={COLUMNS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/remove sort key 1/i));
    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as { sortBy: SortKey[] };
    expect(parsed.sortBy).toHaveLength(1);
    expect(parsed.sortBy[0].field).toBe("age");
  });

  it("calls onChange with toggled direction when direction button is clicked", () => {
    const onChange = jest.fn();
    const sortBy: SortKey[] = [{ field: "name", direction: "asc" }];
    render(<SortConfig sortBy={sortBy} columns={COLUMNS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/sort key 1 direction/i));
    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as { sortBy: SortKey[] };
    expect(parsed.sortBy[0].direction).toBe("desc");
  });

  it("calls onChange with toggled direction from desc to asc", () => {
    const onChange = jest.fn();
    const sortBy: SortKey[] = [{ field: "age", direction: "desc" }];
    render(<SortConfig sortBy={sortBy} columns={COLUMNS} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/sort key 1 direction/i));
    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as { sortBy: SortKey[] };
    expect(parsed.sortBy[0].direction).toBe("asc");
  });

  it("calls onChange with updated field when field selector changes", () => {
    const onChange = jest.fn();
    const sortBy: SortKey[] = [{ field: "name", direction: "asc" }];
    render(<SortConfig sortBy={sortBy} columns={COLUMNS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "dept" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onChange.mock.calls[0][0] as string) as { sortBy: SortKey[] };
    expect(parsed.sortBy[0].field).toBe("dept");
  });

  it("disables 'Add sort key' button when no columns are available", () => {
    render(<SortConfig sortBy={[]} columns={[]} onChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /add sort key/i })).toBeDisabled();
  });
});
