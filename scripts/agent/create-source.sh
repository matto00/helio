#!/usr/bin/env bash
# create-source.sh — create a `static` data source from inline columns + rows.
#
# The backend auto-creates a source-companion DataType; build a pipeline over
# the returned source id to produce a panel-bindable output type.
#
# Usage:
#   ./create-source.sh NAME COLUMNS_JSON ROWS_JSON
# where
#   COLUMNS_JSON = '[{"name":"region","type":"string"},{"name":"revenue","type":"integer"}]'
#   ROWS_JSON    = '[["North",320],["South",210]]'
#
# Prints the created source id.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

if [ "$#" -ne 3 ]; then
  echo "usage: $0 NAME COLUMNS_JSON ROWS_JSON" >&2
  exit 2
fi
name="$1"; columns="$2"; rows="$3"

body="$(jq -n --arg name "$name" --argjson columns "$columns" --argjson rows "$rows" \
  '{ name: $name, type: "static", columns: $columns, rows: $rows }')"

helio_post /api/data-sources "$body" | jq -r '.id'
