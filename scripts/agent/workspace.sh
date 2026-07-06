#!/usr/bin/env bash
# workspace.sh — print a compact snapshot of the authenticated user's workspace.
#
# Shell twin of the MCP `get_workspace_context` tool: fans out over the read
# endpoints and merges them into one JSON object (data sources, DataTypes with a
# pipelineOutput flag, pipelines, dashboards).
#
# Usage:  HELIO_PAT=helio_pat_… ./workspace.sh
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

sources="$(helio_get /api/data-sources)"
types="$(helio_get /api/types)"
pipelines="$(helio_get /api/pipelines)"
dashboards="$(helio_get /api/dashboards)"

# spray-json omits sourceId when null → a MISSING sourceId means a
# pipeline-output (panel-bindable) DataType. `(.sourceId // null)` normalizes it.
jq -n \
  --argjson sources "$sources" \
  --argjson types "$types" \
  --argjson pipelines "$pipelines" \
  --argjson dashboards "$dashboards" \
  '{
    counts: {
      dataSources: ($sources.total),
      dataTypes: ($types.total),
      pipelines: ($pipelines | length),
      dashboards: ($dashboards.total)
    },
    dataSources: [ $sources.items[] | { id, name, type } ],
    dataTypes: [ $types.items[] | {
      id, name,
      sourceId: (.sourceId // null),
      pipelineOutput: ((.sourceId // null) == null),
      columns: [ .fields[] | { name, dataType, nullable } ]
    } ],
    pipelines: [ $pipelines[] | {
      id, name, sourceDataSourceName, outputDataTypeId, outputDataTypeName,
      lastRunStatus, lastRunRowCount
    } ],
    dashboards: [ $dashboards.items[] | { id, name } ]
  }'
