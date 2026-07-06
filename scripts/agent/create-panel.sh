#!/usr/bin/env bash
# create-panel.sh — create a panel on a dashboard.
#
# `type` ∈ metric|chart|table|text|markdown|image|divider. For data panels
# (metric/chart/table) create it here, then bind it with bind-panel.sh. For
# text/markdown pass a config like '{"content":"Hello"}'.
#
# Usage:  ./create-panel.sh DASHBOARD_ID TITLE TYPE [CONFIG_JSON]
# Prints: the created panel id.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

if [ "$#" -lt 3 ]; then
  echo "usage: $0 DASHBOARD_ID TITLE TYPE [CONFIG_JSON]" >&2
  exit 2
fi
dashboard_id="$1"; title="$2"; type="$3"; config="${4:-{}}"

body="$(jq -n --arg d "$dashboard_id" --arg t "$title" --arg ty "$type" --argjson c "$config" \
  '{ dashboardId: $d, title: $t, type: $ty, config: $c }')"

helio_post /api/panels "$body" | jq -r '.id'
