// HEL-244/HEL-245 — `buildContentBindingPatch` (Text/Markdown panel Content
// editor save) and the "text"/"markdown" cases of `seedCreateConfig` (via
// `buildCreatePanelBody`).

import { buildCreatePanelBody, buildContentBindingPatch } from "./panelPayloads";

describe("buildContentBindingPatch", () => {
  it("Source mode (field): sets dataTypeId/fieldMapping.content and OMITS content entirely", () => {
    const patch = buildContentBindingPatch({
      mode: "field",
      typeId: "dt-1",
      fieldValue: "headline",
      literalValue: "Prior literal text — must not appear in the patch",
    });

    expect(patch.dataTypeId).toBe("dt-1");
    expect(patch.fieldMapping).toEqual({ content: "headline" });
    // design.md Decision 1's bind-direction corollary — the regression this
    // guards: the outgoing patch must not carry a `content` key at all when
    // saving in Source mode, so the backend's "absent = unchanged" Patch
    // convention preserves the prior literal text untouched.
    expect(Object.keys(patch)).not.toContain("content");
    expect("content" in patch).toBe(false);
  });

  it("Source mode with no field chosen: fieldMapping is null (no content slot bound yet)", () => {
    const patch = buildContentBindingPatch({
      mode: "field",
      typeId: "dt-1",
      fieldValue: "",
      literalValue: "",
    });

    expect(patch.dataTypeId).toBe("dt-1");
    expect(patch.fieldMapping).toBeNull();
    expect("content" in patch).toBe(false);
  });

  it("Static mode (literal): sets content and clears dataTypeId/fieldMapping to unbound", () => {
    const patch = buildContentBindingPatch({
      mode: "literal",
      typeId: "dt-1",
      fieldValue: "headline",
      literalValue: "New literal text",
    });

    expect(patch.content).toBe("New literal text");
    expect(patch.dataTypeId).toBeNull();
    expect(patch.fieldMapping).toBeNull();
  });
});

describe("buildCreatePanelBody — text case seeds dataTypeId", () => {
  it("seeds config.dataTypeId from the creation modal's selected DataType", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Text Panel",
      type: "text",
      dataTypeId: "dt-1",
    });

    expect(body.config).toMatchObject({ content: "", dataTypeId: "dt-1", fieldMapping: {} });
  });

  it("defaults config.dataTypeId to empty string when no DataType is selected", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Text Panel",
      type: "text",
    });

    expect(body.config).toMatchObject({ content: "", dataTypeId: "", fieldMapping: {} });
  });
});

describe("buildCreatePanelBody — markdown case seeds dataTypeId", () => {
  it("seeds config.dataTypeId from the creation modal's selected DataType", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Markdown Panel",
      type: "markdown",
      dataTypeId: "dt-1",
    });

    expect(body.config).toMatchObject({ content: "", dataTypeId: "dt-1", fieldMapping: {} });
  });

  it("defaults config.dataTypeId to empty string when no DataType is selected", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Markdown Panel",
      type: "markdown",
    });

    expect(body.config).toMatchObject({ content: "", dataTypeId: "", fieldMapping: {} });
  });
});
