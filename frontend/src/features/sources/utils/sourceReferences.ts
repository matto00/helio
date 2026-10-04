import type { SourceReferenceSummary } from "../types/dataSource";

/** HEL-1258: the ONE formatter for "Used by" and both delete warnings. It formats the server's reference
 *  summary (`GET /api/data-sources/references`); the client never counts or names references itself, and the
 *  summary carries hidden references as counts only, so nothing here can name a resource the caller cannot see. */

const KIND_LABELS: Record<string, string> = {
  root: "root",
  join: "join input",
  lookup: "lookup input",
  union: "union input",
  upsertTarget: "upsert target",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Total referencing pipelines / form panels, visible and hidden. */
export function referenceCounts(summary: SourceReferenceSummary): {
  pipelines: number;
  panels: number;
} {
  return {
    pipelines: summary.pipelines.length + summary.hiddenPipelineCount,
    panels: summary.panels.length + summary.hiddenPanelCount,
  };
}

export interface SourceUsage {
  /** Cell text: "—" until the summary loads, "Unused" once it has and lists nothing, else the counts. */
  label: string;
  /** Sort key: total referencing resources (0 while not loaded / unused). */
  total: number;
  /** Tooltip naming ONLY visible resources, hidden ones as a count; undefined when there is nothing to list. */
  title?: string;
}

export function summarizeSourceUsage(
  summary: SourceReferenceSummary | undefined,
  loaded: boolean,
): SourceUsage {
  if (summary === undefined) return { label: loaded ? "Unused" : "—", total: 0 };
  const { pipelines, panels } = referenceCounts(summary);
  const parts = [
    pipelines > 0 ? plural(pipelines, "pipeline", "pipelines") : null,
    panels > 0 ? plural(panels, "form panel", "form panels") : null,
  ].filter((p): p is string => p !== null);
  const lines = [
    ...summary.pipelines.map(
      (p) => `${p.name} (${p.references.map((k) => KIND_LABELS[k] ?? k).join(", ")})`,
    ),
    ...summary.panels.map((p) => `${p.title} (form panel on ${p.dashboardName})`),
  ];
  const hidden = summary.hiddenPipelineCount + summary.hiddenPanelCount;
  if (hidden > 0) lines.push(`${hidden} you cannot access`);
  return {
    label: parts.length > 0 ? parts.join(", ") : "Unused",
    total: pipelines + panels,
    title: lines.length > 0 ? lines.join("\n") : undefined,
  };
}

/** The delete-confirm warning, or null when the summary lists no reference. Copy names counts only. */
export function sourceDeleteWarning(summary: SourceReferenceSummary | undefined): string | null {
  if (summary === undefined) return null;
  const { pipelines, panels } = referenceCounts(summary);
  const total = pipelines + panels;
  if (total === 0) return null;
  const parts = [
    pipelines > 0 ? plural(pipelines, "pipeline", "pipelines") : null,
    panels > 0 ? plural(panels, "form panel", "form panels") : null,
  ].filter((p): p is string => p !== null);
  return `${parts.join(" and ")} ${total === 1 ? "references" : "reference"} this source, so deleting it will be refused until you remove ${total === 1 ? "that reference" : "those references"}.`;
}
