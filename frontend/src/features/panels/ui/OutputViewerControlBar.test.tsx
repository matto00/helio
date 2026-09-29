// HEL-1190 design.md D1 (task 4.1) — the viewer control bar: renders one control per non-orphaned
// `OutputControlSpec`, dispatching onChange/onClear back to the caller.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OutputViewerControlBar } from "./OutputViewerControlBar";
import type { OutputControlSpec } from "../types/panel";

describe("OutputViewerControlBar (design.md D1)", () => {
  it("never renders an orphaned control, even alongside non-orphaned ones", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "text", column: "name", label: "Name" },
      { id: "c2", kind: "dropdown", column: "region", label: "Region", orphaned: true },
    ];
    render(
      <OutputViewerControlBar
        controls={controls}
        values={{}}
        onChange={jest.fn()}
        onClear={jest.fn()}
        fetchDistinctValues={jest.fn().mockResolvedValue([])}
      />,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByText("Region")).not.toBeInTheDocument();
  });

  it("renders nothing at all when every control is orphaned", () => {
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "text", column: "name", label: "Name", orphaned: true },
    ];
    const { container } = render(
      <OutputViewerControlBar
        controls={controls}
        values={{}}
        onChange={jest.fn()}
        onClear={jest.fn()}
        fetchDistinctValues={jest.fn().mockResolvedValue([])}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("a text control reports a keystroke via onChange", () => {
    const onChange = jest.fn();
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "text", column: "name", label: "Name" },
    ];
    render(
      <OutputViewerControlBar
        controls={controls}
        values={{}}
        onChange={onChange}
        onClear={jest.fn()}
        fetchDistinctValues={jest.fn().mockResolvedValue([])}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "acme" } });
    expect(onChange).toHaveBeenCalledWith("c1", "acme");
  });

  it("a text control cleared back to empty reports onClear, not onChange with an empty string", () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "text", column: "name", label: "Name" },
    ];
    render(
      <OutputViewerControlBar
        controls={controls}
        values={{ c1: "acme" }}
        onChange={onChange}
        onClear={onClear}
        fetchDistinctValues={jest.fn().mockResolvedValue([])}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect(onClear).toHaveBeenCalledWith("c1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a dropdown control fetches its options via the caller-supplied fetchDistinctValues, scoped to its own column", async () => {
    const fetchDistinctValues = jest.fn().mockResolvedValue([
      { value: "east", count: 3 },
      { value: "west", count: 2 },
    ]);
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "dropdown", column: "region", label: "Region" },
    ];
    render(
      <OutputViewerControlBar
        controls={controls}
        values={{}}
        onChange={jest.fn()}
        onClear={jest.fn()}
        fetchDistinctValues={fetchDistinctValues}
      />,
    );
    await waitFor(() => expect(fetchDistinctValues).toHaveBeenCalledWith("region"));
  });

  it("a numeric-range control's min/max inputs report a combined encoded value", () => {
    const onChange = jest.fn();
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "numeric-range", column: "amount", label: "Amount" },
    ];
    render(
      <OutputViewerControlBar
        controls={controls}
        values={{}}
        onChange={onChange}
        onClear={jest.fn()}
        fetchDistinctValues={jest.fn().mockResolvedValue([])}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount minimum"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith("c1", "10_");
  });

  it("a date-range control's preset select reports the preset token directly", () => {
    const onChange = jest.fn();
    const controls: OutputControlSpec[] = [
      { id: "c1", kind: "date-range", column: "created_at", label: "Created" },
    ];
    render(
      <OutputViewerControlBar
        controls={controls}
        values={{}}
        onChange={onChange}
        onClear={jest.fn()}
        fetchDistinctValues={jest.fn().mockResolvedValue([])}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Created" }));
    fireEvent.click(screen.getByRole("option", { name: "Last 7 days" }));
    expect(onChange).toHaveBeenCalledWith("c1", "last7d");
  });
});
