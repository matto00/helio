#!/usr/bin/env bash
# add-step.sh — append a transform step to a pipeline.
#
# `type` ∈ rename|filter|join|compute|groupBy|cast|select|limit|sort|aggregate.
# CONFIG_JSON shape is keyed by type, e.g.
#   limit  → '{"count":3}'
#   select → '{"fields":["region","revenue"]}'
#   sort   → '{"sortBy":[{"field":"revenue","direction":"desc"}]}'
#
# Usage:  ./add-step.sh PIPELINE_ID TYPE CONFIG_JSON
# Prints: the created step JSON.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

if [ "$#" -ne 3 ]; then
  echo "usage: $0 PIPELINE_ID TYPE CONFIG_JSON" >&2
  exit 2
fi
pipeline_id="$1"; type="$2"; config="$3"

body="$(jq -n --arg type "$type" --argjson config "$config" '{ type: $type, config: $config }')"
helio_post "/api/pipelines/${pipeline_id}/steps" "$body"
