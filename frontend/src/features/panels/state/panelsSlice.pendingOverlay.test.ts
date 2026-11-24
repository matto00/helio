// HEL-1828: a server panel response (typed subtype save, legacy title/appearance PATCH, batch save) must not hide a
// still-pending staged edit. Each whole-panel replacer re-applies the panel's pending update on the server copy.

import {
  accumulatePanelUpdate,
  fetchPanels,
  panelsReducer,
  updatePanelAppearance,
  updatePanelDivider,
  updatePanelForm,
  updatePanelImage,
  updatePanelMarkdownContent,
  updatePanelOutputControls,
  updatePanelsBatch,
  updatePanelTextContent,
  updatePanelTitle,
} from "./panelsSlice";
import { makeOutputPanel } from "../../../test/panelFixtures";
import type { Panel } from "../types/panel";

const stored = makeOutputPanel({
  id: "panel-1",
  dashboardId: "dashboard-1",
  title: "Old title",
  appearance: { background: "#111111", color: "#222222", transparency: 0.5 },
});

/** The server copy of the panel after a subtype save: stored title/appearance, new config. */
const serverCopy: Panel = {
  ...stored,
  config: { ...stored.config, controls: [] },
  meta: { ...stored.meta, lastUpdated: "2026-11-23T00:00:00Z" },
};

function staged() {
  const loaded = panelsReducer(undefined, fetchPanels.fulfilled([stored], "req", "dashboard-1"));
  return panelsReducer(
    loaded,
    accumulatePanelUpdate({
      panelId: "panel-1",
      fields: { title: "New title", appearance: { background: "#abcdef" } },
    }),
  );
}

type Case = [string, (p: Panel) => Parameters<typeof panelsReducer>[1]];

const cases: Case[] = [
  [
    "updatePanelAppearance",
    (p) => updatePanelAppearance.fulfilled(p, "r", { panelId: "panel-1", appearance: {} as never }),
  ],
  [
    "updatePanelTitle",
    (p) => updatePanelTitle.fulfilled(p, "r", { panelId: "panel-1", title: "x" }),
  ],
  [
    "updatePanelTextContent",
    (p) => updatePanelTextContent.fulfilled(p, "r", { panelId: "panel-1", content: "x" }),
  ],
  [
    "updatePanelMarkdownContent",
    (p) => updatePanelMarkdownContent.fulfilled(p, "r", { panelId: "panel-1", content: "x" }),
  ],
  [
    "updatePanelImage",
    (p) =>
      updatePanelImage.fulfilled(p, "r", {
        panelId: "panel-1",
        imageUrl: "u",
        imageFit: "contain",
        caption: null,
      }),
  ],
  [
    "updatePanelDivider",
    (p) =>
      updatePanelDivider.fulfilled(p, "r", {
        panelId: "panel-1",
        dividerOrientation: "horizontal",
        dividerWeight: 1,
        dividerColor: null,
      }),
  ],
  [
    "updatePanelForm",
    (p) => updatePanelForm.fulfilled(p, "r", { panelId: "panel-1", config: {} as never }),
  ],
  [
    "updatePanelOutputControls",
    (p) => updatePanelOutputControls.fulfilled(p, "r", { panelId: "panel-1", controls: [] }),
  ],
  [
    "updatePanelsBatch",
    (p) =>
      updatePanelsBatch.fulfilled({ panels: [p] }, "r", {
        fields: ["title"],
        panels: [{ id: "panel-1", title: "New title" }],
      }),
  ],
];

describe("a server panel response keeps a still-pending staged edit (HEL-1828)", () => {
  it.each(cases)(
    "%s.fulfilled shows staged title and appearance over the server copy",
    (_n, make) => {
      const before = staged();
      const next = panelsReducer(before, make(serverCopy));

      expect(next.items[0].title).toBe("New title");
      // staged key wins; every other stored key comes from the server copy
      expect(next.items[0].appearance).toEqual({
        background: "#abcdef",
        color: "#222222",
        transparency: 0.5,
      });
      expect(next.items[0].config).toEqual(serverCopy.config);
      // the reducer never touches the pending map: the flush still sends each staged field exactly once
      expect(next.pendingPanelUpdates).toEqual(before.pendingPanelUpdates);
    },
  );

  it.each(cases)("%s.fulfilled with nothing pending takes the server copy verbatim", (_n, make) => {
    const loaded = panelsReducer(undefined, fetchPanels.fulfilled([stored], "req", "dashboard-1"));
    const next = panelsReducer(loaded, make(serverCopy));

    expect(next.items[0]).toEqual(serverCopy);
  });

  it("an edit staged on another panel does not leak into this panel's server copy", () => {
    const other = makeOutputPanel({ id: "panel-2", dashboardId: "dashboard-1", title: "Other" });
    const loaded = panelsReducer(
      undefined,
      fetchPanels.fulfilled([stored, other], "req", "dashboard-1"),
    );
    const withPending = panelsReducer(
      loaded,
      accumulatePanelUpdate({ panelId: "panel-2", fields: { title: "Staged other" } }),
    );
    const next = panelsReducer(
      withPending,
      updatePanelOutputControls.fulfilled(serverCopy, "r", { panelId: "panel-1", controls: [] }),
    );

    expect(next.items[0].title).toBe("Old title");
    expect(next.items[1].title).toBe("Staged other");
  });
});
