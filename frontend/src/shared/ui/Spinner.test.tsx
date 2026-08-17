import { render } from "@testing-library/react";

import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders an aria-hidden indicator with the default md size class", () => {
    const { container } = render(<Spinner />);
    const el = container.querySelector(".ui-spinner");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveClass("ui-spinner--md");
  });

  it("applies the requested size modifier", () => {
    const { container } = render(<Spinner size="sm" />);
    expect(container.querySelector(".ui-spinner--sm")).not.toBeNull();
  });

  it("merges a caller-provided className", () => {
    const { container } = render(<Spinner className="extra" />);
    const el = container.querySelector(".ui-spinner");
    expect(el).toHaveClass("extra");
  });
});
