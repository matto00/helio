import { formatCombo, isOverlayOpen, isTypingTarget, matchesCombo, shortcuts } from "./shortcuts";

describe("shortcuts", () => {
  it("declares the command palette (Cmd/Ctrl+K) and quick-launcher (Cmd/Ctrl+J) bindings", () => {
    // HEL-510: `meta` -> `mod` rename. This is a REQUIRED rename (tasks.md 1.1 note), not the
    // "fixture edited to pass" defect symptom the unmodified-test discipline elsewhere guards.
    const ids = shortcuts.map((s) => s.id);
    expect(ids).toContain("command-palette");
    expect(ids).toContain("quick-launcher");

    const palette = shortcuts.find((s) => s.id === "command-palette")!;
    expect(palette.combo).toEqual({ key: "k", mod: true });

    const launcher = shortcuts.find((s) => s.id === "quick-launcher")!;
    expect(launcher.combo).toEqual({ key: "j", mod: true });
  });

  it("gives every declaration a non-empty description and group, with unique ids", () => {
    const ids = new Set<string>();
    for (const s of shortcuts) {
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.group.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  // Regression guards for the round-1/round-2 design defects (design.md Decision 2) — labelled
  // as such because both assertions exist specifically to stop that defect recurring.
  it("REGRESSION GUARD: help-overlay's combo does not carry a `shift` property (must stay don't-care)", () => {
    const helpOverlay = shortcuts.find((s) => s.id === "help-overlay")!;
    expect(Object.prototype.hasOwnProperty.call(helpOverlay.combo, "shift")).toBe(false);
  });

  it("REGRESSION GUARD: layout-undo's combo declares shift: false explicitly", () => {
    const undo = shortcuts.find((s) => s.id === "layout-undo")!;
    expect(undo.combo.shift).toBe(false);
  });
});

describe("matchesCombo", () => {
  const combo = { key: "k", mod: true };

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

  it("`mod` omitted rejects an event that holds the platform modifier", () => {
    const noModCombo = { key: "?" };
    const event = new KeyboardEvent("keydown", { key: "?", ctrlKey: true });
    expect(matchesCombo(event, noModCombo)).toBe(false);
  });

  describe("tri-state shift", () => {
    it("shift omitted (don't-care) matches with or without Shift held", () => {
      const dontCare = { key: "?" };
      expect(matchesCombo(new KeyboardEvent("keydown", { key: "?" }), dontCare)).toBe(true);
      expect(
        matchesCombo(new KeyboardEvent("keydown", { key: "?", shiftKey: true }), dontCare),
      ).toBe(true);
    });

    it("shift: true requires Shift to be held", () => {
      const shiftRequired = { key: "z", mod: true, shift: true };
      expect(
        matchesCombo(
          new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true }),
          shiftRequired,
        ),
      ).toBe(true);
      expect(
        matchesCombo(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }), shiftRequired),
      ).toBe(false);
    });

    // MUTATION CHECK (tasks.md 1.1): this assertion must fail red if `combo.shift === false`
    // enforcement is removed from `matchesCombo` — i.e. deleting the `shift === false` branch
    // makes this test fail, which is what makes it a real regression guard.
    it("shift: false must NOT match a mod+shift+z event (undo must not swallow redo)", () => {
      const undo = { key: "z", mod: true, shift: false };
      const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true });
      expect(matchesCombo(event, undo)).toBe(false);
    });
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

describe("isOverlayOpen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is false when neither an open dialog nor an aria-modal element exists", () => {
    expect(isOverlayOpen()).toBe(false);
  });

  it("is true for an open native <dialog>", () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.appendChild(dialog);
    expect(isOverlayOpen()).toBe(true);
  });

  it("is true for a portalled div with aria-modal=true (MobileNavSheet/RefinementChatDrawer shape)", () => {
    const div = document.createElement("div");
    div.setAttribute("aria-modal", "true");
    document.body.appendChild(div);
    expect(isOverlayOpen()).toBe(true);
  });
});

describe("formatCombo", () => {
  it("renders mod+shift on macOS as discrete caps", () => {
    expect(formatCombo({ key: "z", mod: true, shift: true }, { mac: true })).toEqual([
      "⌘",
      "⇧",
      "Z",
    ]);
  });

  it("renders mod+shift on non-macOS as discrete caps, with no navigator stubbing", () => {
    expect(formatCombo({ key: "z", mod: true, shift: true }, { mac: false })).toEqual([
      "Ctrl",
      "Shift",
      "Z",
    ]);
  });

  it("omits shift/mod tokens for a shift-omitted, mod-free combo", () => {
    expect(formatCombo({ key: "?" }, { mac: false })).toEqual(["?"]);
  });
});
