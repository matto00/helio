import { render } from "@testing-library/react";

import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders an aria-hidden placeholder with the default line variant class", () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector(".ui-skeleton");
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveClass("ui-skeleton--line");
  });

  it("applies the block variant modifier class", () => {
    const { container } = render(<Skeleton variant="block" />);
    const el = container.querySelector(".ui-skeleton");
    expect(el).toHaveClass("ui-skeleton--block");
  });

  it("applies the circle variant modifier class", () => {
    const { container } = render(<Skeleton variant="circle" />);
    const el = container.querySelector(".ui-skeleton");
    expect(el).toHaveClass("ui-skeleton--circle");
  });

  it("merges a caller-provided className", () => {
    const { container } = render(<Skeleton className="extra" />);
    const el = container.querySelector(".ui-skeleton");
    expect(el).toHaveClass("extra");
  });

  it("applies an explicit width/height override as inline style", () => {
    const { container } = render(<Skeleton width={60} height="1.2em" />);
    const el = container.querySelector(".ui-skeleton") as HTMLElement;
    expect(el.style.width).toBe("60px");
    expect(el.style.height).toBe("1.2em");
  });

  it("is aria-hidden for every variant", () => {
    const variants = ["block", "line", "circle"] as const;
    for (const variant of variants) {
      const { container } = render(<Skeleton variant={variant} />);
      const el = container.querySelector(".ui-skeleton");
      expect(el).toHaveAttribute("aria-hidden", "true");
    }
  });
});
