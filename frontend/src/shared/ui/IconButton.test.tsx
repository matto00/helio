import { fireEvent, render, screen } from "@testing-library/react";

import { IconButton } from "./IconButton";

// Note: aria-label is required at the prop-type level (spec.md "Omitting
// aria-label fails to compile"), so there's no runtime test for that
// scenario — a missing aria-label is a TypeScript compile error, verified by
// `tsc`/the build, not by a Jest assertion.

describe("IconButton", () => {
  it("renders the aria-label on the underlying button", () => {
    render(<IconButton icon={<span>x</span>} aria-label="Close" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("defaults title to aria-label when no title is provided", () => {
    render(<IconButton icon={<span>x</span>} aria-label="Undo layout change" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Undo layout change" })).toHaveAttribute(
      "title",
      "Undo layout change",
    );
  });

  it("uses an explicit title instead of the aria-label default", () => {
    render(
      <IconButton
        icon={<span>x</span>}
        aria-label="Undo layout change"
        title="Undo (Ctrl+Z)"
        onClick={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Undo layout change" })).toHaveAttribute(
      "title",
      "Undo (Ctrl+Z)",
    );
  });

  it("fires onClick when clicked", () => {
    const onClick = jest.fn();
    render(<IconButton icon={<span>x</span>} aria-label="Close" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the default ghost variant at sm size", () => {
    render(<IconButton icon={<span>x</span>} aria-label="Close" onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: "Close" });
    expect(btn).toHaveClass("ui-icon-btn--ghost");
    expect(btn).toHaveClass("ui-icon-btn--sm");
  });

  it("renders the secondary variant at md size when specified", () => {
    render(
      <IconButton
        icon={<span>x</span>}
        aria-label="Remove"
        variant="secondary"
        size="md"
        onClick={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: "Remove" });
    expect(btn).toHaveClass("ui-icon-btn--secondary");
    expect(btn).toHaveClass("ui-icon-btn--md");
  });

  it("renders the danger variant at xs size when specified", () => {
    render(
      <IconButton
        icon={<span>x</span>}
        aria-label="Remove"
        variant="danger"
        size="xs"
        onClick={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: "Remove" });
    expect(btn).toHaveClass("ui-icon-btn--danger");
    expect(btn).toHaveClass("ui-icon-btn--xs");
  });

  it("is disabled when disabled=true", () => {
    render(<IconButton icon={<span>x</span>} aria-label="Close" onClick={() => {}} disabled />);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("defaults type to button", () => {
    render(<IconButton icon={<span>x</span>} aria-label="Close" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("type", "button");
  });

  it("merges a caller-supplied className", () => {
    render(
      <IconButton
        icon={<span>x</span>}
        aria-label="Close"
        onClick={() => {}}
        className="custom-class"
      />,
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("custom-class");
  });
});
