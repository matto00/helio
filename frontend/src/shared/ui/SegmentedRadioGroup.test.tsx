import { fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";

import { SegmentedRadioGroup } from "./SegmentedRadioGroup";
import { expectTapExpander, findMediaBlock, findRuleBody } from "./tapTargetTestUtils";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
] as const;

describe("SegmentedRadioGroup indicator (HEL-1573)", () => {
  it("hosts the sliding indicator and marks only the selected option for it", () => {
    const { container, rerender } = render(
      <SegmentedRadioGroup label="Pick" options={options} value="b" onChange={jest.fn()} />,
    );
    expect(container.querySelectorAll(".ui-segmented > .motion-indicator")).toHaveLength(1);
    expect(container.querySelector(".motion-indicator")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll("[data-indicator-active]")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Beta" })).toHaveAttribute("data-indicator-active");
    rerender(<SegmentedRadioGroup label="Pick" options={options} value="c" onChange={jest.fn()} />);
    expect(screen.getByRole("radio", { name: "Gamma" })).toHaveAttribute("data-indicator-active");
    expect(screen.getByRole("radio", { name: "Beta" })).not.toHaveAttribute(
      "data-indicator-active",
    );
  });
});

describe("SegmentedRadioGroup", () => {
  it("exposes one checked radio and a roving tabindex", () => {
    render(<SegmentedRadioGroup label="Pick" options={options} value="b" onChange={jest.fn()} />);
    expect(screen.getByRole("radiogroup", { name: "Pick" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Beta" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Beta" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Alpha" })).toHaveAttribute("tabindex", "-1");
  });

  it("click and arrow keys (wrapping) call onChange", () => {
    const onChange = jest.fn();
    render(<SegmentedRadioGroup label="Pick" options={options} value="c" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gamma" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Gamma" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("takes the 44px hit expander on touch layouts (tapTarget.css pattern), painted box stays --control-md", () => {
    const css = fs.readFileSync(path.join(__dirname, "SegmentedRadioGroup.css"), "utf-8");
    expect(findRuleBody(css, ".ui-segmented__option")).toMatch(/height:\s*var\(--control-md\)/);
    expectTapExpander(
      findMediaBlock(css, "max-width: 768px), (pointer: coarse"),
      ".ui-segmented__option",
    );
  });
});
