import {
  composerPickerModel,
  modelLabelFor,
  SERVER_DEFAULT_VALUE,
  serverDefaultLabel,
} from "./modelOptions";
import type { AssistantModelsResponse } from "./types";

const models: AssistantModelsResponse = {
  models: [
    { id: "claude-haiku-5-5", label: "Haiku 5.5", betaWeight: 1 },
    { id: "claude-opus-5-5", label: "Opus 5.5", betaWeight: 8 },
  ],
  serverDefault: { id: "claude-opus-4-8" },
  defaultModel: { id: "claude-opus-4-8" },
};

describe("composerPickerModel", () => {
  it("shows a selectable effective model as itself, with exactly the selectable options", () => {
    const picker = composerPickerModel(models, "claude-opus-5-5");
    expect(picker.value).toBe("claude-opus-5-5");
    // The server default (claude-opus-4-8) is not selectable, so "Server default" stays available to undo a pick.
    expect(picker.options.map((o) => o.value)).toEqual([
      SERVER_DEFAULT_VALUE,
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
  });

  it("offers exactly the selectable options when a clear would resolve to a selectable default", () => {
    const selectableDefault = { ...models, defaultModel: { id: "claude-opus-5-5" } };
    const picker = composerPickerModel(selectableDefault, "claude-opus-5-5");
    expect(picker.options.map((o) => o.value)).toEqual(["claude-haiku-5-5", "claude-opus-5-5"]);
  });

  it("never offers a 'Server default' option that a saved default would override", () => {
    // Server default claude-opus-4-8 is not selectable, but the user saved Haiku: a clear resolves to Haiku, so an
    // option labelled with claude-opus-4-8 would promise a model the server will not use.
    const saved = { ...models, defaultModel: { id: "claude-haiku-5-5" } };
    const picker = composerPickerModel(saved, "claude-haiku-5-5");
    expect(picker.value).toBe("claude-haiku-5-5");
    expect(picker.options.map((o) => o.value)).not.toContain(SERVER_DEFAULT_VALUE);
  });

  it("shows a non-selectable effective model as 'Server default (<id>)', first in the list", () => {
    const picker = composerPickerModel(models, "claude-opus-4-8");
    expect(picker.value).toBe(SERVER_DEFAULT_VALUE);
    expect(picker.options[0]).toEqual({
      value: SERVER_DEFAULT_VALUE,
      label: "Server default (claude-opus-4-8)",
    });
    expect(picker.options).toHaveLength(3);
  });
});

describe("labels", () => {
  it("prefers the catalog label and falls back to the raw id", () => {
    expect(modelLabelFor(models, "claude-haiku-5-5")).toBe("Haiku 5.5");
    expect(modelLabelFor(models, "claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(modelLabelFor(null, "claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });

  it("names the server default by label when the catalog has one, else its id", () => {
    expect(serverDefaultLabel({ id: "claude-opus-5-5", label: "Opus 5.5" })).toBe(
      "Server default (Opus 5.5)",
    );
    expect(serverDefaultLabel({ id: "claude-opus-4-8" })).toBe("Server default (claude-opus-4-8)");
  });
});
