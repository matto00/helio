#!/usr/bin/env bash
# run-pipeline.sh — run a pipeline to completion.
#
# The run is SYNCHRONOUS on the current backend: POST /run returns only after
# the in-process engine finishes and writes rows to the output DataType, so
# there is nothing to poll and no race before binding a panel.
#
# Usage:  ./run-pipeline.sh PIPELINE_ID [--dry]
# Prints: the run result JSON { rows, rowCount, stepRowCounts, sourceRowCount }.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_lib.sh
. "$here/_lib.sh"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 PIPELINE_ID [--dry]" >&2
  exit 2
fi
pipeline_id="$1"
path="/api/pipelines/${pipeline_id}/run"
[ "${2:-}" = "--dry" ] && path="${path}?dry=true"

# POST with no body — the run takes no request payload.
helio_curl POST "$path"
