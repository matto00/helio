#!/usr/bin/env bash
# create-pipeline.sh — create a pipeline over a source. Creates a NEW
# pipeline-output DataType (the panel-bindable type).
#
# Usage:  ./create-pipeline.sh NAME SOURCE_DATA_SOURCE_ID OUTPUT_DATA_TYPE_NAME
# Prints: JSON { id, outputDataTypeId, … } (the full pipeline summary).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

if [ "$#" -ne 3 ]; then
  echo "usage: $0 NAME SOURCE_DATA_SOURCE_ID OUTPUT_DATA_TYPE_NAME" >&2
  exit 2
fi

body="$(jq -n --arg name "$1" --arg src "$2" --arg out "$3" \
  '{ name: $name, sourceDataSourceId: $src, outputDataTypeName: $out }')"

helio_post /api/pipelines "$body"
