import type { DataSourceKind } from "../types/dataSource";

/** Human label for a DataSource's kind — shared by any surface that shows a
 *  kind badge/label next to a source's name (`PipelineDetailHeader`'s bound-
 *  source field group, `CreatePipelineModal`'s source picker,
 *  `ShapeInstantiateStep`). Relocated here (HEL-719 design.md D2) from the
 *  now-retired `BoundSourceBar` — a pipelines-UI file was the wrong home for
 *  a sources-domain util with two pipelines-feature consumers.
 *  `SourceDetailPanel.tsx` keeps its own private copy (out of scope). */
export function labelForKind(kind: DataSourceKind): string {
  switch (kind) {
    case "rest_api":
      return "REST API";
    case "csv":
      return "CSV";
    case "static":
      return "Static";
    case "sql":
      return "SQL";
    case "text":
      return "Text/Markdown";
    case "pdf":
      return "PDF";
    case "image":
      return "Image";
  }
}
