import { fireEvent, render, screen } from "@testing-library/react";

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

  it("text variant ignores kind/onRetry — renders exactly as before (HEL-539)", () => {
    const onRetry = jest.fn();
    render(<InlineError error="Bad input." kind="error" onRetry={onRetry} />);
    const el = screen.getByText("Bad input.");
    expect(el.tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it('kind="error" with onRetry renders an icon-paired message and a Retry action', () => {
    const onRetry = jest.fn();
    render(<InlineError error="Load failed." variant="banner" kind="error" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Load failed.");
    expect(alert.querySelector("svg")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('kind="forbidden" never renders a retry action, even when onRetry is passed', () => {
    const onRetry = jest.fn();
    render(
      <InlineError
        error="You don't have access to this resource."
        variant="banner"
        kind="forbidden"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it('kind="not-found" never renders a retry action, even when onRetry is passed', () => {
    const onRetry = jest.fn();
    render(
      <InlineError
        error="We couldn't find this resource."
        variant="banner"
        kind="not-found"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("retrying disables the labeled Retry button and swaps its label", () => {
    const onRetry = jest.fn();
    render(
      <InlineError error="Load failed." variant="banner" kind="error" onRetry={onRetry} retrying />,
    );
    const retryBtn = screen.getByRole("button", { name: "Retrying…" });
    expect(retryBtn).toBeDisabled();
  });

  it('retryVariant="icon-only" renders an accessible icon-only control that swaps its aria-label while retrying', () => {
    const onRetry = jest.fn();
    const { rerender } = render(
      <InlineError
        error="Load failed."
        variant="banner"
        kind="error"
        onRetry={onRetry}
        retryVariant="icon-only"
      />,
    );
    const iconBtn = screen.getByRole("button", { name: "Retry" });
    expect(iconBtn).not.toBeDisabled();
    fireEvent.click(iconBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(
      <InlineError
        error="Load failed."
        variant="banner"
        kind="error"
        onRetry={onRetry}
        retryVariant="icon-only"
        retrying
      />,
    );
    const retryingBtn = screen.getByRole("button", { name: "Retrying…" });
    expect(retryingBtn).toBeDisabled();
  });

  it('announced={false} omits role="alert" on the banner', () => {
    render(<InlineError error="Load failed." variant="banner" announced={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Load failed.")).toBeInTheDocument();
  });

  it("default announced banner carries role=alert", () => {
    render(<InlineError error="Load failed." variant="banner" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
