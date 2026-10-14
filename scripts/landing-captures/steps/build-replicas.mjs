// Rebuilds four panels of each of the owner's two real, publicly shared boards (News Overview, Building Helio) in the
// throwaway account, from the data their share links expose (panel content, Output config, schema, rows, appearance),
// because the public viewer cannot render them properly. The data is checked in under fixtures/prod-share-data.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { HERE } from "../lib/config.mjs";

const json = (name) =>
  JSON.parse(readFileSync(resolve(HERE, "fixtures/prod-share-data", name), "utf8"));

// One story throughout the news board: its photo and its summary are both "Meta AI Models".
const BOARDS = [
  {
    key: "news",
    dashboard: "News Overview",
    picks: [
      ["image", "Meta AI Models"],
      ["markdown", "Meta AI Models"],
      ["output", "Mood of the news"],
      ["output", "What kind of day"],
    ],
  },
  {
    key: "helio",
    dashboard: "Building Helio",
    picks: [
      ["output", "Avg Cycle Time"],
      ["output", "Throughput (7-day rolling)"],
      ["output", "Oldest Open Tickets"],
      ["output", "Velocity"],
    ],
  },
];

export async function buildReplicas({ call, setLayout }) {
  const ids = {};
  for (const board of BOARDS) {
    const tag = `landing-mock-${board.key}`;
    const all = json(`${board.key}-panels.json`).items;
    const dash = await call("create_dashboard", { name: board.dashboard, tag });
    const panelIds = [];
    for (const [type, title] of board.picks) {
      const src = all.find((p) => p.type === type && p.title === title);
      if (!src) throw new Error(`${board.key}: no ${type} panel "${title}"`);
      let panelId;
      if (type === "output") {
        const meta = json(`${board.key}-${src.id}-output-meta.json`);
        const rowsDoc = json(`${board.key}-${src.id}-rows.json`);
        const items = rowsDoc.items ?? rowsDoc.rows ?? rowsDoc;
        const columns = meta.schema.map((c) => ({ name: c.name, type: c.type }));
        const rows = items.map((r) => columns.map((c) => r[c.name] ?? null));
        const pipe = await call("create_pipeline", {
          name: title,
          tag,
          roots: [{ type: "static", name: `${title} data`, config: { columns, rows } }],
          outputs: [{ kind: meta.kind, name: title, config: meta.config }],
        });
        await call("run_pipeline", { pipelineId: pipe.id });
        const placed = await call("place_outputs", {
          dashboardId: dash.id,
          items: [{ outputId: pipe.outputs[0].id, title }],
        });
        panelId = (placed.panels ?? placed)[0].id;
      } else {
        const created = await call("create_content_panel", {
          dashboardId: dash.id,
          title,
          type,
          config: src.config,
        });
        panelId = (created.panel ?? created).id;
      }
      if (src.appearance)
        await call("update_panel_appearance", { panelId, appearance: src.appearance });
      panelIds.push(panelId);
    }
    await setLayout(dash.id, panelIds);
    ids[board.key] = dash.id;
  }
  return ids;
}
