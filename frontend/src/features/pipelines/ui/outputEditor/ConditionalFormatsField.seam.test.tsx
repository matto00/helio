// HEL-1307 seam test, frontend half (C2). `shared-test-fixtures/conditional-formats-config.json` holds the
// exact `conditionalFormats` configs the editor writes. Each editor-producible valid case is built through
// the REAL Output editor sheet (adding each rule via the UI) and its PATCH body must equal the fixture; the
// backend `ConditionalFormatsSeamSpec` accepts the very same objects over the real routes.

import { screen } from "@testing-library/react";

import {
  conditionalFormatsFixture,
  type FixtureValidCase,
} from "../../../../test/conditionalFormatsFixture";
import {
  addRuleThroughUi,
  http,
  outputOf,
  renderSheet,
  save,
  setupEditorMocks,
} from "../../../../test/conditionalFormatsEditorHarness";

beforeEach(setupEditorMocks);

const producible = conditionalFormatsFixture.valid.filter((c) => c.editorProducible);

describe("the real editor produces the fixture's valid cases (seam)", () => {
  it.each(producible)("$name", async (c: FixtureValidCase) => {
    const base = c.kind === "table" ? { fieldMapping: {} } : { fieldMapping: { value: "amount" } };
    renderSheet(outputOf(c.kind, base));
    const rules = c.config.conditionalFormats as Record<string, unknown>[];
    for (let i = 0; i < rules.length; i++) await addRuleThroughUi(i + 1, rules[i]);
    expect(screen.queryByRole("alert")).toBeNull();
    const config = await save();
    expect(config.conditionalFormats).toEqual(rules);
    expect(http.patch).toHaveBeenCalledTimes(1);
  });
});
