#!/usr/bin/env bash
# bind-panel.sh — bind a metric/chart/table panel to a pipeline-output DataType.
#
# fieldMapping keys by panel type:
#   metric → {"value":"…","label":"…","unit":"…"}
#   chart  → {"xAxis":"…","yAxis":"…","series":"…"}
#   table  → {"columns":"a,b,c"}
#
# The DataType MUST be a pipeline output (sourceId null); binding a source
# companion is rejected with HTTP 400 (V41 pipeline-only rule).
#
# Usage:  ./bind-panel.sh PANEL_ID DATA_TYPE_ID FIELD_MAPPING_JSON [PANEL_TYPE]
# Prints: the updated panel JSON.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

if [ "$#" -lt 3 ]; then
  echo "usage: $0 PANEL_ID DATA_TYPE_ID FIELD_MAPPING_JSON [PANEL_TYPE]" >&2
  exit 2
fi
panel_id="$1"; data_type_id="$2"; field_mapping="$3"; panel_type="${4:-}"

body="$(jq -n --arg dt "$data_type_id" --argjson fm "$field_mapping" --arg ty "$panel_type" \
  'if $ty == "" then { config: { dataTypeId: $dt, fieldMapping: $fm } }
   else { type: $ty, config: { dataTypeId: $dt, fieldMapping: $fm } } end')"

helio_patch "/api/panels/${panel_id}" "$body"
