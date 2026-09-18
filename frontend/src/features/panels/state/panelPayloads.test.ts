// HEL-909 — `buildCreatePanelBody` (output/content-kind create payloads),
// `buildContentPatch` (Text/Markdown literal content), `buildImagePatch`,
// `buildDividerPatch`.

import {
  buildContentPatch,
  buildCreatePanelBody,
  buildDividerPatch,
  buildImagePatch,
} from "./panelPayloads";

describe("buildCreatePanelBody — output kind", () => {
  it("seeds config.outputId from the picked Output", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      type: "output",
      outputId: "out-1",
    });

    expect(body.type).toBe("output");
    expect(body.config).toEqual({ outputId: "out-1" });
  });

  it("defaults outputId to empty string when none is supplied", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "output" });
    expect(body.config).toEqual({ outputId: "" });
  });

  it("omits title when not supplied", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "output", outputId: "out-1" });
    expect("title" in body).toBe(false);
  });

  it("includes title when supplied", () => {
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      type: "output",
      outputId: "out-1",
      title: "Revenue",
    });
    expect(body.title).toBe("Revenue");
  });
});

describe("buildCreatePanelBody — content kinds default to their empty literal config", () => {
  it("text", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "text" });
    expect(body.config).toEqual({ content: "" });
  });

  it("markdown", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "markdown" });
    expect(body.config).toEqual({ content: "" });
  });

  it("image", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "image" });
    expect(body.config).toEqual({ imageUrl: "", imageFit: "contain" });
  });

  it("divider", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "divider" });
    expect(body.config).toEqual({ orientation: "horizontal" });
  });
});

describe("buildContentPatch", () => {
  it("wraps literal content as the config PATCH", () => {
    expect(buildContentPatch("Hello")).toEqual({ content: "Hello" });
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

describe("buildDividerPatch", () => {
  it("builds the divider config", () => {
    const patch = buildDividerPatch({ orientation: "vertical", weight: 2, color: "#000" });
    expect(patch).toEqual({ orientation: "vertical", weight: 2, color: "#000" });
  });
});

// HEL-1084 task 2.2 — `config` override, used only by `form` (design.md D6).
describe("buildCreatePanelBody — form kind", () => {
  it("uses the supplied config override as-is when creating a form panel", () => {
    const config = { dataSourceId: "ds-1", fields: [], submit: { writeMode: "append" as const } };
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "form", config });
    expect(body.config).toEqual(config);
  });

  it("falls back to the empty form config when no override is supplied", () => {
    const body = buildCreatePanelBody({ dashboardId: "d1", type: "form" });
    expect(body.config).toEqual({ dataSourceId: "", fields: [], submit: { writeMode: "append" } });
  });

  it("ignores a config override for a non-form kind", () => {
    const config = { dataSourceId: "ds-1", fields: [], submit: { writeMode: "append" as const } };
    const body = buildCreatePanelBody({
      dashboardId: "d1",
      type: "output",
      outputId: "out-1",
      config,
    });
    expect(body.config).toEqual({ outputId: "out-1" });
  });
});
