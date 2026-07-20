// HEL-244/HEL-245 — `buildContentBindingPatch` (Text/Markdown panel Content
// editor save) and the "text"/"markdown" cases of `seedCreateConfig` (via
// `buildCreatePanelBody`).

import {
  buildBindingPatch,
  buildCollectionPatch,
  buildCreatePanelBody,
  buildContentBindingPatch,
  buildImagePatch,
} from "./panelPayloads";

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

describe("buildImagePatch — caption (HEL-318)", () => {
  it("includes a non-blank caption in the PATCH config", () => {
    const patch = buildImagePatch({
      imageUrl: "https://x/y.png",
      imageFit: "cover",
      caption: "Source: NASA",
    });
    expect(patch).toEqual({
      imageUrl: "https://x/y.png",
      imageFit: "cover",
      caption: "Source: NASA",
    });
  });

  it("sends caption: null to clear a previously-set caption", () => {
    const patch = buildImagePatch({
      imageUrl: "https://x/y.png",
      imageFit: "cover",
      caption: null,
    });
    expect(patch.caption).toBeNull();
  });
});

describe("buildBindingPatch — chart annotation (HEL-318)", () => {
  it("omits annotation entirely when undefined (leave unchanged)", () => {
    const patch = buildBindingPatch({ typeId: "dt-1", fieldMapping: { xAxis: "a" } });
    expect("annotation" in patch).toBe(false);
  });

  it("includes a non-blank annotation when set", () => {
    const patch = buildBindingPatch({
      typeId: "dt-1",
      fieldMapping: { xAxis: "a" },
      annotation: "Source: BLS",
    });
    expect(patch.annotation).toBe("Source: BLS");
  });

  it("sends annotation: null to clear a previously-set annotation", () => {
    const patch = buildBindingPatch({
      typeId: "dt-1",
      fieldMapping: { xAxis: "a" },
      annotation: null,
    });
    expect("annotation" in patch).toBe(true);
    expect(patch.annotation).toBeNull();
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

describe("buildCreatePanelBody — collection case (HEL-247, HEL-305 lesson)", () => {
  it("carries baseType/layout EXPLICITLY plus the seeded binding", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "Metrics by Region",
      type: "collection",
      dataTypeId: "dt-1",
    });

    // The regression HEL-305 guards: creation-time discriminators must be
    // carried explicitly in the payload, not dropped via a typeConfig passthrough.
    expect(body.type).toBe("collection");
    expect(body.config).toEqual({
      dataTypeId: "dt-1",
      fieldMapping: {},
      baseType: "metric",
      layout: "grid",
    });
  });

  it("defaults config.dataTypeId to empty string when no DataType is selected", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "Empty Collection",
      type: "collection",
    });

    expect(body.config).toMatchObject({ dataTypeId: "", baseType: "metric", layout: "grid" });
  });
});

describe("buildCreatePanelBody — chart case carries chartType (HEL-305)", () => {
  it("carries a selected chartType as appearance.chart.chartType composed over the shared default", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Chart",
      type: "chart",
      typeConfig: { type: "chart", chartType: "bar" },
      dataTypeId: "dt-1",
    });

    // The regression HEL-305 guards: the creation-modal chart-type selection
    // must reach the create payload as appearance.chart.chartType (not be
    // dropped so every new chart renders as line).
    expect(body.appearance?.chart?.chartType).toBe("bar");
    // Composed over the shared default chart appearance (series colors etc.),
    // not a bare { chartType } object.
    expect(body.appearance?.chart?.seriesColors?.length).toBe(8);
    expect(body.appearance?.background).toBe("transparent");
    // Config binding is still seeded as before.
    expect(body.config).toMatchObject({ dataTypeId: "dt-1" });
  });

  it("omits appearance entirely when chartType is unset", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Chart",
      type: "chart",
      typeConfig: { type: "chart" },
      dataTypeId: "dt-1",
    });

    expect("appearance" in body).toBe(false);
  });

  it("omits appearance for non-chart panel types", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "My Metric",
      type: "metric",
      typeConfig: { type: "metric", valueLabel: "Revenue" },
      dataTypeId: "dt-1",
    });

    expect("appearance" in body).toBe(false);
  });
});

describe("buildCreatePanelBody — metric case seeds label/unit (HEL-305)", () => {
  it("seeds config.label/config.unit from the creation modal's valueLabel/unit", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "Revenue",
      type: "metric",
      typeConfig: { type: "metric", valueLabel: "Revenue", unit: "USD" },
      dataTypeId: "dt-1",
    });

    expect(body.config).toMatchObject({ dataTypeId: "dt-1", label: "Revenue", unit: "USD" });
  });

  it("omits label/unit when the creation fields are blank", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      title: "Revenue",
      type: "metric",
      typeConfig: { type: "metric", valueLabel: "", unit: "" },
      dataTypeId: "dt-1",
    });

    expect("label" in body.config).toBe(false);
    expect("unit" in body.config).toBe(false);
  });
});

describe("buildCollectionPatch (HEL-247)", () => {
  it("carries a layout-only change without unrelated cleared fields", () => {
    const patch = buildCollectionPatch({
      typeId: "dt-1",
      fieldMapping: { value: "amount" },
      layout: "list",
    });
    expect(patch.layout).toBe("list");
    expect(patch.dataTypeId).toBe("dt-1");
    expect(patch.fieldMapping).toEqual({ value: "amount" });
    // baseType/itemOptions were not supplied → their keys are omitted entirely
    // (absent = unchanged), never clobbered.
    expect("baseType" in patch).toBe(false);
    expect("itemOptions" in patch).toBe(false);
  });

  it("omits itemOptions when undefined and clears it when null", () => {
    expect("itemOptions" in buildCollectionPatch({ typeId: "dt-1", fieldMapping: null })).toBe(
      false,
    );
    const cleared = buildCollectionPatch({ typeId: "dt-1", fieldMapping: null, itemOptions: null });
    expect(cleared.itemOptions).toBeNull();
  });

  it("sets a literal metric unit under itemOptions.metric", () => {
    const patch = buildCollectionPatch({
      typeId: "dt-1",
      fieldMapping: { value: "amount" },
      itemOptions: { metric: { unit: "$" } },
    });
    expect(patch.itemOptions).toEqual({ metric: { unit: "$" } });
  });
});
