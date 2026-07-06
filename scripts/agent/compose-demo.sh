#!/usr/bin/env bash
# compose-demo.sh — end-to-end shell composition, the curl twin of
# helio-mcp/scripts/compose.ts. Builds a full dashboard from scratch using only
# the other scripts in this directory, then prints the dashboard id.
#
# Doubles as runnable documentation of the canonical path:
#   source → pipeline → step → run → dashboard → panels → bind.
#
# Usage:  HELIO_PAT=helio_pat_… ./compose-demo.sh
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

echo "1) create static data source"
SRC_ID="$("$here/create-source.sh" "Quarterly Sales (shell)" \
  '[{"name":"region","type":"string"},{"name":"revenue","type":"integer"}]' \
  '[["North",320],["South",210],["East",265],["West",180]]')"
echo "   source=$SRC_ID"

echo "2) create pipeline"
PIPE_JSON="$("$here/create-pipeline.sh" "Sales by Region (shell)" "$SRC_ID" "Sales by Region (shell)")"
PIPE_ID="$(echo "$PIPE_JSON" | jq -r '.id')"
OUT_TYPE="$(echo "$PIPE_JSON" | jq -r '.outputDataTypeId')"
echo "   pipeline=$PIPE_ID output=$OUT_TYPE"

echo "3) add sort step (revenue desc)"
"$here/add-step.sh" "$PIPE_ID" sort '{"sortBy":[{"field":"revenue","direction":"desc"}]}' >/dev/null

echo "4) run pipeline (synchronous)"
"$here/run-pipeline.sh" "$PIPE_ID" | jq '{ rowCount, sourceRowCount }'

echo "5) create dashboard"
DASH_ID="$(helio_post /api/dashboards '{"name":"Regional Sales (shell)"}' | jq -r '.id')"
echo "   dashboard=$DASH_ID"

echo "6) create + bind metric panel"
M_ID="$("$here/create-panel.sh" "$DASH_ID" "Total Revenue" metric)"
"$here/bind-panel.sh" "$M_ID" "$OUT_TYPE" '{"value":"revenue","label":"region"}' metric >/dev/null

echo "7) create + bind chart panel"
C_ID="$("$here/create-panel.sh" "$DASH_ID" "Revenue by Region" chart)"
"$here/bind-panel.sh" "$C_ID" "$OUT_TYPE" '{"xAxis":"region","yAxis":"revenue"}' chart >/dev/null

echo
echo "COMPOSE-DEMO OK"
echo "DASHBOARD_ID=$DASH_ID"
