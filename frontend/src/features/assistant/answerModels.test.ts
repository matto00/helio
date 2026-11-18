import { answerGroupModels } from "./answerModels";
import type { ClaudeToolMessageDto } from "./types";

const visible = (block: { blockType: string; text?: string }) =>
  block.blockType === "text" && (block.text ?? "").trim() !== "";

const user = (text: string): ClaudeToolMessageDto => ({
  role: "user",
  content: [{ blockType: "text", text }],
});
const assistantText = (text: string, model?: string): ClaudeToolMessageDto => ({
  role: "assistant",
  content: [{ blockType: "text", text }],
  model,
});
const toolUse = (model: string): ClaudeToolMessageDto => ({
  role: "assistant",
  content: [{ blockType: "tool_use", id: "t1", name: "find", input: {} }],
  model,
});
const toolResult: ClaudeToolMessageDto = {
  role: "user",
  content: [{ blockType: "tool_result", toolUseId: "t1", content: "[]", isError: false }],
};

describe("answerGroupModels", () => {
  it("labels each answer group once, under its last visible text block", () => {
    const transcript = [
      user("q1"),
      toolUse("claude-haiku-5-5"),
      toolResult,
      assistantText("a1", "claude-haiku-5-5"),
      user("q2"),
      assistantText("a2", "claude-opus-5-5"),
    ];
    expect([...answerGroupModels(transcript, visible)]).toEqual([
      ["3-0", "claude-haiku-5-5"],
      ["5-0", "claude-opus-5-5"],
    ]);
  });

  it("labels only the closing text block when the assistant also spoke before its tool call", () => {
    const transcript = [
      user("q"),
      assistantText("let me look", "claude-haiku-5-5"),
      toolUse("claude-haiku-5-5"),
      toolResult,
      assistantText("found it", "claude-haiku-5-5"),
    ];
    expect([...answerGroupModels(transcript, visible).keys()]).toEqual(["4-0"]);
  });

  it("does not split a group at a tool_result-only user turn", () => {
    const transcript = [
      user("q"),
      toolUse("claude-sonnet-5-5"),
      toolResult,
      assistantText("a", "claude-sonnet-5-5"),
    ];
    expect(answerGroupModels(transcript, visible).size).toBe(1);
  });

  it("gives a group with no recorded model (a turn saved before the picker) no label", () => {
    expect(answerGroupModels([user("q"), assistantText("a")], visible).size).toBe(0);
  });

  it("labels nothing for a group with no visible assistant text", () => {
    expect(
      answerGroupModels([user("q"), assistantText("   ", "claude-haiku-5-5")], visible).size,
    ).toBe(0);
  });
});
