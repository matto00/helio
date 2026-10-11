// HEL-1307 task 3.6 / 4.4: the Output editor's "Conditional formatting" section.

import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { conditionalFormatsFixture } from "../../../../test/conditionalFormatsFixture";
import {
  addRuleThroughUi,
  choose,
  http,
  outputOf,
  renderSheet,
  save,
  setupEditorMocks,
  type as typeInto,
} from "../../../../test/conditionalFormatsEditorHarness";
import { validateConditionalFormatRule } from "../../../panels/ui/renderers/conditionalFormatting";

beforeEach(setupEditorMocks);

const METRIC = { fieldMapping: { value: "amount" } };
const TABLE = { fieldMapping: {} };

describe("Conditional formatting section", () => {
  it.each(["metric", "collection", "table"])("is offered for a %s Output", async (kind) => {
    renderSheet(outputOf(kind, kind === "metric" ? METRIC : TABLE));
    expect(await screen.findByText("Conditional formatting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument();
  });

  it.each(["chart", "timeline", "markdown"])("is not offered for a %s Output", async (kind) => {
    renderSheet(outputOf(kind, {}));
    await screen.findByText("Configuration");
    expect(screen.queryByText("Conditional formatting")).toBeNull();
  });

  it("states that rules compare the raw value and the first match wins", async () => {
    renderSheet(outputOf("metric", METRIC));
    expect(await screen.findByText(/compare the raw value/i)).toBeInTheDocument();
    expect(screen.getByText(/first matching rule wins/i)).toBeInTheDocument();
  });

  it("shows the upper value input only for 'is between' and column/target only for a table", async () => {
    renderSheet(outputOf("metric", METRIC));
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    expect(screen.queryByLabelText("Rule 1 to")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Rule 1 column" })).toBeNull();
    await choose("Rule 1 condition", "is between");
    expect(screen.getByLabelText("Rule 1 to")).toBeInTheDocument();
  });

  it.each([
    ["metric", "gt"],
    ["metric", "between"],
    ["table", "gt"],
    ["table", "between"],
  ])(
    "every %s rule-row control (%s) has an accessible name containing its visible label (WCAG 2.5.3)",
    async (kind, op) => {
      renderSheet(outputOf(kind, kind === "metric" ? METRIC : TABLE));
      fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
      await choose("Rule 1 condition", op === "between" ? "is between" : "is greater than");
      const group = screen.getByRole("group", { name: "Rule 1" });
      const labels = Array.from(group.querySelectorAll("label[for]"));
      expect(labels.length).toBeGreaterThanOrEqual(kind === "table" ? 6 : 4);
      for (const label of labels) {
        const control = group.querySelector(`[id="${label.getAttribute("for")}"]`);
        expect(control).not.toBeNull();
        const visible = (label.textContent ?? "")
          .replace(/\(optional\)/i, "")
          .trim()
          .toLowerCase();
        const name = (control?.getAttribute("aria-label") ?? "").toLowerCase();
        expect(visible).not.toBe("");
        expect(name).toContain(visible);
      }
    },
  );

  it("offers column and target on a table rule", async () => {
    renderSheet(outputOf("table", TABLE));
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    expect(screen.getByRole("combobox", { name: "Rule 1 column" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rule 1 applies to" })).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("a new metric rule is sent as conditionalFormats (label omitted when empty)", async () => {
    renderSheet(outputOf("metric", METRIC));
    await addRuleThroughUi(1, { op: "lt", value: 50, tone: "error" });
    const config = await save();
    expect(config).toEqual({ conditionalFormats: [{ op: "lt", value: 50, tone: "error" }] });
    expect(JSON.stringify(config)).not.toContain('"label"');
  });

  it("writes a numeric eq value as a JSON number and a text one as a trimmed string", async () => {
    renderSheet(outputOf("metric", METRIC));
    await addRuleThroughUi(1, { op: "eq", value: "3", tone: "warning" });
    await addRuleThroughUi(2, { op: "eq", value: "  failed ", tone: "error" });
    const rules = (await save()).conditionalFormats as { value: unknown }[];
    expect(rules.map((r) => r.value)).toEqual([3, "failed"]);
  });

  it("an untouched Output with stored rules sends no config at all", async () => {
    const stored = [{ op: "lt", value: 50, tone: "error", label: "Low" }];
    renderSheet(outputOf("metric", { ...METRIC, conditionalFormats: stored }));
    expect(await screen.findByLabelText("Rule 1 value")).toHaveValue(50);
    expect(await save()).toEqual({});
  });

  it("an Output with no stored key and no rules does not gain the key", async () => {
    renderSheet(outputOf("metric", METRIC));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Renamed" } });
    expect("conditionalFormats" in (await save())).toBe(false);
  });

  it("removing the last stored rule writes [] (never omits the key)", async () => {
    renderSheet(
      outputOf("metric", {
        ...METRIC,
        conditionalFormats: [{ op: "lt", value: 1, tone: "error" }],
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remove rule 1" }));
    expect((await save()).conditionalFormats).toEqual([]);
  });

  it("reordering changes the stored order", async () => {
    const a = { op: "lt", value: 50, tone: "error" };
    const b = { op: "lt", value: 80, tone: "warning" };
    renderSheet(outputOf("metric", { ...METRIC, conditionalFormats: [a, b] }));
    fireEvent.click(await screen.findByRole("button", { name: "Move rule 2 up" }));
    expect((await save()).conditionalFormats).toEqual([b, a]);
  });

  it("keeps the first rule's Move up and the last rule's Move down disabled", async () => {
    const a = { op: "lt", value: 50, tone: "error" };
    renderSheet(outputOf("metric", { ...METRIC, conditionalFormats: [a, a] }));
    expect(await screen.findByRole("button", { name: "Move rule 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move rule 2 down" })).toBeDisabled();
  });
});

describe("validation mirrors the server", () => {
  it("a freshly added rule shows no error until touched, but Save stays blocked", async () => {
    renderSheet(outputOf("metric", METRIC));
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Finish or remove rule 1 to save/)).toBeInTheDocument();
    expect(screen.getByLabelText("Rule 1 value")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a touched blank numeric value shows editor-facing copy on the value only and blocks Save", async () => {
    renderSheet(outputOf("metric", METRIC));
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    await typeInto("Rule 1 value", "5");
    await typeInto("Rule 1 value", "");
    const alert = await screen.findByText("Rule 1: Enter a number to compare with.");
    expect(alert).not.toHaveTextContent(/finite/);
    const value = screen.getByLabelText("Rule 1 value");
    expect(value).toHaveAttribute("aria-invalid", "true");
    expect(value).toHaveAttribute("aria-describedby", alert.id);
    expect(screen.getByLabelText("Rule 1 label")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await typeInto("Rule 1 value", "5");
    await waitFor(() => expect(screen.queryByText(/Enter a number to compare/)).toBeNull());
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("an upper value below the lower one is rejected on both bounds", async () => {
    renderSheet(outputOf("metric", METRIC));
    await addRuleThroughUi(1, { op: "between", value: 9, value2: 1, tone: "error" });
    expect(await screen.findByText(/must not be larger than the second/)).toBeInTheDocument();
    expect(screen.getByLabelText("Rule 1 from")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Rule 1 to")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a table rule needs a column, and only the column is marked invalid", async () => {
    renderSheet(outputOf("table", TABLE));
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    await typeInto("Rule 1 value", "5");
    expect(await screen.findByText(/Choose the column this rule tests/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rule 1 column" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Rule 1 value")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("every control in a rule row has a visible label", async () => {
    renderSheet(outputOf("table", TABLE));
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    for (const label of ["Column", "Condition", "Value", "Colour", "Applies to"]) {
      expect(screen.getByText(label, { selector: "label" })).toBeInTheDocument();
    }
  });

  it("caps the list at 20 rules by disabling Add rule", async () => {
    const rules = Array.from({ length: 20 }, (_, i) => ({ op: "gt", value: i, tone: "success" }));
    renderSheet(outputOf("metric", { ...METRIC, conditionalFormats: rules }));
    expect(await screen.findByRole("button", { name: "Add rule" })).toBeDisabled();
  });

  it("uses the same validator the fixture's invalid cases are checked against", () => {
    for (const c of conditionalFormatsFixture.invalid.filter((i) => i.ruleIndex !== null)) {
      const rule = (c.config.conditionalFormats as unknown[])[c.ruleIndex as number];
      expect(validateConditionalFormatRule(rule, c.kind)).not.toBeNull();
    }
  });
});

describe("metric preview applies the UNSAVED rules", () => {
  it("tones the preview value as soon as a rule is added, before saving", async () => {
    renderSheet(outputOf("metric", METRIC));
    // preview value 42 renders plain with no rules
    const preview = await screen.findByRole("heading", { name: "Preview" });
    const card = preview.parentElement as HTMLElement;
    await waitFor(() => expect(within(card).getByText("42")).toBeInTheDocument());
    expect(card.querySelector(".panel-content__metric-figure")).toBeNull();

    await addRuleThroughUi(1, { op: "lt", value: 50, tone: "error", label: "Low" });
    await waitFor(() =>
      expect(card.querySelector(".panel-content__metric-figure--tone-error")).not.toBeNull(),
    );
    expect(within(card).getByText("Low")).toBeInTheDocument();
    expect(http.patch).not.toHaveBeenCalled();
  });

  it("does not tone the preview with a half-typed (invalid) rule", async () => {
    renderSheet(outputOf("metric", METRIC));
    const card = (await screen.findByRole("heading", { name: "Preview" }))
      .parentElement as HTMLElement;
    await waitFor(() => expect(within(card).getByText("42")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(card.querySelector(".panel-content__metric-figure")).toBeNull();
  });
});
