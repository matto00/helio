import { fireEvent, render, screen } from "@testing-library/react";

import { ToolCallIndicator } from "./ToolCallIndicator";
import type { ClaudeToolResultBlockDto, ClaudeToolUseBlockDto } from "../types";

const findToolUse: ClaudeToolUseBlockDto = {
  blockType: "tool_use",
  id: "tu-1",
  name: "find",
  input: { query: "revenue" },
};

describe("ToolCallIndicator", () => {
  it("names the tool and shows a compact view of its input", () => {
    render(<ToolCallIndicator toolUse={findToolUse} result={null} />);

    expect(screen.getByText('Searching: find(query: "revenue")')).toBeInTheDocument();
  });

  // tasks.md 5.3 — a large tool_result JSON renders as a collapsed summary, not raw JSON inline.
  it("renders a large tool_result JSON as a collapsed summary, not raw JSON inline", () => {
    const bigResult: ClaudeToolResultBlockDto = {
      blockType: "tool_result",
      toolUseId: "tu-1",
      content: JSON.stringify([{ id: "1" }, { id: "2" }, { id: "3" }]),
      isError: false,
    };

    render(<ToolCallIndicator toolUse={findToolUse} result={bigResult} />);

    expect(screen.getByText("Found 3 results")).toBeInTheDocument();
    expect(screen.queryByText(bigResult.content)).not.toBeInTheDocument();

    // Expanding the disclosure reveals the raw content -- but only on demand.
    fireEvent.click(screen.getByRole("button", { name: /Found 3 results/ }));
    expect(screen.getByText(bigResult.content)).toBeInTheDocument();
  });

  // tasks.md 5.4 — an isError: true tool result renders with error-intent styling.
  it("renders an isError: true tool result with error-intent styling", () => {
    const errorResult: ClaudeToolResultBlockDto = {
      blockType: "tool_result",
      toolUseId: "tu-1",
      content: "Resource not found",
      isError: true,
    };

    const { container } = render(<ToolCallIndicator toolUse={findToolUse} result={errorResult} />);

    expect(container.querySelector(".tool-call-indicator--error")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows no disclosure toggle for a cut-short (unpaired) tool_use", () => {
    render(<ToolCallIndicator toolUse={findToolUse} result={null} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // HEL-667 design.md D5/tasks.md 6.1/7.5 — a tool_use with no paired tool_result renders a
  // distinct "cut short" treatment (the hop-cap-exhausted case), never the same appearance as a
  // normal or errored result.
  it("renders a distinct cut-short treatment for a tool_use with no paired tool_result", () => {
    const { container } = render(<ToolCallIndicator toolUse={findToolUse} result={null} />);

    expect(container.querySelector(".tool-call-indicator--cut-short")).toBeInTheDocument();
    expect(container.querySelector(".tool-call-indicator--error")).not.toBeInTheDocument();
    expect(screen.getByText(/cut short/i)).toBeInTheDocument();
  });

  it("does NOT render the cut-short treatment for a normally-resolved tool_use", () => {
    const resolvedResult: ClaudeToolResultBlockDto = {
      blockType: "tool_result",
      toolUseId: "tu-1",
      content: "[]",
      isError: false,
    };
    const { container } = render(
      <ToolCallIndicator toolUse={findToolUse} result={resolvedResult} />,
    );

    expect(container.querySelector(".tool-call-indicator--cut-short")).not.toBeInTheDocument();
    expect(screen.queryByText(/cut short/i)).not.toBeInTheDocument();
  });
});
