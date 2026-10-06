import { triggerSourceLabel } from "./triggerSourceLabel";

describe("triggerSourceLabel", () => {
  it.each([
    ["manual", "Manual"],
    ["scheduled", "Scheduled"],
    ["external", "External"],
    ["auto-run", "Auto-run"],
  ])("labels %s", (raw, label) => {
    expect(triggerSourceLabel(raw)).toBe(label);
  });

  it("sentence-cases an unknown value and never returns empty or undefined", () => {
    expect(triggerSourceLabel("webhook_retry")).toBe("Webhook retry");
    expect(triggerSourceLabel("")).toBe("Unknown");
    expect(triggerSourceLabel(undefined)).toBe("Unknown");
  });
});
