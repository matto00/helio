import { isTypingTarget, matchesCombo, shortcuts } from "./shortcuts";

describe("shortcuts", () => {
  it("declares the command palette (Cmd/Ctrl+K) and quick-launcher (Cmd/Ctrl+J) bindings", () => {
    const ids = shortcuts.map((s) => s.id);
    expect(ids).toContain("command-palette");
    expect(ids).toContain("quick-launcher");

    const palette = shortcuts.find((s) => s.id === "command-palette")!;
    expect(palette.combo).toEqual({ key: "k", meta: true });

    const launcher = shortcuts.find((s) => s.id === "quick-launcher")!;
    expect(launcher.combo).toEqual({ key: "j", meta: true });
  });
});

describe("matchesCombo", () => {
  const combo = { key: "k", meta: true };

  it("matches metaKey (macOS Cmd)", () => {
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    expect(matchesCombo(event, combo)).toBe(true);
  });

  it("matches ctrlKey (other platforms)", () => {
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true });
    expect(matchesCombo(event, combo)).toBe(true);
  });

  it("is case-insensitive on the key", () => {
    const event = new KeyboardEvent("keydown", { key: "K", ctrlKey: true });
    expect(matchesCombo(event, combo)).toBe(true);
  });

  it("does not match without the modifier", () => {
    const event = new KeyboardEvent("keydown", { key: "k" });
    expect(matchesCombo(event, combo)).toBe(false);
  });

  it("does not match a different key", () => {
    const event = new KeyboardEvent("keydown", { key: "j", ctrlKey: true });
    expect(matchesCombo(event, combo)).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("reports true for an input", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
  });

  it("reports true for a textarea", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
  });

  it("reports true for a select", () => {
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("reports true for a contenteditable element", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    expect(isTypingTarget(div)).toBe(true);
    document.body.removeChild(div);
  });

  it("reports false for the document body", () => {
    expect(isTypingTarget(document.body)).toBe(false);
  });

  it("reports false for a button", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
  });

  it("reports false for a link", () => {
    expect(isTypingTarget(document.createElement("a"))).toBe(false);
  });

  it("reports false for null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
