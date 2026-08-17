import { render, screen } from "@testing-library/react";

import { InlineError } from "./InlineError";

describe("InlineError", () => {
  it("renders nothing when error is null/undefined/empty", () => {
    const { container: nullContainer } = render(<InlineError error={null} />);
    expect(nullContainer).toBeEmptyDOMElement();

    const { container: undefinedContainer } = render(<InlineError error={undefined} />);
    expect(undefinedContainer).toBeEmptyDOMElement();

    const { container: emptyContainer } = render(<InlineError error="" />);
    expect(emptyContainer).toBeEmptyDOMElement();
  });

  it("renders the bare text treatment by default, with no alert role", () => {
    render(<InlineError error="Something went wrong." />);
    const el = screen.getByText("Something went wrong.");
    expect(el).toHaveClass("inline-error");
    expect(el).not.toHaveClass("inline-error--banner");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the boxed banner treatment with role=alert when variant='banner'", () => {
    render(<InlineError error="Preview failed." variant="banner" />);
    const el = screen.getByRole("alert");
    expect(el).toHaveTextContent("Preview failed.");
    expect(el).toHaveClass("inline-error", "inline-error--banner");
  });
});
