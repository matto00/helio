import { render } from "@testing-library/react";

import { DividerPanel } from "./DividerPanel";

describe("DividerPanel — horizontal (default)", () => {
  it("renders with horizontal class when orientation is undefined", () => {
    const { container } = render(<DividerPanel />);
    expect(container.querySelector(".divider-panel--horizontal")).toBeInTheDocument();
    expect(container.querySelector(".divider-panel--vertical")).not.toBeInTheDocument();
  });

  it("renders with horizontal class when orientation is null", () => {
    const { container } = render(<DividerPanel orientation={null} />);
    expect(container.querySelector(".divider-panel--horizontal")).toBeInTheDocument();
  });

  it("renders with horizontal class when orientation is horizontal", () => {
    const { container } = render(<DividerPanel orientation="horizontal" />);
    expect(container.querySelector(".divider-panel--horizontal")).toBeInTheDocument();
  });

  it("applies default weight of 1 when weight is null", () => {
    const { container } = render(<DividerPanel weight={null} />);
    const rule = container.querySelector(".divider-panel__rule") as HTMLElement | null;
    expect(rule).toBeInTheDocument();
    expect(rule?.style.height).toBe("1px");
  });

  it("applies default CSS variable color when color is null", () => {
    const { container } = render(<DividerPanel color={null} />);
    const rule = container.querySelector(".divider-panel__rule") as HTMLElement | null;
    expect(rule).toBeInTheDocument();
    expect(rule?.style.backgroundColor).toBe("var(--color-border)");
  });
});

describe("DividerPanel — vertical", () => {
  it("renders with vertical class when orientation is vertical", () => {
    const { container } = render(<DividerPanel orientation="vertical" />);
    expect(container.querySelector(".divider-panel--vertical")).toBeInTheDocument();
    expect(container.querySelector(".divider-panel--horizontal")).not.toBeInTheDocument();
  });

  it("applies weight as width for vertical orientation", () => {
    const { container } = render(<DividerPanel orientation="vertical" weight={4} />);
    const rule = container.querySelector(".divider-panel__rule") as HTMLElement | null;
    expect(rule?.style.width).toBe("4px");
  });

  it("applies height 100% for vertical orientation", () => {
    const { container } = render(<DividerPanel orientation="vertical" />);
    const rule = container.querySelector(".divider-panel__rule") as HTMLElement | null;
    expect(rule?.style.height).toBe("100%");
  });
});

describe("DividerPanel — configured weight and color", () => {
  it("applies provided weight as height for horizontal", () => {
    const { container } = render(<DividerPanel orientation="horizontal" weight={6} />);
    const rule = container.querySelector(".divider-panel__rule") as HTMLElement | null;
    expect(rule?.style.height).toBe("6px");
  });

  it("applies provided color as background color", () => {
    const { container } = render(<DividerPanel color="#ff0000" />);
    const rule = container.querySelector(".divider-panel__rule") as HTMLElement | null;
    expect(rule?.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });
});
